/** Provider adapters supply observed relationships and boundary evidence. */
export interface ArchiveGraphNode {
  readonly id: string
  readonly parentId: string | null
  readonly parentKnown: boolean
}
export interface ArchiveIntegrityEvidence {
  readonly startReached: boolean
  readonly endReached: boolean
  readonly headId: string | null
}
export interface ArchiveConversationIntegrity {
  readonly start: 'verified' | 'unknown'
  readonly end: 'verified' | 'unknown' | 'missing'
  readonly chain: 'verified' | 'gaps' | 'unknown'
  readonly firstMessageId?: string | null
  readonly lastMessageId?: string | null
  readonly roots: readonly string[]
  readonly tips: readonly string[]
  readonly branches: readonly { parentId: string; messageIds: readonly string[] }[]
  readonly issues: readonly {
    messageId: string
    parentId: string | null
    reason:
      | 'missing-parent'
      | 'cycle'
      | 'unverified-root'
      | 'missing-head'
      | 'disconnected'
      | 'duplicate-id'
  }[]
}
/** No numeric-ID or source-order inference: only explicit parent relationships. */
export function conversationIntegrityFromGraph(
  nodes: readonly ArchiveGraphNode[],
  evidence: ArchiveIntegrityEvidence,
): ArchiveConversationIntegrity {
  const byId = new Map<string, ArchiveGraphNode>(),
    children = new Map<string, string[]>(),
    roots: string[] = []
  const issues: Array<ArchiveConversationIntegrity['issues'][number]> = []
  for (const node of nodes) {
    if (
      !node.id ||
      typeof node.id !== 'string' ||
      (node.parentId !== null && typeof node.parentId !== 'string') ||
      typeof node.parentKnown !== 'boolean'
    )
      throw Error('Invalid archive graph node')
    if (byId.has(node.id))
      issues.push({ messageId: node.id, parentId: node.parentId, reason: 'duplicate-id' })
    else byId.set(node.id, node)
  }
  for (const node of byId.values()) {
    if (!node.parentKnown) issues.push({ messageId: node.id, parentId: null, reason: 'unverified-root' })
    else if (node.parentId === null) roots.push(node.id)
    else {
      const list = children.get(node.parentId) ?? []
      list.push(node.id)
      children.set(node.parentId, list)
      if (!byId.has(node.parentId))
        issues.push({ messageId: node.id, parentId: node.parentId, reason: 'missing-parent' })
    }
  }
  const complete = new Set<string>(),
    cycles = new Set<string>()
  for (const node of byId.values()) {
    const visited = new Set<string>()
    let cursor: string | null = node.id
    while (cursor && byId.has(cursor) && !complete.has(cursor)) {
      if (visited.has(cursor)) {
        cycles.add(cursor)
        break
      }
      visited.add(cursor)
      const parent: ArchiveGraphNode | undefined = byId.get(cursor)
      if (!parent) break
      cursor = parent.parentKnown ? parent.parentId : null
    }
    for (const id of visited) complete.add(id)
  }
  for (const id of cycles)
    issues.push({ messageId: id, parentId: byId.get(id)?.parentId ?? null, reason: 'cycle' })
  // Multiple explicit roots are separate observed chains, not one verified
  // conversation. Unknown relationships alone stay unknown, never invented gaps.
  for (const id of roots.slice(1)) issues.push({ messageId: id, parentId: null, reason: 'disconnected' })
  if (evidence.headId && !byId.has(evidence.headId))
    issues.push({ messageId: evidence.headId, parentId: null, reason: 'missing-head' })
  const start = roots.length || evidence.startReached ? 'verified' : 'unknown'
  const end = evidence.headId
    ? byId.has(evidence.headId)
      ? evidence.endReached
        ? 'verified'
        : 'unknown'
      : 'missing'
    : 'unknown'
  const knownGaps = issues.some((issue) => issue.reason !== 'unverified-root')
  return {
    start,
    end,
    chain: knownGaps
      ? 'gaps'
      : byId.size && start === 'verified' && end === 'verified' && !issues.length
        ? 'verified'
        : 'unknown',
    firstMessageId: roots.length === 1 ? (roots[0] ?? null) : null,
    lastMessageId: evidence.headId && byId.has(evidence.headId) ? evidence.headId : null,
    roots,
    tips: [...byId.keys()].filter((id) => !children.has(id)),
    branches: [...children]
      .filter(([, ids]) => ids.length > 1)
      .map(([parentId, messageIds]) => ({ parentId, messageIds })),
    issues,
  }
}

export interface LinearArchiveEvidence {
  readonly savedCount: number
  readonly reportedCount: number | null
  readonly firstId: string | null
  readonly lastId: string | null
  readonly startReached: boolean
  readonly endReached: boolean
  readonly countStable: boolean
  readonly current: boolean
}
/** Linear providers need observed source boundaries/counts, never adjacent IDs. */
export function linearArchiveIntegrity(evidence: LinearArchiveEvidence): ArchiveConversationIntegrity {
  if (
    !Number.isSafeInteger(evidence.savedCount) ||
    evidence.savedCount < 0 ||
    (evidence.reportedCount !== null &&
      (!Number.isSafeInteger(evidence.reportedCount) || evidence.reportedCount < 0))
  )
    throw Error('Invalid archive counts')
  const current = evidence.current && evidence.countStable
  const start =
    current && evidence.startReached && (evidence.savedCount === 0 || !!evidence.firstId)
      ? 'verified'
      : 'unknown'
  const end =
    current && evidence.endReached && (evidence.savedCount === 0 || !!evidence.lastId)
      ? 'verified'
      : 'unknown'
  const sameCount = evidence.reportedCount !== null && evidence.savedCount === evidence.reportedCount
  return {
    start,
    end,
    chain: current && sameCount && start === 'verified' && end === 'verified' ? 'verified' : 'unknown',
    firstMessageId: evidence.firstId,
    lastMessageId: evidence.lastId,
    roots: evidence.firstId ? [evidence.firstId] : [],
    tips: evidence.lastId ? [evidence.lastId] : [],
    branches: [],
    issues: [],
  }
}
