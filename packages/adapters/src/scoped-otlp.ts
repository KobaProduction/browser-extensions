import { ScopedTelemetry, type ScopedTelemetryEvent } from '@kobaproduction/browser-core'
import {
  assertServiceScope,
  DexieTelemetryJournal,
  type ServiceScope,
  type TelemetryEntry,
  type TelemetryJournal,
  validateTechnicalTelemetryEntry,
} from '@kobaproduction/browser-storage'
import { asTelemetryPort } from './telemetry-port'

export interface OtlpDeliveryConfiguration {
  /** Local collection is independent; remote delivery requires a second opt-in. */
  enabled: boolean
  /** HTTPS collector base URL. No query, credentials or fragment allowed. */
  endpoint: string
}
export interface OtlpRequest {
  url: string
  headers: Record<string, string>
  body: string
  signal?: AbortSignal
}
export type OtlpSender = (request: OtlpRequest) => Promise<void>
export class TelemetryPermissionRequired extends Error {}
export class TelemetryCollectorRejected extends Error {}
export interface OtlpDeliveryStatus {
  state:
    | 'off'
    | 'idle'
    | 'sending'
    | 'offline'
    | 'retrying'
    | 'permission-required'
    | 'collector-rejected'
  collectorRejected: boolean
  lastSentAt: number | null
  nextAttemptAt: number | null
  retryDelayMs: number
}

