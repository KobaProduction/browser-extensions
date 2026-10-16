export interface ArchiveRecordListProps<T> {
  readonly records: readonly T[]
  readonly recordKey: (record: T) => string | number
  readonly messageId: (record: T) => string | number
  readonly targetMessageId?: string | number | null
  readonly selectable?: boolean
  readonly selectedIds?: ReadonlySet<string>
  readonly selectionLabel?: (record: T) => string
  readonly disabled?: boolean
}
