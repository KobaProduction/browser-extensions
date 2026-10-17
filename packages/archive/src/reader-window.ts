export const ARCHIVE_READER_MAX_RECORDS = 320
export const ARCHIVE_READER_PAGE_SIZE = 160
export type ArchiveReadingDirection = 'older' | 'newer'

/** Retain adjacent source records without duplicates or unbounded reader memory. */
export function mergeArchiveReaderRecords<T>(
  current: readonly T[],
  incoming: readonly T[],
  direction: ArchiveReadingDirection,
  options: {
    key: (record: T) => string | number
    compare: (left: T, right: T) => number
    maximum?: number
  },
): { records: T[]; trimmed: boolean } {
  const maximum = options.maximum ?? ARCHIVE_READER_MAX_RECORDS
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw Error('Invalid archive reader window size')
  const byId = new Map([...current, ...incoming].map((record) => [options.key(record), record]))
  const ordered = [...byId.values()].sort(options.compare)
  return {
    records: direction === 'older' ? ordered.slice(0, maximum) : ordered.slice(-maximum),
    trimmed: ordered.length > maximum,
  }
}