/** Network transport is provider-neutral. Call only after explicit remote consent. */
export async function sendOtlpRequest(request: OtlpRequest): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal,
      headers: request.headers,
      body: request.body,
    })
    if (response.status !== 200) {
      if ([429, 502, 503, 504].includes(response.status))
        throw new Error('OTLP collector did not acknowledge batch')
      throw new TelemetryCollectorRejected('OTLP collector did not acknowledge batch')
    }
    const reader = response.body?.getReader(),
      parts: Uint8Array[] = []
    let size = 0
    if (reader)
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.byteLength
          if (size > 65536) throw new TelemetryCollectorRejected('Invalid OTLP acknowledgement')
          parts.push(next.value)
        }
      } finally {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    const bytes = new Uint8Array(size)
    let at = 0
    for (const part of parts) {
      bytes.set(part, at)
      at += part.byteLength
    }
    let acknowledgement: string
    try {
      acknowledgement = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new TelemetryCollectorRejected('Invalid OTLP acknowledgement')
    }
    validateOtlpAcknowledgement(response.status, acknowledgement)
  } finally {
    clearTimeout(timeout)
  }
}
/** Only acceptance shape/count is inspected; collector messages never become telemetry/UI. */
export function validateOtlpAcknowledgement(status: number, body: string): void {
  if (status !== 200) {
    if ([429, 502, 503, 504].includes(status)) throw Error('OTLP collector did not acknowledge batch')
    throw new TelemetryCollectorRejected('OTLP collector did not acknowledge batch')
  }
  // This sender negotiates JSON, whose empty service response is {}, not an empty body.
  if (!body.trim()) throw new TelemetryCollectorRejected('Invalid OTLP acknowledgement')
  if (body.length > 65536) throw new TelemetryCollectorRejected('Invalid OTLP acknowledgement')
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new TelemetryCollectorRejected('Invalid OTLP acknowledgement')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TelemetryCollectorRejected('Invalid OTLP acknowledgement')
  const response = value as Record<string, unknown>,
    partial = response.partialSuccess ?? response.partial_success
  // Protobuf JSON ignores unknown fields so a future collector remains compatible.
  if (partial === undefined) return
  if (!partial || typeof partial !== 'object' || Array.isArray(partial))
    throw new TelemetryCollectorRejected('Invalid OTLP acknowledgement')
  const rejected =
    (partial as Record<string, unknown>).rejectedLogRecords ??
    (partial as Record<string, unknown>).rejected_log_records ??
    0
  if (
    (typeof rejected !== 'number' || !Number.isSafeInteger(rejected) || rejected < 0) &&
    (typeof rejected !== 'string' || !/^\d+$/.test(rejected))
  )
    throw new TelemetryCollectorRejected('Invalid OTLP acknowledgement')
  if (BigInt(rejected as number | string) > 0n)
    throw new TelemetryCollectorRejected('Collector rejected records; queue retained locally')
}
export function resolveOtlpLogsEndpoint(value: string): string {
  let endpoint: URL
  try {
    endpoint = new URL(value.trim())
  } catch {
    throw Error('Invalid OTLP endpoint')
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !endpoint.hostname
  )
    throw Error('OTLP transport requires an HTTPS endpoint without credentials or query')
  if (endpoint.pathname.endsWith('/v1/logs')) return endpoint.href
  return new URL('v1/logs', endpoint.href.replace(/\/?$/, '/')).href
}
function otlpValue(value: string | number) {
  return typeof value === 'number' ? { intValue: String(value) } : { stringValue: value }
}
/** Only allowlisted technical fields cross the OTLP boundary. */
export function scopedOtlpPayload(
  rows: readonly TelemetryEntry[],
  scope: ServiceScope,
  version: string,
): string {
  assertServiceScope(scope)
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid telemetry version')
  for (const row of rows) validateTechnicalTelemetryEntry(row)
  const byService = new Map<string, TelemetryEntry[]>()
  for (const row of rows) {
    const bucket = byService.get(row.serviceId) ?? []
    bucket.push(row)
    byService.set(row.serviceId, bucket)
  }
  return JSON.stringify({
    resourceLogs: [...byService.entries()].map(([serviceId, records]) => ({
      resource: {
        attributes: [
          ['service.name', serviceId],
          ['service.namespace', 'koba'],
          ['service.version', version],
          ['service.product', scope.productId],
          ['deployment.environment', scope.channel],
        ].map(([key, value]) => ({ key, value: otlpValue(value ?? '') })),
      },
      scopeLogs: [
        {
          scope: { name: `koba.${scope.productId}.${scope.channel}`, version },
          logRecords: records.map((event) => ({
            timeUnixNano: String(BigInt(event.timestamp) * 1_000_000n),
            severityNumber: event.name.endsWith('failed') || event.name.endsWith('error') ? 17 : 9,
            severityText:
              event.name.endsWith('failed') || event.name.endsWith('error') ? 'ERROR' : 'INFO',
            body: { stringValue: event.name },
            attributes: [
              { key: 'event.provider', value: otlpValue(event.providerId ?? 'application') },
              ...(event.errorClass ? [{ key: 'error.type', value: otlpValue(event.errorClass) }] : []),
              ...(event.count === undefined
                ? []
                : [{ key: 'event.count', value: otlpValue(event.count) }]),
              ...(event.durationMs === undefined
                ? []
                : [{ key: 'event.duration_ms', value: otlpValue(event.durationMs) }]),
            ],
          })),
        },
      ],
    })),
  })
}
export class ScopedOtlpService {
  readonly journal: TelemetryJournal
  readonly emitter: ScopedTelemetry
  readonly port: ReturnType<typeof asTelemetryPort>
  private readonly leaseOwner: string
  private readonly sender: OtlpSender
  private readonly scope: ServiceScope
  private readonly version: string
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private busy = false
  private inFlight: AbortController | undefined
  private delivery: OtlpDeliveryStatus = {
    state: 'off',
    collectorRejected: false,
    lastSentAt: null,
    nextAttemptAt: null,
    retryDelayMs: 30000,
  }
  private deliveryEpoch = 0
  private readonly changed?: (status: OtlpDeliveryStatus) => void | Promise<void>
  private checkpoint: Promise<void> = Promise.resolve()

