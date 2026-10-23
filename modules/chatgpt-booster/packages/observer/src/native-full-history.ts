export interface NativeHistoryGraph {
  schema: 'chatgpt-native-graph.v1'
  header: Record<string, unknown>
  nodes: Record<
    string,
    { id: string; parent: string | null; children: string[]; messageId: string | null }
  >
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Decode the genuine full-history response. Message originals are never rewritten. */
export function decodeNativeFullHistory(payload: Record<string, unknown>, conversationId: string) {
  if (payload.conversation_id !== conversationId || !object(payload.mapping))
    throw Error('Invalid full-history identity')
  const nodes: NativeHistoryGraph['nodes'] = Object.create(null)
  const messages: Record<string, unknown>[] = []
  const ids = new Set<string>()
  for (const [key, value] of Object.entries(payload.mapping)) {
    if (
      !object(value) ||
      Object.keys(value).some((k) => !['id', 'parent', 'children', 'message'].includes(k)) ||
      value.id !== key ||
      (value.parent !== null && typeof value.parent !== 'string') ||
      !Array.isArray(value.children) ||
      !value.children.every((x) => typeof x === 'string') ||
      (value.message !== null && !object(value.message))
    )
      throw Error('Invalid native graph node')
    const message = value.message as Record<string, unknown> | null
    if (message && (typeof message.id !== 'string' || message.id !== key || ids.has(message.id)))
      throw Error('Invalid native graph message')
    if (message) {
      ids.add(message.id as string)
      messages.push(message)
    }
    nodes[key] = {
      id: key,
      parent: value.parent as string | null,
      children: [...value.children] as string[],
      messageId: message ? (message.id as string) : null,
    }
  }
  for (const node of Object.values(nodes)) {
    if (node.parent !== null && !nodes[node.parent]?.children.includes(node.id))
      throw Error('Missing native graph parent')
    if (
      new Set(node.children).size !== node.children.length ||
      node.children.some((id) => nodes[id]?.parent !== node.id)
    )
      throw Error('Invalid native graph children')
  }
  const complete = new Set<string>()
  for (const node of Object.values(nodes)) {
    const seen = new Set<string>()
    let cursor: string | null = node.id
    while (cursor && !complete.has(cursor)) {
      if (seen.has(cursor)) throw Error('Cyclic native graph')
      seen.add(cursor)
      cursor = nodes[cursor]?.parent ?? null
    }
    for (const id of seen) complete.add(id)
  }
  const head = typeof payload.current_node === 'string' ? nodes[payload.current_node] : undefined
  const { mapping: _mapping, ...header } = payload
  const nativeGraph: NativeHistoryGraph = { schema: 'chatgpt-native-graph.v1', header, nodes }
  if (!messages.length && payload.current_node !== null) throw Error('Invalid empty native graph head')
  if (!messages.length)
    return {
      nativeGraph,
      payload: {
        ...header,
        messages,
        page_info: {
          start_cursor: null,
          end_cursor: null,
          has_previous_page: false,
          has_next_page: false,
        },
      },
    }
  if (!head?.messageId) throw Error('Missing native graph head')
  let first = head
  while (first.parent !== null) {
    const parent = nodes[first.parent]
    if (!parent) throw Error('Missing native graph ancestor')
    if (!parent.messageId) break
    first = parent
  }
  return {
    nativeGraph,
    payload: {
      ...header,
      messages,
      page_info: {
        start_cursor: first.messageId,
        end_cursor: head.messageId,
        has_previous_page: false,
        has_next_page: false,
      },
    },
  }
}

export function validateNativeHistoryGraph(
  value: unknown,
  conversationId: string,
): asserts value is NativeHistoryGraph {
  if (
    !object(value) ||
    value.schema !== 'chatgpt-native-graph.v1' ||
    !object(value.header) ||
    !object(value.nodes) ||
    Object.keys(value).some((key) => !['schema', 'header', 'nodes'].includes(key))
  )
    throw Error('Invalid native graph envelope')
  const mapping: Record<string, unknown> = Object.create(null)
  for (const [key, node] of Object.entries(value.nodes)) {
    if (
      !object(node) ||
      Object.keys(node).some((k) => !['id', 'parent', 'children', 'messageId'].includes(k)) ||
      (node.messageId !== null && node.messageId !== key)
    )
      throw Error('Invalid native graph identity')
    mapping[key] = {
      id: node.id,
      parent: node.parent,
      children: node.children,
      message: node.messageId === null ? null : { id: node.messageId },
    }
  }
  decodeNativeFullHistory({ ...value.header, mapping }, conversationId)
}
