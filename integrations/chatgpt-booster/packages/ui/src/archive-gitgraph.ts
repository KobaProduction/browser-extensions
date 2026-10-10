import type { ArchiveItemView, ArchiveThreadView } from '@chatgpt-booster/core'

export interface GitgraphArchiveCommit {
  hash: string
  parents: string[]
  author: { name: string; email: string }
  refs: string[]
  subject: string
}

export interface GitgraphArchiveData {
  commits: GitgraphArchiveCommit[]
  byId: Map<string, ArchiveItemView>
  missingParents: number
  cyclicParents: number
  unresolved: number
}

export interface GitgraphArchiveSegment {
  id: string
  commits: GitgraphArchiveCommit[]
  clipped: boolean
}

/**
 * Project the saved parent graph onto visible user/answer records. Traverse real
 * intermediate records, never substitute a chronological adjacency for parentId.
 */
export function archiveGitgraphData(thread: ArchiveThreadView): GitgraphArchiveData {
  const all = thread.turns.flatMap((turn) => [...turn.messages, ...turn.details])
  const byId = new Map<string, ArchiveItemView>()
  for (const item of all)
    if (item.record.messageId && !byId.has(item.record.messageId))
      byId.set(item.record.messageId, item)

  const display = all.filter(
    (item) => (item.kind === 'user' || item.kind === 'answer') && item.record.messageId,
  )
  const chosen = new Map(display.map((item) => [item.record.messageId, item]))
  const parents = new Map<string, string | null>()
  let missingParents = 0
  let cyclicParents = 0

  for (const item of display) {
    let id = item.record.parentId
    const seen = new Set([item.record.messageId])
    while (id && !seen.has(id) && byId.has(id) && !chosen.has(id)) {
      seen.add(id)
      id = byId.get(id)?.record.parentId ?? null
    }
    if (id && seen.has(id)) {
      cyclicParents++
      id = null
    } else if (id && !chosen.has(id)) {
      missingParents++
      id = null
    }
    parents.set(item.record.messageId, id)
  }

  // Topological order keeps every saved record, even if it arrived out of order.
  const descendants = new Map<string, string[]>()
  const indegree = new Map(display.map((item) => [item.record.messageId, 0]))
  for (const [child, parent] of parents) {
    if (!parent) continue
    descendants.set(parent, [...(descendants.get(parent) ?? []), child])
    indegree.set(child, (indegree.get(child) ?? 0) + 1)
  }
  const pending = display.filter((item) => indegree.get(item.record.messageId) === 0)
  const ordered: ArchiveItemView[] = []
  const emitted = new Set<string>()
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const item = pending[cursor]!
    ordered.push(item)
    emitted.add(item.record.messageId)
    for (const child of descendants.get(item.record.messageId) ?? []) {
      const count = (indegree.get(child) ?? 0) - 1
      indegree.set(child, count)
      if (count === 0) pending.push(chosen.get(child)!)
    }
  }
  // A genuine cycle must not hang the graph or masquerade as a valid edge.
  for (const item of display) {
    if (emitted.has(item.record.messageId)) continue
    parents.set(item.record.messageId, null)
    ordered.push(item)
    cyclicParents++
  }

  const referenced = new Set([...parents.values()].filter((id): id is string => Boolean(id)))
  return {
    commits: ordered.reverse().map((item) => ({
      hash: item.record.messageId,
      parents: parents.get(item.record.messageId) ? [parents.get(item.record.messageId)!] : [],
      author: { name: item.kind === 'user' ? 'You' : 'Assistant', email: '' },
      refs: referenced.has(item.record.messageId) ? [] : [`path-${item.record.messageId}`],
      subject: item.text.slice(0, 180),
    })),
    byId,
    missingParents,
    cyclicParents,
    unresolved: missingParents + cyclicParents,
  }
}

/**
 * Render weakly connected saved components sequentially rather than treating
 * unrelated roots as parallel Git branches. A viewport boundary may truncate
 * an edge; the boundary is reported, never silently joined to another root.
 */
export function archiveGitgraphSegments(
  commits: readonly GitgraphArchiveCommit[],
): GitgraphArchiveSegment[] {
  const visible = new Map(commits.map((commit) => [commit.hash, commit]))
  const roots = new Map<string, string>()
  const segments = new Map<string, GitgraphArchiveSegment>()
  const chronological = [...commits].reverse()

  function rootOf(id: string): string {
    const known = roots.get(id)
    if (known) return known
    let cursor = id
    const traversed: string[] = []
    const visited = new Set<string>()
    while (visible.has(cursor) && !visited.has(cursor)) {
      const saved = roots.get(cursor)
      if (saved) {
        cursor = saved
        break
      }
      visited.add(cursor)
      traversed.push(cursor)
      const parent = visible.get(cursor)?.parents[0]
      if (!parent || !visible.has(parent)) break
      cursor = parent
    }
    for (const part of traversed) roots.set(part, cursor)
    return cursor
  }

  for (const commit of chronological) {
    const root = rootOf(commit.hash)
    let segment = segments.get(root)
    if (!segment) {
      segment = { id: root, commits: [], clipped: false }
      segments.set(root, segment)
    }
    const parent = commit.parents[0]
    if (parent && !visible.has(parent)) segment.clipped = true
    segment.commits.push({
      ...commit,
      parents: parent && visible.has(parent) ? [parent] : [],
      refs: commit.refs,
    })
  }
  return [...segments.values()].map((segment) => {
    const linked = new Set(segment.commits.flatMap((commit) => commit.parents))
    return {
      ...segment,
      commits: segment.commits.reverse().map((commit) => ({
        ...commit,
        refs: linked.has(commit.hash) ? [] : [`path-${commit.hash}`],
      })),
    }
  })
}
