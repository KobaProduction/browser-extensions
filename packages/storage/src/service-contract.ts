/** Shared product/channel scope. Provider account verification stays at its adapter. */
export interface ServiceScope {
  readonly productId: string
  readonly channel: 'dev' | 'prod'
  readonly ownerId?: string
  readonly installationId?: string
}

export function assertServiceScope(scope: ServiceScope): ServiceScope {
  if (
    !/^[a-z][a-z0-9-]{1,63}$/.test(scope.productId) ||
    (scope.channel !== 'dev' && scope.channel !== 'prod') ||
    (scope.ownerId !== undefined && (!scope.ownerId || scope.ownerId.length > 256)) ||
    (scope.installationId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(scope.installationId))
  ) {
    throw new Error('Invalid product/channel/owner scope')
  }
  return scope
}

export function assertMatchingScope(expected: ServiceScope, actual: ServiceScope): void {
  assertServiceScope(expected)
  assertServiceScope(actual)
  if (
    expected.productId !== actual.productId ||
    expected.channel !== actual.channel ||
    expected.ownerId !== actual.ownerId ||
    expected.installationId !== actual.installationId
  ) {
    throw new Error('Backup product, channel, owner or installation mismatch')
  }
}

/** Runtime-independent lifecycle and persistence contracts, not database schema owners. */
export interface SessionStatePort {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  dispose(): void
}

export interface PersistentSettingsPort<T> {
  readonly scope: ServiceScope
  readonly schemaVersion: number
  /** Return only eligible portable settings; never include credentials or provider records. */
  exportSettings(): Promise<T>
  /** Reject unknown keys and unsupported values before mutation. */
  validateSettings(input: unknown): T
  /** Must replace one settings record atomically or fail leaving the prior value. */
  restoreSettingsAtomically(value: T): Promise<void>
}

export interface IndexedArchivePort {
  readonly scope: ServiceScope
  readonly schemaVersion: number
  exportArchive(): Promise<Blob>
  validateArchive(backup: Blob): Promise<void>
  restoreArchive(backup: Blob): Promise<void>
}

export interface FileOutputPort {
  write(name: string, bytes: Blob): Promise<void>
  read(): Promise<Blob>
}

export interface TelemetryPort {
  readonly scope: ServiceScope
  readonly available: boolean
  readonly enabled: boolean
  emit(name: string, count?: number, durationMs?: number): Promise<void>
}

/** Optional facets remain explicit. A module advertises only implemented capabilities. */
export interface ServiceCapabilityPorts<T> {
  readonly scope: ServiceScope
  readonly session?: SessionStatePort
  readonly settings?: PersistentSettingsPort<T>
  readonly archive?: IndexedArchivePort
  readonly output?: FileOutputPort
  readonly telemetry?: TelemetryPort
}
