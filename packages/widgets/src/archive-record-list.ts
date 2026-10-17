export interface ArchiveRecordListProps<T> {
  readonly records: readonly T[]
  readonly recordKey: (record: T) => string | number
  readonly messageId: (record: T) => string | number
  readonly targetMessageId?: string | number | null
  /** Providers with a narrower message surface may render its target outline themselves. */
  readonly highlightTarget?: boolean
  readonly selectable?: boolean
  /** Bubble transcripts need explicit vertical separation, including selection mode. */
  readonly spaced?: boolean
  readonly selectedIds?: ReadonlySet<string>
  readonly selectionLabel?: (record: T) => string
  readonly disabled?: boolean
}
