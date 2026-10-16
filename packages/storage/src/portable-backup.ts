import type { PersistentSettingsPort, ServiceScope } from './service-contract'

/** Application-neutral portable backup. Never includes tab/session data. */
export interface PortableBackupRow {
  readonly store: string
  readonly key: string
  /** JSON-safe source codec, owned by the provider; ordinary JSON is allowed. */
  readonly value: unknown
}
/** Immutable, duplicate-free staged rows. Order is ascending canonical
 * JSON.stringify([store,key]); filtering a store preserves that order. */
export interface PortableBackupReader {
  readonly count: number
  readRows(store?: string): AsyncIterable<PortableBackupRow>
  get(store: string, key: string): Promise<PortableBackupRow | undefined>
}
export interface PortableBackupIndexedPort {
  readonly scope: ServiceScope
  readonly schemaVersion: number
  readonly stores: readonly string[]
  /** Exact physical table primary-key/index layout; validated on restore. */
  readonly schema: Record<string, { readonly primaryKey: string; readonly indexes: readonly string[] }>
  /** Cursor/page-backed iterator, not a whole-database getAll. */
  readRows(pageSize: number): AsyncIterable<PortableBackupRow>
  /** After a complete read, recheck its original persisted snapshot and owner
   * following caller awaits. Must not silently pin a newer source revision. */
  assertSnapshotCurrent?(): Promise<void>
  /** Counts for progress before starting an export; scoped to verified owner. */
  countRows(): Promise<Record<string, number>>
  /** Optional for legacy operator ports; application restore requires this preflight. */
  validateRows?(rows: readonly PortableBackupRow[]): Promise<void> | void
  /** Must replace owned records in ONE IndexedDB transaction or leave them unchanged. */
  restoreAtomically(rows: readonly PortableBackupRow[]): Promise<void>
  validateStagedRows?(reader: PortableBackupReader): Promise<void> | void
  restoreStagedAtomically?(reader: PortableBackupReader): Promise<void>
}
export interface PortableBackupPorts<T> {
  readonly scope: ServiceScope
  readonly settings?: PersistentSettingsPort<T>
  readonly indexeddb?: PortableBackupIndexedPort
}
