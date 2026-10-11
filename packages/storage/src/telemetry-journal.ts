import Dexie, { type DexieOptions, type Table } from 'dexie'
import { assertServiceScope, type ServiceScope } from './service-contract'

export interface TelemetryEntry {
  id?: number
  serviceId: string
  name: string
  timestamp: number
  count?: number
  durationMs?: number
  state: 'pending' | 'sending'
  leaseOwner: string | null
  leaseUntil: number
  attempts: number
}
export interface TelemetryMetrics {
  pending: number
  sending: number
  discarded: number
}
const EVENTS = new Set([
  'feature.started',
  'feature.stopped',
  'feature.failed',
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
export function telemetryDatabaseName(scope: ServiceScope): string {
  assertServiceScope(scope)
  if (!scope.installationId) throw Error('Telemetry requires a verified installation scope')
  if (scope.ownerId !== undefined) throw Error('Account-linked telemetry is not supported')
  return `koba-telemetry:${scope.productId}:${scope.channel}:${scope.installationId}`
}
class TelemetryDatabase extends Dexie {
  events!: Table<TelemetryEntry, number>
  metadata!: Table<{ key: string; discarded: number }, string>
  constructor(name: string, options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({ events: '++id,state,leaseUntil,timestamp', metadata: 'key' })
  }
}
export class DexieTelemetryJournal {
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
    input: Pick<TelemetryEntry, 'name' | 'serviceId' | 'timestamp' | 'count' | 'durationMs'>,
  ) {
    if (
      !EVENTS.has(input.name) ||
      !/^[a-zA-Z][\w -]{2,64}$/.test(input.serviceId) ||
      !Number.isSafeInteger(input.timestamp) ||
      input.timestamp < 0 ||
      (input.count !== undefined &&
        (!Number.isSafeInteger(input.count) || input.count < 0 || input.count > 1e6)) ||
      (input.durationMs !== undefined &&
        (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > 86400000))
    )
      throw Error('Unsafe technical telemetry event')
    await this.db.transaction('rw', this.db.events, this.db.metadata, async () => {
      const excess = Math.max(0, (await this.db.events.count()) + 1 - this.maxEvents)
      if (excess) {
        const oldest = await this.db.events.orderBy('id').limit(excess).primaryKeys()
        await this.db.events.bulkDelete(oldest)
        const prior = (await this.db.metadata.get('retention'))?.discarded ?? 0
        await this.db.metadata.put({ key: 'retention', discarded: prior + oldest.length })
      }
      await this.db.events.add({
        serviceId: input.serviceId,
        name: input.name,
        timestamp: input.timestamp,
        ...(input.count === undefined ? {} : { count: input.count }),
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
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
        .filter((row) => row.state === 'pending' || row.leaseUntil <= now)
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
      let removed = 0
      for (const id of ids) {
        const row = await this.db.events.get(id)
        if (row?.state === 'sending' && row.leaseOwner === owner) {
          await this.db.events.delete(id)
          removed++
        }
      }
      return removed
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
    const [pending, sending, retained] = await Promise.all([
      this.db.events.where('state').equals('pending').count(),
      this.db.events.where('state').equals('sending').count(),
      this.db.metadata.get('retention'),
    ])
    return { pending, sending, discarded: retained?.discarded ?? 0 }
  }
  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.events, this.db.metadata, async () => {
      await this.db.events.clear()
      await this.db.metadata.clear()
    })
  }
  close(): void {
    this.db.close()
  }
}
