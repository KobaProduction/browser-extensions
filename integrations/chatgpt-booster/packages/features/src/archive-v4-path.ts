import type {
  ArchiveV4Message,
  ArchiveV4PathIndex,
  ArchiveV4PathResult,
  ArchiveV4PathStatus,
} from './archive-v4-store'

/** Source-native parent traversal: shared by materialized inspection and ID-only export. */
async function traceArchiveV4Parents<T>(
  selectedTipId: string,
  lookup: (messageId: string) => Promise<ArchiveV4Message | undefined>,
  project: (record: ArchiveV4Message) => T,
  maxDepth = 50_000,
  signal?: AbortSignal,
  onVisited?: (records: number) => void,
): Promise<{ status: ArchiveV4PathStatus; items: T[]; rootId: string | null }> {
  const depth = Number.isFinite(maxDepth) ? Math.max(1, Math.min(maxDepth, 100_000)) : 50_000
  const visited = new Set<string>()
  const items: T[] = []
  const finish = (status: ArchiveV4PathStatus, rootId: string | null = null) => {
    items.reverse()
    return { status, items, rootId: status === 'verified' ? rootId : null }
  }
  let messageId: string | null = selectedTipId
  let rootId: string | null = null
  while (messageId !== null && items.length < depth) {
    if (signal?.aborted) throw new DOMException('Path read cancelled', 'AbortError')
    if (visited.has(messageId)) return finish('cyclic_parent')
    visited.add(messageId)
    const message = await lookup(messageId)
    if (signal?.aborted) throw new DOMException('Path read cancelled', 'AbortError')
    if (!message) return finish(items.length ? 'missing_parent' : 'tip_missing')
    if (message.messageId !== messageId) return finish('missing_parent')
    items.push(project(message))
    onVisited?.(items.length)
    if (signal?.aborted) throw new DOMException('Path read cancelled', 'AbortError')
    rootId = messageId
    if (!message.parentKnown) return finish('parent_unknown')
    messageId = message.parentId
  }
  return finish(messageId === null ? 'verified' : 'depth_limit', rootId)
}

/** Pure, bounded parent traversal used by explicit export/path verification. */
export async function traceArchiveV4Path(
  selectedTipId: string,
  lookup: (messageId: string) => Promise<ArchiveV4Message | undefined>,
  maxDepth = 50_000,
  signal?: AbortSignal,
): Promise<Pick<ArchiveV4PathResult, 'status' | 'messages' | 'rootId'>> {
  const trace = await traceArchiveV4Parents(
    selectedTipId,
    lookup,
    (record) => record,
    maxDepth,
    signal,
  )
  return { status: trace.status, messages: trace.items, rootId: trace.rootId }
}

/** Index-only path trace: retains IDs and visited keys, but no raw record array. */
export async function traceArchiveV4PathIds(
  selectedTipId: string,
  lookup: (messageId: string) => Promise<ArchiveV4Message | undefined>,
  maxDepth = 50_000,
  signal?: AbortSignal,
  onVisited?: (records: number) => void,
): Promise<Pick<ArchiveV4PathIndex, 'status' | 'messageIds' | 'rootId'>> {
  const trace = await traceArchiveV4Parents(
    selectedTipId,
    lookup,
    (record) => record.messageId,
    maxDepth,
    signal,
    onVisited,
  )
  return { status: trace.status, messageIds: trace.items, rootId: trace.rootId }
}
