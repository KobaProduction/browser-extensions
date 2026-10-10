import type { ArchiveItemView, ArchiveThreadView } from '@chatgpt-booster/core'

export interface ArchiveForkChoice {
  id: string
  variants: { key: string; messageId: string; text: string; timestamp: number | null }[]
}

/** Only explicit sibling user messages form an editable-prompt fork. */
export function archiveForkChoices(thread: ArchiveThreadView): ArchiveForkChoice[] {
  const groups = new Map<string, ArchiveItemView[]>()
  const dedup = new Set<string>()
  for (const turn of thread.turns)
    for (const item of turn.messages) {
      const { messageId, parentId } = item.record
      if (item.kind !== 'user' || !parentId || !messageId || dedup.has(messageId)) continue
      dedup.add(messageId)
      const group = groups.get(parentId) ?? []
      group.push(item)
      groups.set(parentId, group)
    }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([id, items]) => ({
      id,
      variants: items.map((item) => ({
        key: item.record.messageKey,
        messageId: item.record.messageId,
        text: item.text,
        timestamp: item.record.createTime,
      })),
    }))
}
