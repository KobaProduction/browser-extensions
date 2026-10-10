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

import { foldArchivePage } from './page-fold'

export function selectArchivePage<T>(input: ArchivePageScan<T>): ArchivePageSelection<T> {
  if (!Number.isSafeInteger(input.remaining) || input.remaining < 0)
    throw new Error('Invalid archive page selection limit')
  if ((input.fromInclusive != null || input.toExclusive != null) && !input.timestampOf)
    throw new Error('Timestamp accessor required for date-filtered selection')

  // New rows live in a temporary page draft until the provider acknowledges
  // file persistence. The complete previous archive remains in the immutable
  // knownKeys port; no full-history in-memory Map is reconstructed.
  const added = new Map<string, T>()
  const timestamp = (record: T) => {
    const value = input.timestampOf?.(record)
    if (value == null || !Number.isFinite(value)) throw new Error('Invalid archive source timestamp')
    return value
  }
  const toExclusive = input.toExclusive
  const fromInclusive = input.fromInclusive
  const result = foldArchivePage(input.records, added, {
    mode: input.mode,
    identity: (record) => {
      const id = input.keyOf(record)
      if (!id) throw new Error('Empty archive source record identity')
      return id
    },
    isKnown: (id) => input.knownKeys.has(id),
    remaining: input.remaining,
    ...(toExclusive != null ? { skip: (record: T) => timestamp(record) >= toExclusive } : {}),
    ...(fromInclusive != null ? { stop: (record: T) => timestamp(record) < fromInclusive } : {}),
  })
  return {
    consumed: result.consumed,
    matched: result.matched,
    added: [...added.values()],
    boundaryReached: result.stopReason === 'known_record' || result.stopReason === 'range_end',
  }
}
