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
const QUERY_SECRET = /([?&](?:token|access_token|api_key|key|session|secret|auth)=)[^&#]*/gi

function sanitizeText(value: string): string {
  return value
    .replace(SECRET_PATTERN, '$1[REDACTED]')
    .replace(QUERY_SECRET, '$1[REDACTED]')
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

export function buildOtlpLogPayload(
  event: TelemetryEvent,
  serviceVersion: string,
): Record<string, unknown> {
  const attributes = Object.entries(event.attributes ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      key,
      value: stringAttribute(value as string | number | boolean),
    }))

  const severityNumber = event.severity === 'ERROR' ? 17 : event.severity === 'WARN' ? 13 : 9
  const timestampNanos = String(BigInt(event.timestamp) * 1_000_000n)

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
        scopeLogs: [
          {
            scope: {
              name: `chatgpt-booster.${event.scope}`,
              version: serviceVersion,
            },
            logRecords: [
              {
                timeUnixNano: timestampNanos,
                observedTimeUnixNano: timestampNanos,
                severityNumber,
                severityText: event.severity ?? 'INFO',
                body: { stringValue: sanitizeText(event.body ?? event.name) },
                attributes: [
                  { key: 'event.name', value: { stringValue: event.name } },
                  ...attributes,
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

export class OtlpTelemetryClient {
  readonly #sender: TelemetryHttpSender
  readonly #serviceVersion: string
  readonly #getSettings: () => Promise<TelemetrySettings>
  readonly #getToken: () => Promise<string>

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

  async emit(event: TelemetryEvent): Promise<void> {
    const settings = await this.#getSettings()
    if (!settings.enabled || !settings.endpoint.trim()) return

    const endpoint = settings.endpoint.trim().replace(/\/$/, '')
    const token = await this.#getToken()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (token) headers.authorization = `Bearer ${token}`

    await this.#sender({
      url: `${endpoint}/v1/logs`,
      headers,
      body: JSON.stringify(buildOtlpLogPayload(event, this.#serviceVersion)),
    })
  }
}
