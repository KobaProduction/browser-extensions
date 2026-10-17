export interface ArchiveExportMessageSummary {
  readonly id: string
  readonly timestampMs: number | null
  readonly author: string
  readonly role?: string | null
  readonly text: string
}
export interface ArchiveExportSelection {
  readonly mode: 'all' | 'dates' | 'last' | 'selected'
  readonly fromDate: string
  readonly throughDate: string
  readonly lastCount: number
}
export const defaultArchiveExportSelection = (): ArchiveExportSelection => ({
  mode: 'all',
  fromDate: '',
  throughDate: '',
  lastCount: 100,
})
function calendarBoundary(value: string, nextDay: boolean): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Некорректная дата')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year ?? 0, (month ?? 0) - 1, day ?? 0)
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day)
    throw Error('Некорректная дата')
  if (nextDay) date.setDate(date.getDate() + 1)
  return date.getTime()
}
/** Local calendar dates include both selected days. Unknown source times are never invented. */
export function archiveExportSelectionIds(
  messages: readonly ArchiveExportMessageSummary[],
  selection: ArchiveExportSelection,
  selectedIds: readonly string[] = [],
): readonly string[] | undefined {
  if (selection.mode === 'all') return undefined
  if (selection.mode === 'selected') return [...new Set(selectedIds)]
  const dated = messages.filter(
    (message) =>
      message.timestampMs !== null && Number.isFinite(message.timestampMs) && message.timestampMs > 0,
  )
  if (selection.mode === 'last') {
    if (!Number.isSafeInteger(selection.lastCount) || selection.lastCount < 1)
      throw Error('Укажите число сообщений больше нуля')
    return [...dated]
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
      .slice(-selection.lastCount)
      .map((message) => message.id)
  }
  if (!selection.fromDate && !selection.throughDate) throw Error('Укажите начало или конец периода')
  const from = selection.fromDate
    ? calendarBoundary(selection.fromDate, false)
    : Number.NEGATIVE_INFINITY
  const through = selection.throughDate
    ? calendarBoundary(selection.throughDate, true)
    : Number.POSITIVE_INFINITY
  if (from >= through) throw Error('Начало периода должно быть не позже конца')
  return dated
    .filter((message) => (message.timestampMs ?? 0) >= from && (message.timestampMs ?? 0) < through)
    .map((message) => message.id)
}
