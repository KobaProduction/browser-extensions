import { ScopedTelemetry, type ScopedTelemetryEvent } from '@kobaproduction/browser-core'
import {
  assertServiceScope,
  DexieTelemetryJournal,
  isTechnicalTelemetryName,
  type ServiceScope,
  type TelemetryEntry,
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
}
export type OtlpSender = (request: OtlpRequest) => Promise<void>

/** Network transport is provider-neutral. Call only after explicit remote consent. */
export async function sendOtlpRequest(request: OtlpRequest): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      headers: request.headers,
      body: request.body,
    })
    if (!response.ok) throw new Error('OTLP collector did not acknowledge batch')
  } finally {
    clearTimeout(timeout)
  }
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
  if (
    rows.some(
      (row) => !isTechnicalTelemetryName(row.name) || !/^[a-zA-Z][\w -]{2,64}$/.test(row.serviceId),
    )
  )
    throw Error('Invalid or private OTLP event')
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
            severityNumber: event.name.endsWith('failed') ? 17 : 9,
            severityText: event.name.endsWith('failed') ? 'ERROR' : 'INFO',
            body: { stringValue: event.name },
            attributes: [
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
  readonly journal: DexieTelemetryJournal
  readonly emitter: ScopedTelemetry
  readonly port: ReturnType<typeof asTelemetryPort>
  private readonly leaseOwner: string
  private readonly sender: OtlpSender
  private readonly scope: ServiceScope
  private readonly version: string
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private busy = false

  constructor(options: {
    scope: ServiceScope
    serviceId: string
    version: string
    sender?: OtlpSender
    journal?: DexieTelemetryJournal
  }) {
    this.scope = assertServiceScope(options.scope)
    if (!/^\d+\.\d+\.\d+$/.test(options.version)) throw Error('Invalid telemetry version')
    this.version = options.version
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
          await this.journal.append(event)
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
  /** No availability probe is sent without remote consent. Send itself proves reachability. */
  async flush(connection: OtlpDeliveryConfiguration): Promise<number> {
    if (!this.emitter.isEnabled() || !connection.enabled || this.busy || this.stopped) return 0
    const url = resolveOtlpLogsEndpoint(connection.endpoint)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
    this.busy = true
    let ids: number[] = []
    try {
      const rows = await this.journal.claim(this.leaseOwner)
      ids = rows.map((x) => x.id).filter((id): id is number => id !== undefined)
      if (rows.length === 0) return 0
      await this.sender({
        url,
        headers: { 'content-type': 'application/json' },
        body: scopedOtlpPayload(rows, this.scope, this.version),
      })
      return await this.journal.acknowledge(this.leaseOwner, ids)
    } catch {
      // Never remove unacknowledged data. Callback failures cannot affect products.
      if (ids.length) await this.journal.release(this.leaseOwner, ids)
      return 0
    } finally {
      this.busy = false
    }
  }

  /** Start only after remote opt-in. Page/MV3 suspension simply pauses delivery. */
  startDelivery(getConnection: () => Promise<OtlpDeliveryConfiguration>): void {
    this.stopped = false
    if (this.timer !== undefined) return
    let delay = 30_000
    const cycle = async () => {
      if (this.stopped) return
      try {
        const connection = await getConnection()
        if (connection.enabled && this.emitter.isEnabled()) {
          const delivered = await this.flush(connection)
          delay = delivered > 0 ? 30_000 : Math.min(300_000, delay * 2)
        }
      } catch {
        delay = Math.min(300_000, delay * 2)
      }
      if (!this.stopped)
        this.timer = setTimeout(() => {
          this.timer = undefined
          void cycle()
        }, delay)
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void cycle()
    }, delay)
  }

  stopDelivery(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }
  close(): void {
    this.stopDelivery()
    this.journal.close()
  }
}
