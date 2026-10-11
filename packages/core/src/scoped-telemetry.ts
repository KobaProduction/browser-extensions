/** Pluggable, fail-open counters only. Never send provider records or URLs. */
const APPROVED_SIGNALS = new Set<string>([
  'archive.capture.started',
  'archive.capture.completed',
  'archive.capture.failed',
  'archive.export.completed',
  'archive.export.failed',
  'archive.audit.completed',
  'archive.backup.completed',
  'archive.restore.completed',
])
export const SCOPED_TELEMETRY_SCHEMA_VERSION = 1 as const
export function isScopedTelemetryName(name: string): name is ScopedTelemetryName {
  return APPROVED_SIGNALS.has(name)
}
export type ScopedTelemetryName =
  | 'archive.capture.started'
  | 'archive.capture.completed'
  | 'archive.capture.failed'
  | 'archive.export.completed'
  | 'archive.export.failed'
  | 'archive.audit.completed'
  | 'archive.backup.completed'
  | 'archive.restore.completed'
export interface ScopedTelemetryEvent {
  readonly service: string
  readonly serviceId: string
  readonly scope: string
  readonly productId: string
  readonly channel: 'dev' | 'prod'
  readonly schemaVersion: typeof SCOPED_TELEMETRY_SCHEMA_VERSION
  readonly name: ScopedTelemetryName
  readonly timestamp: number
  readonly count?: number
  readonly durationMs?: number
}
export interface ScopedTelemetrySink {
  send(event: ScopedTelemetryEvent): void | Promise<void>
}
export class ScopedTelemetry {
  private enabled = false
  constructor(
    readonly service: string,
    readonly scope: string,
    private readonly sink?: ScopedTelemetrySink,
  ) {
    if (!/^[a-zA-Z][\w -]{2,64}$/.test(service) || !/^[a-z][a-z0-9-]*:(dev|prod)$/.test(scope))
      throw Error('Invalid telemetry service scope')
  }
  available() {
    return Boolean(this.sink)
  }
  isEnabled() {
    return this.enabled && this.available()
  }
  setEnabled(value: boolean) {
    this.enabled = value && this.available()
  }
  async record(name: ScopedTelemetryName, count?: number, durationMs?: number): Promise<void> {
    if (!this.isEnabled() || !this.sink || !isScopedTelemetryName(name)) return
    const event: ScopedTelemetryEvent = {
      service: this.service,
      serviceId: this.service,
      scope: this.scope,
      productId: this.scope.split(':')[0] ?? '',
      channel: this.scope.endsWith(':dev') ? 'dev' : 'prod',
      schemaVersion: SCOPED_TELEMETRY_SCHEMA_VERSION,
      name,
      timestamp: Date.now(),
      ...(Number.isFinite(count) && count !== undefined && count >= 0
        ? { count: Math.floor(count) }
        : {}),
      ...(Number.isFinite(durationMs) && durationMs !== undefined && durationMs >= 0
        ? { durationMs: Math.round(durationMs) }
        : {}),
    }
    try {
      await this.sink.send(event)
    } catch {
      /* Telemetry must never block or fail archive operations. */
    }
  }
}
