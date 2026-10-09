/** Application-level paging rules for a descending, linear archive source.
 * Provider-specific IDs, timestamps, credentials, DTOs and persistence stay at adapters.
 * Nonlinear branch graphs (including ChatGPT lineages) require an explicit source projection.
 */
export type ArchiveScanMode = 'recent' | 'incremental' | 'backfill'

export interface ArchivePageScan<T> {
  mode: ArchiveScanMode
  records: readonly T[]
  knownKeys: ReadonlySet<string>
  keyOf(record: T): string
  timestampOf?(record: T): number | null
  fromInclusive?: number | null
  toExclusive?: number | null
  remaining: number
}

export interface ArchivePageSelection<T> {
  /** Number consumed in the upstream page (offset must advance by this, not the batch size). */
  consumed: number
  /** Number of records satisfying the mode/date selection, including known in 'recent'. */
  matched: number
  /** Newly discovered records. Caller persists before advancing its durable checkpoint. */
  added: T[]
  /** Stop at first known record in incremental, or first older-than-range record. */
  boundaryReached: boolean
}

export function selectArchivePage<T>(input: ArchivePageScan<T>): ArchivePageSelection<T> {
  if (!Number.isSafeInteger(input.remaining) || input.remaining < 0)
    throw new Error('Invalid archive page selection limit')
  if ((input.fromInclusive != null || input.toExclusive != null) && !input.timestampOf)
    throw new Error('Timestamp accessor required for date-filtered selection')
  const seenNew = new Set<string>()
  const added: T[] = []
  let consumed = 0, matched = 0, boundaryReached = false
  for (const item of input.records) {
    if (matched >= input.remaining) break
    consumed++
    if (input.fromInclusive != null || input.toExclusive != null) {
      const time = input.timestampOf!(item)
      if (time === null || !Number.isFinite(time))
        throw new Error('Invalid archive source timestamp')
      if (input.toExclusive != null && time >= input.toExclusive) continue
      if (input.fromInclusive != null && time < input.fromInclusive) {
        boundaryReached = true
        break
      }
    }
    const key = input.keyOf(item)
    if (!key) throw new Error('Empty archive source record identity')
    const present = input.knownKeys.has(key) || seenNew.has(key)
    if (input.mode === 'incremental' && present) {
      boundaryReached = true
      break
    }
    if (input.mode === 'backfill' && present) continue
    if (!present) { seenNew.add(key); added.push(item) }
    matched++
  }
  return { consumed, matched, added, boundaryReached }
}

export {readArchiveMedia} from './media'
export type {ArchiveMediaReadOptions,ArchiveMediaResult} from './media'
