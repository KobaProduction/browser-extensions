/**
 * Minimal privacy-preserving feature lifecycle telemetry contract.
 * No provider, endpoint, URL, chat content or authentication data is collected.
 * Disabled by default. ChatGPT Booster can implement TelemetrySink via OTLP.
 */
export type TelemetryEventName = 'feature.started' | 'feature.failed' | 'feature.stopped'
export interface TelemetryEvent {
  readonly event: TelemetryEventName
  readonly moduleId: string
  readonly timestamp: number
  readonly durationMs?: number
}
export interface TelemetrySink {
  send(event: TelemetryEvent): void | Promise<void>
}
export class TelemetryBus {
  private enabled = false
  constructor(private readonly sink: TelemetrySink) {}
  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }
  isEnabled() {
    return this.enabled
  }
  async record(event: TelemetryEventName, moduleId: string, durationMs?: number) {
    if (!this.enabled) return
    if (!/^[a-z][a-z0-9-]+$/.test(moduleId)) return
    const payload: TelemetryEvent = {
      event,
      moduleId,
      timestamp: Date.now(),
      ...(Number.isFinite(durationMs) && durationMs !== undefined
        ? { durationMs: Math.max(0, Math.round(durationMs)) }
        : {}),
    }
    try {
      await this.sink.send(payload)
    } catch {
      /* telemetry must never break feature runtime */
    }
  }
}