  constructor(options: {
    scope: ServiceScope
    serviceId: string
    version: string
    sender?: OtlpSender
    journal?: TelemetryJournal
    changed?: (status: OtlpDeliveryStatus) => void | Promise<void>
  }) {
    this.scope = assertServiceScope(options.scope)
    if (!/^\d+\.\d+\.\d+$/.test(options.version)) throw Error('Invalid telemetry version')
    this.version = options.version
    this.changed = options.changed
    this.sender = options.sender ?? sendOtlpRequest
    this.journal = options.journal ?? new DexieTelemetryJournal(this.scope)
    this.leaseOwner = crypto.randomUUID().replaceAll('-', '')
    this.emitter = new ScopedTelemetry(
      options.serviceId,
      `${this.scope.productId}:${this.scope.channel}`,
      {
        send: async (event: ScopedTelemetryEvent) => {
          if (event.productId !== this.scope.productId || event.channel !== this.scope.channel)
            throw Error('Telemetry scope mismatch')
          await this.journal.append({
            serviceId: event.serviceId,
            name: event.name,
            timestamp: event.timestamp,
            ...(event.count !== undefined ? { count: event.count } : {}),
            ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
            ...(event.providerId !== undefined ? { providerId: event.providerId } : {}),
            ...(event.errorClass !== undefined ? { errorClass: event.errorClass } : {}),
          })
        },
      },
    )
    this.port = asTelemetryPort(this.scope, this.emitter)
  }

