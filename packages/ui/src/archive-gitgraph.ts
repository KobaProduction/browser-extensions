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
  unresolved: number
}

/** GitGraph's import format expects newest-first commits with exact parent hashes. */
export function archiveGitgraphData(thread: ArchiveThreadView): GitgraphArchiveData {
  const all = thread.turns.flatMap((turn) => [...turn.messages, ...turn.details])
  const byId = new Map<string, ArchiveItemView>()
  for (const item of all)
    if (item.record.messageId && !byId.has(item.record.messageId))
      byId.set(item.record.messageId, item)
  const display = all.filter((item) => item.kind === 'user' || item.kind === 'answer')
  const chosen = new Map(display.map((item) => [item.record.messageId, item]))
  const parents = new Map<string, string | null>()
  let unresolved = 0
  for (const item of display) {
    let id = item.record.parentId
    const seen = new Set([item.record.messageId])
    while (id && !seen.has(id) && byId.has(id) && !chosen.has(id)) {
      seen.add(id)
      id = byId.get(id)?.record.parentId ?? null
    }
    if (id && seen.has(id)) id = null
    if (id && !chosen.has(id)) {
      unresolved++
      id = null
    }
    parents.set(item.record.messageId, id)
  }
  // Preserve all records, but order them as a DAG (not by ingestion time).
  const descendants = new Map<string, string[]>()
  const indegree = new Map(display.map((item) => [item.record.messageId, 0]))
  for (const [child, parent] of parents) {
    if (!parent) continue
    descendants.set(parent, [...(descendants.get(parent) ?? []), child])
    indegree.set(child, (indegree.get(child) ?? 0) + 1)
  }
  const pending = display.filter((item) => indegree.get(item.record.messageId) === 0)
  const ordered: ArchiveItemView[] = []
  while (pending.length) {
    const item = pending.shift()!
    ordered.push(item)
    for (const child of descendants.get(item.record.messageId) ?? []) {
      const count = (indegree.get(child) ?? 0) - 1
      indegree.set(child, count)
      if (!count) pending.push(chosen.get(child)!)
    }
  }
  // A corrupted cycle must not make GitGraph hang or render invented edges.
  for (const item of display) {
    if (ordered.includes(item)) continue
    parents.set(item.record.messageId, null)
    ordered.push(item)
    unresolved++
  }
  const referenced = new Set([...parents.values()].filter((id): id is string => Boolean(id)))
  return {
    commits: ordered.reverse().map((item) => ({
      hash: item.record.messageId,
      parents: parents.get(item.record.messageId) ? [parents.get(item.record.messageId)!] : [],
      author: { name: item.kind === 'user' ? 'You' : 'Assistant', email: '' },
      // GitGraph imports only commits reachable from named refs.
      // Give each saved terminal branch a ref; never invent a merge.
      refs: referenced.has(item.record.messageId) ? [] : [`path-${item.record.messageId}`],
      subject: item.text.slice(0, 180),
    })),
    byId,
    unresolved,
  }
}
