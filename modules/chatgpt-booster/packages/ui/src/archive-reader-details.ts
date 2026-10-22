import type { ArchiveItemView } from '@chatgpt-booster/core'

/** Readability is independent of capture policy; originals remain available on demand. */
export function archiveReaderDetails<T extends Pick<ArchiveItemView, 'kind' | 'text'>>(
  items: readonly T[],
  includeInternal: boolean,
): readonly T[] {
  return includeInternal
    ? items
    : items.filter(
        (item) =>
          item.kind === 'tool_call' ||
          item.kind === 'tool_result' ||
          (item.kind === 'reasoning' && item.text.trim().length > 0),
      )
}
