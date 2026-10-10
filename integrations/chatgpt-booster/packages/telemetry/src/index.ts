import type { TelemetrySettings } from '@chatgpt-booster/core'

export type TelemetryScope = 'runtime' | 'transport-observer'

export interface TelemetryEvent {
  scope: TelemetryScope
  name: string
  timestamp: number
  severity?: 'INFO' | 'WARN' | 'ERROR'
  attributes?: Record<string, string | number | boolean | null | undefined>
  body?: string
}

export interface TelemetryHttpRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export type TelemetryHttpSender = (request: TelemetryHttpRequest) => Promise<void>

const SECRET_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi

const JSON_SECRET_VALUE =
  /("(?:authorization|cookie|token|secret|password|passwd|api[-_]?key|session|credential|verify|turnstile|proof|challenge)[^"]*"\s*:\s*")[^"]*(")/gi
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g

const QUERY_SECRET =
  /([?&](?:token|access_token|api_key|key|session|secret|auth|verify|turnstile|proof|challenge)=)[^&#]*/gi
const FLUSH_INTERVAL_MS = 2_000
const MAX_BATCH_SIZE = 50

function sanitizeText(value: string): string {
  return value
    .replace(SECRET_PATTERN, '$1[REDACTED]')
    .replace(QUERY_SECRET, '$1[REDACTED]')
    .replace(JSON_SECRET_VALUE, '$1[REDACTED]$2')
    .replace(JWT_LIKE, '[REDACTED_JWT]')
    .slice(0, 8192)
}

function stringAttribute(value: string | number | boolean): {
  stringValue?: string
  intValue?: string
  boolValue?: boolean
} {
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number' && Number.isInteger(value)) return { intValue: String(value) }
  return { stringValue: sanitizeText(String(value)) }
}

function logRecord(event: TelemetryEvent): Record<string, unknown> {
  const attributes = Object.entries(event.attributes ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      key,
      value: stringAttribute(value as string | number | boolean),
    }))

  const severityNumber = event.severity === 'ERROR' ? 17 : event.severity === 'WARN' ? 13 : 9
  const timestampNanos = String(BigInt(event.timestamp) * 1_000_000n)

  return {
    timeUnixNano: timestampNanos,
    observedTimeUnixNano: timestampNanos,
    severityNumber,
    severityText: event.severity ?? 'INFO',
    body: { stringValue: sanitizeText(event.body ?? event.name) },
    attributes: [{ key: 'event.name', value: { stringValue: event.name } }, ...attributes],
  }
}

export function buildOtlpLogBatchPayload(
  events: readonly TelemetryEvent[],
  serviceVersion: string,
): Record<string, unknown> {
  const scopes = new Map<TelemetryScope, TelemetryEvent[]>()
  for (const event of events) {
    const bucket = scopes.get(event.scope) ?? []
    bucket.push(event)
    scopes.set(event.scope, bucket)
  }

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'chatgpt-booster-extension' } },
            { key: 'service.namespace', value: { stringValue: 'koba' } },
            { key: 'service.version', value: { stringValue: serviceVersion } },
          ],
        },
        scopeLogs: [...scopes.entries()].map(([scope, scopeEvents]) => ({
          scope: {
            name: `chatgpt-booster.${scope}`,
            version: serviceVersion,
          },
          logRecords: scopeEvents.map(logRecord),
        })),
      },
    ],
  }
}

export function buildOtlpLogPayload(
  event: TelemetryEvent,
  serviceVersion: string,
): Record<string, unknown> {
  return buildOtlpLogBatchPayload([event], serviceVersion)
}

export class OtlpTelemetryClient {
  readonly #sender: TelemetryHttpSender
  readonly #serviceVersion: string
  readonly #getSettings: () => Promise<TelemetrySettings>
  readonly #getToken: () => Promise<string>
  #queue: TelemetryEvent[] = []
  #flushTimer: ReturnType<typeof setTimeout> | undefined
  #flushPromise: Promise<void> | undefined

  constructor(options: {
    sender: TelemetryHttpSender
    serviceVersion: string
    getSettings: () => Promise<TelemetrySettings>
    getToken: () => Promise<string>
  }) {
    this.#sender = options.sender
    this.#serviceVersion = options.serviceVersion
    this.#getSettings = options.getSettings
    this.#getToken = options.getToken
  }

  async emit(event: TelemetryEvent, options: { force?: boolean } = {}): Promise<void> {
    if (options.force) {
      const settings = await this.#getSettings()
      if (!settings.endpoint.trim()) return
      await this.#sendBatch([event], settings)
      return
    }

    this.#queue.push(event)
    if (this.#queue.length >= MAX_BATCH_SIZE) {
      await this.flush()
      return
    }
    this.#scheduleFlush()
  }

  async flush(): Promise<void> {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer)
      this.#flushTimer = undefined
    }
    if (this.#queue.length === 0) return
    if (this.#flushPromise) return await this.#flushPromise

    const batch = this.#queue.splice(0, MAX_BATCH_SIZE)
    this.#flushPromise = (async () => {
      const settings = await this.#getSettings()
      if (!settings.enabled || !settings.endpoint.trim()) return
      await this.#sendBatch(batch, settings)
    })()

    try {
      await this.#flushPromise
    } finally {
      this.#flushPromise = undefined
      if (this.#queue.length > 0) this.#scheduleFlush()
    }
  }

  async test(): Promise<void> {
    const settings = await this.#getSettings()
    if (!settings.endpoint.trim()) throw new Error('Telemetry endpoint is not configured')

    await this.emit(
      {
        scope: 'runtime',
        name: 'telemetry.test',
        timestamp: Date.now(),
        severity: 'INFO',
        attributes: {
          'telemetry.test': true,
        },
        body: 'ChatGPT Booster telemetry test',
      },
      { force: true },
    )
  }

  #scheduleFlush() {
    if (this.#flushTimer) return
    this.#flushTimer = setTimeout(() => {
      void this.flush().catch((error) => {
        console.warn('[ChatGPT Booster] Telemetry batch flush failed', error)
      })
    }, FLUSH_INTERVAL_MS)
  }

  async #sendBatch(events: readonly TelemetryEvent[], settings: TelemetrySettings): Promise<void> {
    const endpoint = settings.endpoint.trim().replace(/\/$/, '')
    const token = await this.#getToken()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (token) headers.authorization = `Bearer ${token}`

    await this.#sender({
      url: `${endpoint}/v1/logs`,
      headers,
      body: JSON.stringify(buildOtlpLogBatchPayload(events, this.#serviceVersion)),
    })
  }
}
