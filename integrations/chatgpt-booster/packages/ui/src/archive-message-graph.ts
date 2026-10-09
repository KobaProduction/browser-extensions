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
    const chain: string[] = []
    const seen = new Set<string>()
    let current: string | null = id
    while (current && byId.has(current) && !lanes.has(current) && !seen.has(current)) {
      seen.add(current)
      chain.push(current)
      current = byId.get(current)?.record.parentId ?? null
    }
    // A malformed cycle is terminated at the first repeated ID; no fake edge is added.
    let lane = current ? (lanes.get(current) ?? 0) : 0
    for (let i = chain.length - 1; i >= 0; i--) {
      const nodeId = chain[i]!
      const parentId = byId.get(nodeId)?.record.parentId
      if (parentId) {
        const siblings = children.get(parentId) ?? []
        const siblingIndex = siblings.indexOf(nodeId)
        if (siblingIndex > 0) lane = Math.min(3, lane + siblingIndex)
      }
      lanes.set(nodeId, lane)
    }
    return lanes.get(id) ?? 0
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
