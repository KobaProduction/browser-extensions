import { archiveRecordAttachments } from '@chatgpt-booster/chatgpt'
import {
  type ArchiveExportOptions,
  type ArchiveItemView,
  type ArchiveThreadView,
  serverTimeMs,
} from '@chatgpt-booster/core'

export function exportIncludes(item: ArchiveItemView, options: ArchiveExportOptions): boolean {
  if (item.kind === 'user' || item.kind === 'answer') return true
  if (options.level === 'full') return true
  if (options.level === 'conversation') return false
  if (item.kind === 'reasoning') return options.reasoning
  if (item.kind === 'tool_call' || item.kind === 'tool_result') return options.tools
  return options.internal
}
export function serializeArchiveExport(
  conversation: { conversationId: string; title: string | null; projectId: string | null },
  thread: ArchiveThreadView,
  options: ArchiveExportOptions,
  evidence: unknown,
) {
  const turns = thread.turns
    .map((turn) => ({
      id: turn.id,
      association: turn.association,
      messages: turn.messages.filter((item) => exportIncludes(item, options)).map(project),
      details: turn.details.filter((item) => exportIncludes(item, options)).map(project),
    }))
    .filter((turn) => turn.messages.length || turn.details.length)
  const envelope = {
    schema: 'chatgpt-booster.export.v1',
    exportedAt: new Date().toISOString(),
    // Do not serialize the storage object: it may contain raw internal metadata.
    conversation: {
      conversationId: conversation.conversationId,
      title: conversation.title,
      projectId: conversation.projectId,
    },
    selection: { ...options },
    coverage: evidence,
    binaryAttachmentsIncluded: false,
    turns,
  }
  function project(item: ArchiveItemView) {
    const record = item.record
    return {
      id: record.messageId,
      kind: item.kind,
      role: record.role,
      createdAt:
        record.createTime === null ? null : new Date(serverTimeMs(record.createTime)).toISOString(),
      text: item.text,
      attachments: archiveRecordAttachments(record),
      ...(options.level === 'custom' || options.level === 'full'
        ? {
            status: record.status,
            recipient: record.recipient,
            model: record.modelSlug,
            parentId: record.parentId,
            turnExchangeId: record.turnExchangeId,
            // Custom mode retains raw payload only for explicitly selected nested records.
            // Full mode is an explicit lossless export request and retains every raw record.
            ...(options.level === 'full' || (item.kind !== 'user' && item.kind !== 'answer')
              ? { originalRecord: record.raw }
              : {}),
          }
        : {}),
    }
  }
  if (options.format === 'json')
    return { text: JSON.stringify(envelope, null, 2), mime: 'application/json', extension: 'json' }
  const jsonBlock = (value: unknown): string[] => {
    const text = JSON.stringify(value, null, 2)
    const runs = text?.match(/`+/g) ?? []
    const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)))
    return [`${fence}json`, text, fence, '']
  }
  const lines = [
    `# ${(conversation.title ?? 'Untitled').replace(/[\r\n]+/g, ' ')}`,
    '',
    `> Local archive export · ${envelope.exportedAt}`,
    '> Attachment metadata only; no binary files. Coverage is recorded below.',
    '',
    ...jsonBlock(evidence),
  ]
  for (const turn of turns) {
    const entries = [
      ...turn.messages.filter((message) => message.kind === 'user'),
      ...turn.details,
      ...turn.messages.filter((message) => message.kind !== 'user'),
    ]
    for (const message of entries) {
      const visible = message.kind === 'user' || message.kind === 'answer'
      lines.push(
        `${visible ? '##' : '###'} ${message.kind === 'user' ? 'User' : message.kind === 'answer' ? 'Assistant' : message.kind}`,
        '',
        message.text,
        '',
      )
      if (!visible) lines.push(...jsonBlock(message))
      else if (message.attachments.length)
        lines.push('### Attachment metadata', '', ...jsonBlock(message.attachments))
    }
  }
  return { text: lines.join('\n'), mime: 'text/markdown', extension: 'md' }
}