  /** Explicit opt-in to local collection; default is OFF. */
  setLocalEnabled(enabled: boolean): void {
    this.emitter.setEnabled(enabled)
    if (!enabled) this.stopDelivery()
  }
  deliveryStatus(): OtlpDeliveryStatus {
    return { ...this.delivery }
  }
  restoreDeliveryStatus(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const status = value as OtlpDeliveryStatus
    const timestamp = (v: unknown) =>
      v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)
    if (
      ![
        'off',
        'idle',
        'sending',
        'offline',
        'retrying',
        'permission-required',
        'collector-rejected',
      ].includes(status.state) ||
      (status.collectorRejected !== undefined && typeof status.collectorRejected !== 'boolean') ||
      !timestamp(status.lastSentAt) ||
      !timestamp(status.nextAttemptAt) ||
      !Number.isSafeInteger(status.retryDelayMs) ||
      status.retryDelayMs < 30000 ||
      status.retryDelayMs > 300000
    )
      return
    this.delivery = {
      state: status.state === 'sending' ? 'retrying' : status.state,
      collectorRejected: status.collectorRejected ?? status.state === 'collector-rejected',
      lastSentAt: status.lastSentAt,
      nextAttemptAt: status.nextAttemptAt,
      retryDelayMs: status.retryDelayMs,
    }
  }
  resetDeliveryStatus(): void {
    this.deliveryEpoch++
    this.updateDelivery({
      state: 'off',
      collectorRejected: false,
      lastSentAt: null,
      nextAttemptAt: null,
      retryDelayMs: 30000,
    })
  }
  persistDeliveryStatus(): Promise<void> {
    return this.checkpoint
  }
  private updateDelivery(patch: Partial<OtlpDeliveryStatus>): void {
    this.delivery = { ...this.delivery, ...patch }
    const snapshot = this.deliveryStatus()
    this.checkpoint = this.checkpoint
      .then(() => this.changed?.(snapshot))
      .then(
        () => undefined,
        () => undefined,
      )
  }
  /** Delivery never probes separately; explicit endpoint validation uses an empty request. */
  async flush(connection: OtlpDeliveryConfiguration): Promise<number> {
    if (
      !this.emitter.isEnabled() ||
      !connection.enabled ||
      this.busy ||
      this.stopped ||
      this.delivery.collectorRejected
    )
      return 0
    const epoch = this.deliveryEpoch
    const url = resolveOtlpLogsEndpoint(connection.endpoint)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const retryDelayMs = this.nextRetryDelay()
      this.updateDelivery({ state: 'offline', retryDelayMs, nextAttemptAt: Date.now() + retryDelayMs })
      await this.persistDeliveryStatus()
      return 0
    }
    this.busy = true
    this.updateDelivery({ state: 'sending', nextAttemptAt: null })
    let ids: number[] = []
    try {
      const rows = await this.journal.claim(this.leaseOwner)
      ids = rows.map((x) => x.id).filter((id): id is number => id !== undefined)
      if (rows.length === 0) {
        this.updateDelivery({ state: 'idle', retryDelayMs: 30000 })
        return 0
      }
      if (epoch !== this.deliveryEpoch || this.stopped || !this.emitter.isEnabled()) {
        await this.journal.release(this.leaseOwner, ids)
        return 0
      }
      this.inFlight = new AbortController()
      await this.persistDeliveryStatus()
      await this.sender({
        url,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: scopedOtlpPayload(rows, this.scope, this.version),
        signal: this.inFlight.signal,
      })
      if (epoch !== this.deliveryEpoch || this.stopped || !this.emitter.isEnabled()) {
        await this.journal.release(this.leaseOwner, ids)
        return 0
      }
      const delivered = await this.journal.acknowledge(this.leaseOwner, ids)
      this.updateDelivery({
        state: this.stopped ? 'off' : 'idle',
        lastSentAt: Date.now(),
        retryDelayMs: 30000,
      })
      return delivered
    } catch (error) {
      // Never remove unacknowledged data. Callback failures cannot affect products.
      if (ids.length) await this.journal.release(this.leaseOwner, ids).catch(() => undefined)
      if (epoch !== this.deliveryEpoch) return 0
      const retryDelayMs = this.nextRetryDelay()
      const rejected = error instanceof TelemetryCollectorRejected
      this.updateDelivery({
        state: this.stopped
          ? 'off'
          : rejected
            ? 'collector-rejected'
            : error instanceof TelemetryPermissionRequired
              ? 'permission-required'
              : 'retrying',
        collectorRejected: rejected,
        retryDelayMs,
        nextAttemptAt: this.stopped || rejected ? null : Date.now() + retryDelayMs,
      })
      return 0
    } finally {
      this.busy = false
      this.inFlight = undefined
      await this.persistDeliveryStatus()
    }
  }

  /** Start only after remote opt-in. Page/MV3 suspension simply pauses delivery. */
  startDelivery(getConnection: () => Promise<OtlpDeliveryConfiguration>): void {
    this.stopped = false
    if (this.delivery.collectorRejected) {
      this.updateDelivery({ state: 'collector-rejected', nextAttemptAt: null })
      return
    }
    if (this.timer !== undefined) return
    const epoch = this.deliveryEpoch
    if (this.delivery.state === 'off') this.updateDelivery({ state: 'idle' })
    let delay =
      this.delivery.nextAttemptAt === null
        ? this.delivery.retryDelayMs
        : Math.max(0, this.delivery.nextAttemptAt - Date.now())
    const cycle = async () => {
      if (this.stopped) return
      try {
        const connection = await getConnection()
        if (this.stopped || epoch !== this.deliveryEpoch) return
        if (connection.enabled && this.emitter.isEnabled()) {
          await this.flush(connection)
          delay = this.delivery.retryDelayMs
        }
      } catch {
        if (this.stopped || epoch !== this.deliveryEpoch) return
        delay = this.nextRetryDelay()
        this.updateDelivery({ state: 'retrying', retryDelayMs: delay })
      }
      if (!this.stopped && epoch === this.deliveryEpoch && !this.delivery.collectorRejected) {
        this.updateDelivery({ nextAttemptAt: Date.now() + delay })
        this.timer = setTimeout(() => {
          this.timer = undefined
          void cycle()
        }, delay)
      }
    }
    this.updateDelivery({ nextAttemptAt: Date.now() + delay })
    this.timer = setTimeout(() => {
      this.timer = undefined
      void cycle()
    }, delay)
  }

  stopDelivery(): void {
    this.deliveryEpoch++
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.inFlight?.abort()
    this.updateDelivery({ state: 'off', nextAttemptAt: null })
  }
  private nextRetryDelay(): number {
    return Math.min(
      300000,
      Math.max(30000, Math.round(this.delivery.retryDelayMs * 2 * (0.8 + Math.random() * 0.4))),
    )
  }
  close(): void {
    this.stopDelivery()
    this.journal.close()
  }
}
