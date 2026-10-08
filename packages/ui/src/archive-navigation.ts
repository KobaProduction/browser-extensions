import type { ArchiveConversationView } from './mount'

export interface ArchiveTreeRow {
  conversation: ArchiveConversationView
  depth: number
  branched: boolean
  sourceMissing: boolean
}

/** Group-local forest. Missing parents and malformed cycles are shown, never dropped. */
export function archiveConversationForest(
  conversations: readonly ArchiveConversationView[],
  query = '',
  projectLabel = '',
): ArchiveTreeRow[] {
  const byId = new Map(
    conversations.map((conversation) => [conversation.conversationId, conversation]),
  )
  const children = new Map<string, ArchiveConversationView[]>()
  const roots: ArchiveConversationView[] = []
  for (const conversation of conversations) {
    const parentId = conversation.branchSourceConversationId
    const parent = parentId && parentId !== conversation.conversationId ? byId.get(parentId) : null
    if (!parent) {
      roots.push(conversation)
      continue
    }
    const siblings = children.get(parentId as string) ?? []
    siblings.push(conversation)
    children.set(parentId as string, siblings)
  }

  const term = query.trim().toLocaleLowerCase()
  const keep = new Set<string>()
  if (term) {
    for (const conversation of conversations) {
      if (
        !(
          (conversation.title ?? '').toLocaleLowerCase().includes(term) ||
          projectLabel.toLocaleLowerCase().includes(term)
        )
      )
        continue
      const visited = new Set<string>()
      let ancestor: ArchiveConversationView | undefined = conversation
      while (ancestor && !visited.has(ancestor.conversationId)) {
        visited.add(ancestor.conversationId)
        keep.add(ancestor.conversationId)
        ancestor = ancestor.branchSourceConversationId
          ? byId.get(ancestor.branchSourceConversationId)
          : undefined
      }
    }
  }
  const rows: ArchiveTreeRow[] = []
  const visited = new Set<string>()
  function traverse(start: ArchiveConversationView) {
    const stack = [{ conversation: start, depth: 0 }]
    while (stack.length) {
      const current = stack.pop()
      if (!current) continue
      const { conversation, depth } = current
      const id = conversation.conversationId
      if (visited.has(id)) continue
      visited.add(id)
      if (!term || keep.has(id)) {
        const sourceId = conversation.branchSourceConversationId
        rows.push({
          conversation,
          depth,
          branched: Boolean(sourceId),
          sourceMissing: Boolean(sourceId && (!byId.has(sourceId) || sourceId === id)),
        })
      }
      const descendants = children.get(id) ?? []
      for (let index = descendants.length - 1; index >= 0; index--)
        stack.push({ conversation: descendants[index]!, depth: depth + 1 })
    }
  }
  for (const root of roots) traverse(root)
  // Cyclic graphs may have no roots. They still need a selectable, finite representation.
  for (const conversation of conversations)
    if (!visited.has(conversation.conversationId)) traverse(conversation)
  return rows
}

export type ArchiveReadingOrder = 'chronological' | 'newest-first'
export const ARCHIVE_INITIAL_TURNS = 40
export const ARCHIVE_TURN_BATCH = 40

/** Both orders start at the latest recorded exchange, without reversing the source thread. */
export function archiveTurnWindow<T>(
  turns: readonly T[],
  visibleCount: number,
  order: ArchiveReadingOrder,
): T[] {
  const latest = turns.slice(Math.max(0, turns.length - Math.max(1, visibleCount)))
  return order === 'newest-first' ? latest.reverse() : latest
}

/** A bounded navigation sample for very long chats. Always retain endpoints and known forks. */
export function archiveNavigatorSample<T>(
  items: readonly T[],
  isFork: (item: T) => boolean,
  maximum = 160,
): { item: T; index: number }[] {
  if (!items.length) return []
  const selected = new Set<number>([0, items.length - 1])
  for (let i = 0; i < items.length; i++) if (isFork(items[i]!)) selected.add(i)
  const remaining = Math.max(0, maximum - selected.size)
  for (let slot = 1; slot <= remaining; slot++)
    selected.add(Math.round((slot * (items.length - 1)) / (remaining + 1)))
  return [...selected].sort((a, b) => a - b).map((index) => ({ item: items[index]!, index }))
}

/** Fisheye chronology: endpoints stay fixed; nearby checkpoints get more room. */
export function archiveTimelinePosition(position: number, focus: number, exponent = 1.65): number {
  const p = Math.max(0, Math.min(1, position))
  const f = Math.max(0.05, Math.min(0.95, focus))
  if (p <= f) return f * (p / f) ** exponent
  return 1 - (1 - f) * ((1 - p) / (1 - f)) ** exponent
}

/** Connect displayed checkpoints only through fully observed parent-ID chains. */
export function archiveNavigatorEdges(
  parents: ReadonlyMap<string, string | null>,
  checkpoints: readonly { id: string; index: number }[],
): { from: number; to: number }[] {
  const selected = new Map(checkpoints.map((node) => [node.id, node.index]))
  const edges: { from: number; to: number }[] = []
  for (const node of checkpoints) {
    let parent = parents.get(node.id) ?? null
    const traversed = new Set<string>([node.id])
    while (parent && !traversed.has(parent) && parents.has(parent)) {
      const index = selected.get(parent)
      if (index !== undefined) {
        edges.push({ from: index, to: node.index })
        break
      }
      traversed.add(parent)
      parent = parents.get(parent) ?? null
    }
  }
  return edges
}
