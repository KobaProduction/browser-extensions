/** Application recovery contracts. Providers own schemas, codecs and owner verification. */
export type BackupSectionKind = 'settings' | 'session' | 'indexeddb'
export interface BackupSectionInfo {
  readonly id: string
  readonly label: string
  readonly kind: BackupSectionKind
  readonly available: boolean
  readonly reason?: string
}
export interface BackupScope {
  readonly productId: string
  readonly channel: 'dev' | 'prod'
  readonly installationId?: string
  readonly ownerId?: string
}
export interface BackupRow {
  readonly key: string
  readonly value: unknown
}
/** Sealed, immutable section rows. Iteration is strictly ascending by key. */
export interface BackupRowReader {
  readonly count: number
  rows(): AsyncIterable<BackupRow>
  get(key: string): Promise<BackupRow | undefined>
}
/** Caller-owned temporary output; commit publishes only a fully validated file. */
export interface BackupFileOutput {
  readonly writable: WritableStream<Uint8Array<ArrayBuffer>>
  commit(): Promise<void>
  abort(reason?: unknown): Promise<void>
}
/** Opaque local recovery identity; never contains records or credentials. */
export interface BackupRecoveryReference {
  readonly id: string
  readonly scope: BackupScope
}
export interface BackupRecoveryInfo {
  readonly id: string
  readonly createdAt: string
  readonly sections: readonly BackupSectionInfo[]
  readonly canRollback: boolean
  readonly reason?: string
}
export interface ApplicationBackupSource extends BackupSectionInfo {
  readonly scope: BackupScope
  readonly schema: unknown
  readRows(): AsyncIterable<BackupRow>
  /** Must verify all values and relations without changing the destination. */
  validateRows(rows: readonly BackupRow[]): void | Promise<void>
  /** Replace only this section, atomically within its storage backend. */
  restoreRows(rows: readonly BackupRow[]): Promise<void>
  validateStagedRows?(reader: BackupRowReader): void | Promise<void>
  restoreStagedRows?(reader: BackupRowReader): Promise<void>
}
export type ApplicationBackupProvider = () => Promise<readonly ApplicationBackupSource[]>
export interface BackupInspection {
  readonly createdAt: string
  readonly sections: readonly (BackupSectionInfo & { readonly rows: number })[]
}
export interface ApplicationBackupController {
  status(): Promise<readonly BackupSectionInfo[]>
  export(selected: readonly string[]): Promise<Blob>
  exportTo?(selected: readonly string[], output: BackupFileOutput): Promise<void>
  /** A target can obtain its file sink synchronously on the user's gesture. */
  save?(selected: readonly string[]): Promise<Blob | null>
  recoveries?(): Promise<readonly BackupRecoveryInfo[]>
  retryRollback?(jobId: string): Promise<void>
  discardRecovery?(jobId: string): Promise<void>
  cancel?(): void
  inspect(file: Blob): Promise<BackupInspection>
  restore(file: Blob, selected: readonly string[]): Promise<void>
  subscribe(listener: () => void): () => void
}
export const APPLICATION_BACKUP = Symbol('application-backup')
