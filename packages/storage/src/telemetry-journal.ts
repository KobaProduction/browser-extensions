import Dexie, { type DexieOptions, type Table } from 'dexie'
import { assertServiceScope, type ServiceScope } from './service-contract'

export interface TelemetryEntry {
  id?: number
  serviceId: string
  name: string
  timestamp: number
  count?: number
  durationMs?: number
  providerId?: string
  errorClass?: string
  state: 'pending' | 'sending' | 'sent'
  leaseOwner: string | null
  leaseUntil: number
  attempts: number
}
export interface TelemetryMetrics {
  pending: number
  sending: number
  discarded: number
  retained: number
  delivered: number
  lastRotationAt: number | null
}
export interface TelemetryJournal {
  append(
    input: Pick<
      TelemetryEntry,
      'name' | 'serviceId' | 'timestamp' | 'count' | 'durationMs' | 'providerId' | 'errorClass'
    >,
  ): Promise<void>
  claim(owner: string, now?: number, limit?: number): Promise<TelemetryEntry[]>
  acknowledge(owner: string, ids: readonly number[]): Promise<number>
  release(owner: string, ids: readonly number[]): Promise<void>
  summary(): Promise<TelemetryMetrics>
  list(options?: { providerId?: string; beforeId?: number; limit?: number }): Promise<TelemetryEntry[]>
  prune(maxEvents: number, maxAgeMs: number, now?: number): Promise<number>
  readConfiguration(): Promise<unknown>
  writeConfiguration(value: unknown): Promise<void>
  readDeliveryStatus(): Promise<unknown>
  writeDeliveryStatus(value: unknown): Promise<void>
  clear(): Promise<void>
  close(): void
}
const EVENTS = new Set([
  'feature.started',
  'feature.stopped',
  'feature.failed',
  'application.notification',
  'application.error',
  'archive.capture.started',
  'archive.capture.completed',
  'archive.capture.failed',
  'archive.export.completed',
  'archive.export.failed',
  'archive.audit.completed',
  'archive.backup.completed',
  'archive.restore.completed',
])
export function isTechnicalTelemetryName(name: string): boolean {
  return EVENTS.has(name)
}
const MAX_EVENTS = 5000
/** Safety backpressure between periodic rotations; append never evicts an older event. */
export const TELEMETRY_HARD_LIMIT = 10000
export function validateTechnicalTelemetryEntry(
  input: Pick<
    TelemetryEntry,
    'name' | 'serviceId' | 'timestamp' | 'count' | 'durationMs' | 'providerId' | 'errorClass'
  >,
): void {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'id',
          'serviceId',
          'name',
          'timestamp',
          'count',
          'durationMs',
          'providerId',
          'errorClass',
          'state',
          'leaseOwner',
          'leaseUntil',
          'attempts',
        ].includes(key),
    ) ||
    !EVENTS.has(input.name) ||
    typeof input.serviceId !== 'string' ||
    !/^[a-zA-Z][\w -]{2,64}$/.test(input.serviceId) ||
    !Number.isSafeInteger(input.timestamp) ||
    input.timestamp < 0 ||
    input.timestamp > 8640000000000000 ||
    (input.providerId !== undefined &&
      !['application', 'vk-booster', 'chatgpt-booster'].includes(input.providerId)) ||
    (input.errorClass !== undefined &&
      !['network', 'permission', 'storage', 'validation', 'cancelled', 'internal'].includes(
        input.errorClass,
      )) ||
    (input.count !== undefined &&
      (!Number.isSafeInteger(input.count) || input.count < 0 || input.count > 1e6)) ||
    (input.durationMs !== undefined &&
      (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > 86400000))
  )
    throw Error('Unsafe technical telemetry event')
}
export function telemetryDatabaseName(scope: ServiceScope): string {
  assertServiceScope(scope)
  if (!scope.installationId) throw Error('Telemetry requires a verified installation scope')
  if (scope.ownerId !== undefined) throw Error('Account-linked telemetry is not supported')
  return `koba-telemetry:${scope.productId}:${scope.channel}:${scope.installationId}`
}
class TelemetryDatabase extends Dexie {
  events!: Table<TelemetryEntry, number>
  metadata!: Table<
    {
      key: string
      discarded?: number
      lastRotationAt?: number
      configuration?: unknown
      delivery?: unknown
    },
    string
  >
  constructor(name: string, options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({ events: '++id,state,leaseUntil,timestamp', metadata: 'key' })
  }
}
export class DexieTelemetryJournal implements TelemetryJournal {
  readonly databaseName: string
  private readonly db: TelemetryDatabase
  private readonly maxEvents: number
  constructor(scope: ServiceScope, options?: DexieOptions, maxEvents = MAX_EVENTS) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_EVENTS)
      throw Error('Invalid telemetry retention limit')
    this.maxEvents = maxEvents
    this.databaseName = telemetryDatabaseName(scope)
    this.db = new TelemetryDatabase(this.databaseName, options)
  }
  async append(
    input: Pick<
      TelemetryEntry,
      'name' | 'serviceId' | 'timestamp' | 'count' | 'durationMs' | 'providerId' | 'errorClass'
    >,
  ) {
    validateTechnicalTelemetryEntry(input)
    await this.db.transaction('rw', this.db.events, this.db.metadata, async () => {
      if ((await this.db.events.count()) >= TELEMETRY_HARD_LIMIT) {
        const prior = await this.db.metadata.get('retention')
        await this.db.metadata.put({
          ...prior,
          key: 'retention',
          discarded: (prior?.discarded ?? 0) + 1,
        })
        return
      }
      await this.db.events.add({
        serviceId: input.serviceId,
        name: input.name,
        timestamp: input.timestamp,
        ...(input.count === undefined ? {} : { count: input.count }),
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
        ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
        ...(input.errorClass === undefined ? {} : { errorClass: input.errorClass }),
        state: 'pending',
        leaseOwner: null,
        leaseUntil: 0,
        attempts: 0,
      })
    })
  }
  async claim(owner: string, now = Date.now(), limit = 50): Promise<TelemetryEntry[]> {
    if (
      !/^[a-zA-Z0-9_-]{8,128}$/.test(owner) ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw Error('Invalid telemetry lease')
    return this.db.transaction('rw', this.db.events, async () => {
      const rows = await this.db.events
        .orderBy('id')
        .filter((row) => row.state === 'pending' || (row.state === 'sending' && row.leaseUntil <= now))
        .limit(limit)
        .toArray()
      for (const row of rows) {
        row.state = 'sending'
        row.leaseOwner = owner
        row.leaseUntil = now + 45000
        row.attempts++
      }
      await this.db.events.bulkPut(rows)
      return rows
    })
  }
  async acknowledge(owner: string, ids: readonly number[]): Promise<number> {
    return this.db.transaction('rw', this.db.events, async () => {
      let acknowledged = 0
      for (const id of ids) {
        const row = await this.db.events.get(id)
        if (row?.state === 'sending' && row.leaseOwner === owner) {
          await this.db.events.put({ ...row, state: 'sent', leaseOwner: null, leaseUntil: 0 })
          acknowledged++
        }
      }
      return acknowledged
    })
  }
  async release(owner: string, ids: readonly number[]): Promise<void> {
    await this.db.transaction('rw', this.db.events, async () => {
      for (const id of ids) {
        const row = await this.db.events.get(id)
        if (row?.state === 'sending' && row.leaseOwner === owner)
          await this.db.events.put({ ...row, state: 'pending', leaseOwner: null, leaseUntil: 0 })
      }
    })
  }
  async summary(): Promise<TelemetryMetrics> {
    const [pending, sending, delivered, retained, metadata] = await Promise.all([
      this.db.events.where('state').equals('pending').count(),
      this.db.events.where('state').equals('sending').count(),
      this.db.events.where('state').equals('sent').count(),
      this.db.events.count(),
      this.db.metadata.get('retention'),
    ])
    return {
      pending,
      sending,
      delivered,
      retained,
      discarded: metadata?.discarded ?? 0,
      lastRotationAt: metadata?.lastRotationAt ?? null,
    }
  }
  async list(
    options: { providerId?: string; beforeId?: number; limit?: number } = {},
  ): Promise<TelemetryEntry[]> {
    const limit = Math.max(1, Math.min(TELEMETRY_HARD_LIMIT, Math.floor(options.limit ?? 50)))
    return this.db.events
      .orderBy('id')
      .reverse()
      .filter(
        (row) =>
          (!options.providerId || (row.providerId ?? 'application') === options.providerId) &&
          (options.beforeId === undefined || (row.id ?? 0) < options.beforeId),
      )
      .limit(limit)
      .toArray()
  }
  /** One periodic transaction removes expired/excess rows in a batch. Active leases survive. */
  async prune(maxEvents = this.maxEvents, maxAgeMs = 7 * 86400000, now = Date.now()): Promise<number> {
    if (
      !Number.isSafeInteger(maxEvents) ||
      maxEvents < 1 ||
      maxEvents > MAX_EVENTS ||
      !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 86400000 ||
      !Number.isSafeInteger(now) ||
      now < 0
    )
      throw Error('Invalid telemetry rotation policy')
    return this.db.transaction('rw', this.db.events, this.db.metadata, async () => {
      const rows = await this.db.events.orderBy('id').toArray()
      const eligible = rows.filter((row) => row.state !== 'sending' || row.leaseUntil <= now)
      const ids = new Set(
        eligible
          .filter((row) => row.timestamp < now - maxAgeMs)
          .map((row) => row.id)
          .filter((id): id is number => id !== undefined),
      )
      let excess = Math.max(0, rows.length - ids.size - maxEvents)
      for (const row of eligible) {
        if (!excess) break
        if (row.id !== undefined && !ids.has(row.id)) {
          ids.add(row.id)
          excess--
        }
      }
      await this.db.events.bulkDelete([...ids])
      const prior = await this.db.metadata.get('retention')
      await this.db.metadata.put({
        key: 'retention',
        discarded: (prior?.discarded ?? 0) + ids.size,
        lastRotationAt: now,
      })
      return ids.size
    })
  }
  async readConfiguration(): Promise<unknown> {
    return (await this.db.metadata.get('configuration'))?.configuration
  }
  async writeConfiguration(configuration: unknown): Promise<void> {
    await this.db.metadata.put({ key: 'configuration', configuration })
  }
  async readDeliveryStatus(): Promise<unknown> {
    return (await this.db.metadata.get('delivery'))?.delivery
  }
  async writeDeliveryStatus(delivery: unknown): Promise<void> {
    await this.db.metadata.put({ key: 'delivery', delivery })
  }
  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.events, this.db.metadata, async () => {
      await this.db.events.clear()
      await this.db.metadata.delete('retention')
    })
  }
  close(): void {
    this.db.close()
  }
}
