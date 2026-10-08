import type { ArchiveItemView, ArchiveThreadView } from '@chatgpt-booster/core'

export interface ArchiveMessageNode {
  id: string
  parentId: string | null
  kind: 'user' | 'assistant'
  lane: number
  siblingIndex: number
  siblingCount: number
  parentKnown: boolean
}

/**
 * Message graph evidence, not an inferred chronological chain.
 * A fork exists only when multiple distinct message IDs share an explicit parent.
 * Tool/internal records are not graph nodes, but may appear in the parent chain.
 */
export function archiveMessageGraph(thread: ArchiveThreadView): Map<string, ArchiveMessageNode> {
  const all = [...thread.turns].flatMap((turn) => [...turn.messages, ...turn.details])
  const byId = new Map<string, ArchiveItemView>()
  for (const item of all)
    if (item.record.messageId && !byId.has(item.record.messageId))
      byId.set(item.record.messageId, item)

  const children = new Map<string, string[]>()
  const messages = all.filter((item) => item.kind === 'user' || item.kind === 'answer')
  for (const item of messages) {
    const parentId = item.record.parentId
    if (!parentId || parentId === item.record.messageId) continue
    const siblings = children.get(parentId) ?? []
    if (!siblings.includes(item.record.messageId)) siblings.push(item.record.messageId)
    children.set(parentId, siblings)
  }

  const lanes = new Map<string, number>()
  const visited = new Set<string>()
  function laneFor(id: string): number {
    const cached = lanes.get(id)
    if (cached !== undefined) return cached
    if (visited.has(id)) return 0 // Cycles must not hide records.
    visited.add(id)
    const parentId = byId.get(id)?.record.parentId
    let lane = parentId && byId.has(parentId) ? laneFor(parentId) : 0
    if (parentId) {
      const siblings = children.get(parentId) ?? []
      const index = siblings.indexOf(id)
      if (index > 0) lane = Math.min(3, lane + index)
    }
    visited.delete(id)
    lanes.set(id, lane)
    return lane
  }

  const result = new Map<string, ArchiveMessageNode>()
  for (const item of messages) {
    const { messageId, parentId, messageKey } = item.record
    const siblings = parentId ? (children.get(parentId) ?? []) : []
    result.set(messageKey, {
      id: messageId,
      parentId,
      kind: item.kind === 'user' ? 'user' : 'assistant',
      lane: laneFor(messageId),
      siblingIndex: Math.max(0, siblings.indexOf(messageId)),
      siblingCount: Math.max(1, siblings.length),
      parentKnown: Boolean(parentId && byId.has(parentId)),
    })
  }
  return result
}
