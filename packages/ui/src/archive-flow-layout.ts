import type { ArchiveItemView, ArchiveThreadView } from '@chatgpt-booster/core'
import dagre from '@dagrejs/dagre'

export interface ArchiveFlowEntry {
  id: string
  key: string
  text: string
  kind: 'user' | 'assistant'
  parentId: string | null
}
export interface ArchiveFlowLayout {
  nodes: {
    id: string
    position: { x: number; y: number }
    data: ArchiveFlowEntry
    type: 'archive'
  }[]
  edges: { id: string; source: string; target: string; type: 'smoothstep' }[]
  disconnected: number
}
/** Layout only proven ancestry: no chronological fallback and no inferred parent edges. */
export function layoutArchiveFlow(thread: ArchiveThreadView, limit = 180): ArchiveFlowLayout {
  const items = thread.turns.flatMap((turn) => [...turn.messages, ...turn.details])
  const all = new Map<string, ArchiveItemView>()
  for (const item of items) if (item.record.messageId) all.set(item.record.messageId, item)
  const visible = items.filter((item) => item.kind === 'user' || item.kind === 'answer')
  const siblings = new Map<string, number>()
  for (const item of visible) {
    const parent = item.record.parentId
    if (parent) siblings.set(parent, (siblings.get(parent) ?? 0) + 1)
  }
  const step = Math.max(1, Math.ceil(visible.length / Math.max(1, limit)))
  const kept = visible.filter(
    (item, index) =>
      index === 0 ||
      index === visible.length - 1 ||
      index % step === 0 ||
      Boolean(item.record.parentId && (siblings.get(item.record.parentId) ?? 0) > 1),
  )
  const graph = new dagre.graphlib.Graph({ directed: true })
  graph.setGraph({ rankdir: 'TB', ranksep: 26, nodesep: 30, marginx: 8, marginy: 8 })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const item of kept) graph.setNode(item.record.messageId, { width: 34, height: 24 })
  const edges: ArchiveFlowLayout['edges'] = []
  const outgoing = new Map<string, Set<string>>()
  function wouldCycle(parent: string, child: string): boolean {
    const visited = new Set<string>()
    const stack = [child]
    while (stack.length) {
      const id = stack.pop()!
      if (id === parent) return true
      if (visited.has(id)) continue
      visited.add(id)
      for (const next of outgoing.get(id) ?? []) stack.push(next)
    }
    return false
  }
  let disconnected = 0
  const visibleIds = new Set(kept.map((item) => item.record.messageId))
  for (const item of kept) {
    const currentId = item.record.messageId
    let parent = item.record.parentId
    const seen = new Set([currentId])
    while (parent && all.has(parent) && !seen.has(parent)) {
      if (visibleIds.has(parent)) {
        if (!wouldCycle(parent, currentId)) {
          const children = outgoing.get(parent) ?? new Set<string>()
          children.add(currentId)
          outgoing.set(parent, children)
          graph.setEdge(parent, currentId)
          edges.push({
            id: `${parent}:${currentId}`,
            source: parent,
            target: currentId,
            type: 'smoothstep',
          })
        }
        break
      }
      seen.add(parent)
      parent = all.get(parent)?.record.parentId ?? null
    }
    if (!parent || seen.has(parent) || !all.has(parent)) disconnected++
  }
  dagre.layout(graph)
  return {
    nodes: kept.map((item) => {
      const data: ArchiveFlowEntry = {
        id: item.record.messageId,
        key: item.record.messageKey,
        text: item.text,
        kind: item.kind === 'user' ? 'user' : 'assistant',
        parentId: item.record.parentId,
      }
      const pos = graph.node(data.id)
      return { id: data.id, type: 'archive', position: { x: pos.x - 17, y: pos.y - 12 }, data }
    }),
    edges,
    disconnected,
  }
}
