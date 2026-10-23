import type { NativeHistoryGraph } from '@chatgpt-booster/observer'
import { conversationIntegrityFromGraph } from '@kobaproduction/browser-archive'

export interface SavedNativeGraph {
  graph: NativeHistoryGraph
  readId: string
  readStartedAt: number
  observedAt: number
}
export function newestNativeGraph(...candidates: (SavedNativeGraph | undefined)[]) {
  return candidates.reduce<SavedNativeGraph | undefined>(
    (selected, next) =>
      next &&
      (!selected ||
        next.readStartedAt > selected.readStartedAt ||
        (next.readStartedAt === selected.readStartedAt && next.observedAt > selected.observedAt))
        ? next
        : selected,
    undefined,
  )
}

/** Mapping edges own checkpoint members. Only later live receipts can extend it;
 * old paginated records outside that mapping remain explicitly unconfirmed. */
export function nativeGraphRelationship(
  checkpoint: SavedNativeGraph | undefined,
  messageId: string,
  original: { parentId: string | null; parentKnown: boolean },
  liveObservedAt?: number,
) {
  const parents = checkpoint && nativeGraphParents(checkpoint.graph)
  if (parents?.has(messageId)) return { parentId: parents.get(messageId) ?? null, parentKnown: true }
  if (!checkpoint || (liveObservedAt !== undefined && liveObservedAt > checkpoint.readStartedAt))
    return original
  return { parentId: null, parentKnown: false }
}

export function nativeLiveReceipt(
  source: { sourceKind: string; observedAtMs: number; raw: Record<string, unknown> } | undefined,
  parentId: string | null,
): number | undefined {
  if (!source || !['native-stream', 'native-submission'].includes(source.sourceKind)) return
  const metadata = source.raw.metadata as { parent_id?: unknown } | undefined
  if (metadata && Object.hasOwn(metadata, 'parent_id') && metadata.parent_id === parentId)
    return source.observedAtMs
}
const parentCache = new WeakMap<NativeHistoryGraph, ReadonlyMap<string, string | null>>()
export function nativeGraphParents(graph: NativeHistoryGraph) {
  const cached = parentCache.get(graph)
  if (cached) return cached
  const parents = new Map<string, string | null>()
  for (const node of Object.values(graph.nodes)) {
    if (!node.messageId) continue
    let parent = node.parent === null ? undefined : graph.nodes[node.parent]
    const seen = new Set<string>()
    while (parent && !parent.messageId) {
      if (seen.has(parent.id)) throw Error('Cyclic native graph')
      seen.add(parent.id)
      parent = parent.parent === null ? undefined : graph.nodes[parent.parent]
    }
    parents.set(node.messageId, parent?.messageId ?? null)
  }
  parentCache.set(graph, parents)
  return parents
}
/** Current native graph and retained historic observations are explicitly separate scopes. */
export function nativeGraphIntegrity(graph: NativeHistoryGraph, savedIds: ReadonlySet<string>) {
  const parents = nativeGraphParents(graph)
  if (!parents.size)
    return {
      start: 'verified' as const,
      end: 'verified' as const,
      chain: 'verified' as const,
      firstMessageId: null,
      lastMessageId: null,
      roots: [],
      tips: [],
      branches: [],
      issues: [],
      scope: 'current-native-graph' as const,
      retainedOutsideGraph: savedIds.size,
    }
  const headNode =
    typeof graph.header.current_node === 'string' ? graph.nodes[graph.header.current_node] : undefined
  const head = headNode?.messageId ?? null
  let first = head
  const seen = new Set<string>()
  while (first && parents.get(first)) {
    if (seen.has(first)) throw Error('Cyclic native graph')
    seen.add(first)
    first = parents.get(first) ?? null
  }
  const result = conversationIntegrityFromGraph(
    Object.values(graph.nodes)
      .filter((node) => !node.messageId || savedIds.has(node.messageId))
      .map((node) => ({ id: node.id, parentId: node.parent, parentKnown: true })),
    {
      firstId: first,
      startReached: !!first && savedIds.has(first),
      endReached: !!head && savedIds.has(head),
      headId: head,
    },
  )
  return {
    ...result,
    scope: 'current-native-graph' as const,
    retainedOutsideGraph: [...savedIds].filter((id) => !parents.has(id)).length,
  }
}

export function nativeSnapshotLiveReceipt(
  snapshot:
    | (NonNullable<Parameters<typeof nativeLiveReceipt>[0]> & {
        versions?: readonly NonNullable<Parameters<typeof nativeLiveReceipt>[0]>[]
      })
    | undefined,
  parentId: string | null,
) {
  let latest = nativeLiveReceipt(snapshot, parentId)
  for (const version of snapshot?.versions ?? []) {
    const receipt = nativeLiveReceipt(version, parentId)
    if (receipt !== undefined && (latest === undefined || receipt > latest)) latest = receipt
  }
  return latest
}
