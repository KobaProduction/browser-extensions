import type { VkMessage } from './types'

/**
 * Bounded, read-only projection of already archived VK messages.
 * Never loads media files or exposes persistence references to a UI widget.
 * The archive engine keeps rows in ascending (date, id) order.
 */
export function selectVkArchivePreview(
  rows: readonly VkMessage[],
  options: { limit: number; query?: string },
): { messages: VkMessage[]; matching: number } {
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(240, Math.floor(options.limit)))
    : 80
  const query = (options.query ?? '').trim().toLocaleLowerCase('ru')
  const selected: VkMessage[] = []
  let matching = 0

  // Search scans archived text only. Render at most the requested number of
  // records, most recent first, without copying the complete archive.
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (!row || (query && !(row.text ?? '').toLocaleLowerCase('ru').includes(query))) continue
    matching++
    if (selected.length < limit) selected.push(row)
  }
  selected.reverse()
  return { messages: selected, matching }
}
