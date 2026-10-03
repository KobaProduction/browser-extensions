import {
  type ArchiveItemView,
  type ArchiveRecordKind,
  type ArchiveRecordView,
  type ArchiveThreadView,
  type ArchiveTurnView,
  serverTimeMs,
} from '@chatgpt-booster/core'

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
export function archiveRecordKind(record: ArchiveRecordView): ArchiveRecordKind {
  const metadata = asRecord(record.raw.metadata)
  if (record.role === 'tool') return 'tool_result'
  if (record.role === 'assistant' && record.recipient && record.recipient !== 'all')
    return 'tool_call'
  if (
    ['thoughts', 'reasoning_recap'].includes(record.contentType ?? '') ||
    record.channel === 'analysis'
  )
    return 'reasoning'
  if (
    metadata?.is_visually_hidden_from_conversation === true ||
    record.contentType === 'model_editable_context'
  )
    return 'internal'
  if (record.role === 'user' && ['text', 'multimodal_text'].includes(record.contentType ?? ''))
    return 'user'
  if (
    record.role === 'assistant' &&
    (!record.channel || record.channel === 'final') &&
    ['text', 'multimodal_text'].includes(record.contentType ?? '')
  ) {
    const content = asRecord(record.raw.content)
    if (
      Array.isArray(content?.parts) &&
      content.parts.some((part) => typeof part !== 'string' || part.trim())
    )
      return 'answer'
    if (typeof content?.text === 'string' && content.text.trim()) return 'answer'
  }
  return 'internal'
}
export function archiveRecordText(record: ArchiveRecordView): string {
  const content = asRecord(record.raw.content)
  if (!content) return ''
  const parts = Array.isArray(content.parts)
    ? content.parts
    : Array.isArray(content.thoughts)
      ? content.thoughts
      : [content.text ?? content.content ?? content.summary ?? '']
  return parts
    .map((part) => {
      if (typeof part === 'string') return part
      const item = asRecord(part)
      if (!item) return ''
      if (typeof item.text === 'string') return item.text
      if (typeof item.content === 'string') return item.content
      if (typeof item.summary === 'string') return item.summary
      const name = item.name ?? item.filename ?? item.asset_pointer ?? item.file_id ?? ''
      return `[${String(item.content_type ?? 'attachment')}] ${String(name)}`
    })
    .filter(Boolean)
    .join('\n')
}

/** Raw record identity is never changed. Correlation uncertainty stays explicit. */
export function buildArchiveThread(records: ArchiveRecordView[]): ArchiveThreadView {
  const unique = [...new Map(records.map((record) => [record.messageKey, record])).values()]
  const byId = new Map(unique.map((record) => [record.messageId, record]))
  const ordered = unique.sort(
    (a, b) =>
      serverTimeMs(a.createTime, a.firstSeenAt) - serverTimeMs(b.createTime, b.firstSeenAt) ||
      a.messageKey.localeCompare(b.messageKey),
  )
  const groups = new Map<string, ArchiveTurnView>()
  const tagGroups = new Map<string, string>()
  const userGroup = (record: ArchiveRecordView) => `user:${record.messageId}`
  const tags = (record: ArchiveRecordView) =>
    [
      record.turnExchangeId ? `exchange:${record.turnExchangeId}` : '',
      record.workingTurnId ? `working:${record.workingTurnId}` : '',
    ].filter(Boolean)
  for (const record of ordered)
    if (archiveRecordKind(record) === 'user')
      for (const tag of tags(record)) tagGroups.set(tag, userGroup(record))
  function parentUser(record: ArchiveRecordView): ArchiveRecordView | undefined {
    const seen = new Set<string>()
    let parent = record.parentId
    while (parent && !seen.has(parent)) {
      seen.add(parent)
      const candidate = byId.get(parent)
      if (!candidate) break
      if (archiveRecordKind(candidate) === 'user') return candidate
      parent = candidate.parentId
    }
    return undefined
  }
  // Bind internal/assistant tags to their actual user ancestor before processing timestamp ties.
  for (const record of ordered) {
    const ancestor = parentUser(record)
    if (ancestor)
      for (const tag of tags(record))
        if (!tagGroups.has(tag)) tagGroups.set(tag, userGroup(ancestor))
  }
  let previousUser: string | undefined
  for (const record of ordered) {
    const kind = archiveRecordKind(record)
    const ancestor = kind === 'user' ? record : parentUser(record)
    const recordTags = tags(record)
    const taggedGroup = recordTags.map((tag) => tagGroups.get(tag)).find(Boolean)
    let association: ArchiveTurnView['association'] = 'parent'
    let id = ancestor ? userGroup(ancestor) : taggedGroup
    if (!id && recordTags[0]) {
      id = recordTags[0]
      association = 'turn'
    } else if (!ancestor && id) association = 'turn'
    if (!id) {
      const adjacent =
        record.role !== 'system' && record.role !== 'developer' ? previousUser : undefined
      id = adjacent ?? 'unassigned'
      association = adjacent ? 'adjacency' : 'unassigned'
    }
    if (kind === 'user') previousUser = id
    let group = groups.get(id)
    if (!group) {
      group = { id, association, messages: [], details: [] }
      groups.set(id, group)
    }
    if (association === 'adjacency' || association === 'unassigned') group.association = association
    const item: ArchiveItemView = { record, kind, text: archiveRecordText(record) }
    if (kind === 'user' || kind === 'answer') group.messages.push(item)
    else group.details.push(item)
  }
  const turns = [...groups.values()]
  for (const turn of turns)
    turn.messages.sort(
      (a, b) =>
        Number(a.kind !== 'user') - Number(b.kind !== 'user') ||
        serverTimeMs(a.record.createTime) - serverTimeMs(b.record.createTime),
    )
  const messageCount = turns.reduce((sum, turn) => sum + turn.messages.length, 0)
  return {
    turns,
    messageCount,
    recordCount: unique.length,
    detailCount: unique.length - messageCount,
  }
}
