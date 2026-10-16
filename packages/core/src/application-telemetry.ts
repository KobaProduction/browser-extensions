import type {
  ScopedTelemetryContext,
  ScopedTelemetryName,
  TelemetryProviderId,
} from './scoped-telemetry'

export interface ApplicationTelemetryConfiguration {
  schemaVersion: 1
  remoteEnabled: boolean
  endpoint: string
  maxEvents: number
  maxAgeDays: number
  rotationMinutes: number
}
export interface ApplicationTelemetryRecord {
  id: number
  providerId: TelemetryProviderId
  name: ScopedTelemetryName
  timestamp: number
  count?: number
  durationMs?: number
  errorClass?: ScopedTelemetryContext['errorClass']
  state: 'pending' | 'sending' | 'sent'
  attempts: number
}
export interface ApplicationTelemetryQuery {
  providerId?: TelemetryProviderId
  beforeId?: number
  limit?: number
}

/** Application-wide telemetry, never a VK or ChatGPT archive dependency. */
export interface ApplicationTelemetryStatus {
  available: boolean
  localEnabled: boolean
  remoteAvailable: boolean
  remoteEnabled: boolean
  pending: number | null
  discarded: number | null
  retained: number | null
  delivered: number | null
  deliveryState:
    | 'off'
    | 'idle'
    | 'sending'
    | 'offline'
    | 'retrying'
    | 'permission-required'
    | 'collector-rejected'
    | 'unavailable'
  lastSentAt: number | null
  nextAttemptAt: number | null
  lastRotationAt: number | null
  providers: readonly TelemetryProviderId[]
}
export interface ApplicationTelemetryController {
  status(): Promise<ApplicationTelemetryStatus>
  setLocalEnabled(enabled: boolean): Promise<void>
  configuration(): Promise<ApplicationTelemetryConfiguration>
  configure(configuration: ApplicationTelemetryConfiguration): Promise<void>
  /** Explicit candidate check sends an empty OTLP envelope, never queued events. */
  probeEndpoint?(endpoint: string): Promise<{
    ok: boolean
    endpoint: string
    errorCode?: 'unavailable' | 'permission' | 'configuration' | 'network' | 'rejected'
  }>
  /** Separate consent; enabling may request the endpoint's browser permission. */
  setRemoteEnabled(enabled: boolean): Promise<void>
  records(query?: ApplicationTelemetryQuery): Promise<readonly ApplicationTelemetryRecord[]>
  exportRecords(providerId?: TelemetryProviderId): Promise<string>
  clearRecords(): Promise<void>
  flush(): Promise<number>
  record(
    name: ScopedTelemetryName,
    count?: number,
    durationMs?: number,
    context?: ScopedTelemetryContext,
  ): Promise<void>
  subscribe(listener: () => void): () => void
  close(): void
}
/** A shared Vue symbol is safe to import without depending on Vue in core. */
export const APPLICATION_TELEMETRY = Symbol('koba.application.telemetry')

/** Classify only finite error names. Exception messages, URLs and stack traces stay private. */
export function classifyTelemetryError(
  error: unknown,
): NonNullable<ScopedTelemetryContext['errorClass']> {
  let name: unknown
  try {
    name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined
  } catch {
    return 'internal'
  }
  if (typeof name !== 'string') return 'internal'
  if (name === 'AbortError') return 'cancelled'
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return 'permission'
  if (
    [
      'QuotaExceededError',
      'DatabaseClosedError',
      'TransactionInactiveError',
      'ReadOnlyError',
      'VersionError',
      'OpenFailedError',
      'InvalidStateError',
      'UnknownError',
    ].includes(name)
  )
    return 'storage'
  if (name === 'NetworkError' || name === 'TimeoutError' || name === 'FetchError') return 'network'
  if (
    name === 'SyntaxError' ||
    name === 'DataError' ||
    name === 'ConstraintError' ||
    name === 'ValidationError' ||
    name === 'TypeError'
  )
    return 'validation'
  return 'internal'
}

/** Fire-and-forget infrastructure boundary; telemetry cannot change the product result. */
export function reportTelemetryError(
  controller: Pick<ApplicationTelemetryController, 'record'> | null | undefined,
  error: unknown,
  providerId: TelemetryProviderId = 'application',
  errorClass = classifyTelemetryError(error),
): void {
  try {
    void controller
      ?.record('application.error', 1, undefined, { providerId, errorClass })
      .catch(() => undefined)
  } catch {
    /* A missing or failing diagnostic sink never fails the operation. */
  }
}
