/** Pure, provider-neutral page reconciliation. The caller owns page fetching,
 * source validation, persistence, checkpoints, media and owner permissions.
 * `index` is mutable draft state and is never a durable transaction commit.
 */
export type ArchivePageMode = 'snapshot' | 'recent' | 'incremental' | 'backfill'
export type ArchivePageStopReason = 'known_record' | 'range_end' | 'target_reached' | null
export interface ArchivePageFoldOptions<RecordType, Id extends string | number> {
  mode: ArchivePageMode
  identity: (record: RecordType) => Id
  /** An external durable key index, read only. No need to materialize it as a Map. */
  isKnown?: (id: Id) => boolean
  /** Maximum number of *accepted* records this page can consume; 0 is valid. */
  remaining?: number
  /** E.g. records more recent than the requested window. */
  skip?: (record: RecordType) => boolean
  /** E.g. the first message older than the requested window. */
  stop?: (record: RecordType) => boolean
  /** Snapshot mode must not silently replace conflicting native duplicates. */
  same?: (known: RecordType, incoming: RecordType) => boolean
}
export interface ArchivePageFoldResult {
  consumed: number
  matched: number
  inserted: number
  skipped: number
  stopReason: ArchivePageStopReason
}
/** Exact-N and source snapshot use the same identity/deduplication boundary.
 * Recent counts existing records, incremental stops at the first known ID,
 * backfill skips existing IDs, while snapshot rejects conflicting duplicates.
 */
export declare function foldArchivePage<RecordType, Id extends string | number>(
  records: readonly RecordType[],
  index: Map<Id, RecordType>,
  options: ArchivePageFoldOptions<RecordType, Id>,
): ArchivePageFoldResult
