import type { ScopedTelemetryName } from './scoped-telemetry'

/** Application-wide telemetry, never a VK or ChatGPT archive dependency. */
export interface ApplicationTelemetryStatus {
  available: boolean
  localEnabled: boolean
  remoteAvailable: boolean
  remoteEnabled: boolean
  pending: number | null
  discarded: number | null
}
export interface ApplicationTelemetryController {
  status(): Promise<ApplicationTelemetryStatus>
  setLocalEnabled(enabled: boolean): Promise<void>
  record(name: ScopedTelemetryName, count?: number, durationMs?: number): Promise<void>
  subscribe(listener: () => void): () => void
  close(): void
}
/** A shared Vue symbol is safe to import without depending on Vue in core. */
export const APPLICATION_TELEMETRY = Symbol('koba.application.telemetry')
