import type { PersistentSettingsPort, ServiceScope } from './service-contract'

/** Application-neutral portable backup. Never includes tab/session data. */
export interface PortableBackupRow {
  readonly store: string
  readonly key: string
  /** JSON-safe source codec, owned by the provider; ordinary JSON is allowed. */
  readonly value: unknown
}
export interface PortableBackupIndexedPort {
  readonly scope: ServiceScope
  readonly schemaVersion: number
  readonly stores: readonly string[]
  /** Exact physical table primary-key/index layout; validated on restore. */
  readonly schema: Record<string, { readonly primaryKey: string; readonly indexes: readonly string[] }>
  /** Cursor/page-backed iterator, not a whole-database getAll. */
  readRows(pageSize: number): AsyncIterable<PortableBackupRow>
  /** Counts for progress before starting an export; scoped to verified owner. */
  countRows(): Promise<Record<string, number>>
  /** Must replace owned records in ONE IndexedDB transaction or leave them unchanged. */
  restoreAtomically(rows: readonly PortableBackupRow[]): Promise<void>
}
export interface PortableBackupPorts<T> {
  readonly scope: ServiceScope
  readonly settings?: PersistentSettingsPort<T>
  readonly indexeddb?: PortableBackupIndexedPort
}
