/** Pure, provider-neutral page reconciliation. The caller owns page fetching,
 * source validation, persistence, checkpoints, media and owner permissions.
 * `index` is mutable draft state and is never a durable transaction commit.
 */
export type ArchivePageMode = 'snapshot' | 'recent' | 'incremental' | 'backfill'
export type ArchivePageStopReason = 'known_record' | 'range_end' | 'target_reached' | null
export interface ArchivePageFoldOptions<RecordType, Id extends string | number> {
  mode: ArchivePageMode
  identity: (record: RecordType) => Id
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
export function foldArchivePage<RecordType, Id extends string | number>(
  records: readonly RecordType[],
  index: Map<Id, RecordType>,
  options: ArchivePageFoldOptions<RecordType, Id>,
): ArchivePageFoldResult {
  const remaining = options.remaining ?? Infinity
  if (!(remaining === Infinity || (Number.isSafeInteger(remaining) && remaining >= 0)))
    throw new Error('Archive page remaining target must be a non-negative integer')
  const result: ArchivePageFoldResult = {
    consumed: 0, matched: 0, inserted: 0, skipped: 0, stopReason: null,
  }
  if (remaining === 0) { result.stopReason = 'target_reached'; return result }
  for (const row of records) {
    result.consumed++
    if (options.skip?.(row)) { result.skipped++; continue }
    if (options.stop?.(row)) { result.stopReason = 'range_end'; break }
    const id = options.identity(row)
    if ((typeof id === 'number' && !Number.isSafeInteger(id)) ||
        (typeof id === 'string' && !id)) throw new Error('Archive record identity is invalid')
    const existing = index.get(id)
    if (existing !== undefined) {
      if (options.mode === 'snapshot' && options.same && !options.same(existing, row))
        throw new Error('Conflicting native record with the same archive identity')
      if (options.mode === 'incremental') { result.stopReason = 'known_record'; break }
      if (options.mode === 'backfill' || options.mode === 'snapshot') {
        result.skipped++
        continue
      }
    } else {
      index.set(id, row)
      result.inserted++
    }
    result.matched++
    if (result.matched >= remaining) { result.stopReason = 'target_reached'; break }
  }
  return result
}
