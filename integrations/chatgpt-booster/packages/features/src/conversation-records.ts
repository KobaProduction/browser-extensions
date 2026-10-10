import type { ArchivedMessage } from './archive-store'

type RawRecord = Record<string, unknown>

function record(value: unknown): RawRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawRecord)
    : undefined
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function jsonHash(value: unknown): string {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`
}

export function normalizeConversationProjectId(payload: RawRecord): string | null {
  const gizmoId = stringOrNull(payload.gizmo_id)
  const gizmoType = stringOrNull(payload.gizmo_type)
  if (!gizmoId?.startsWith('g-p-')) return null
  if (gizmoType && gizmoType !== 'snorlax') return null
  return gizmoId
}

export function normalizeConversationMessage(
  raw: RawRecord,
  conversationId: string,
  projectId: string | null,
  observedAt: number,
  previous?: ArchivedMessage,
): ArchivedMessage | undefined {
  const messageId = stringOrNull(raw.id)
  if (!messageId) return undefined
  const author = record(raw.author)
  const content = record(raw.content)
  const metadata = record(raw.metadata)
  return {
    messageKey: `${conversationId}:${messageId}`,
    messageId,
    conversationId,
    projectId,
    parentId: stringOrNull(metadata?.parent_id),
    turnExchangeId: stringOrNull(metadata?.turn_exchange_id),
    workingTurnId: stringOrNull(metadata?.working_turn_id),
    requestId: stringOrNull(metadata?.request_id),
    role: stringOrNull(author?.role),
    authorName: stringOrNull(author?.name),
    recipient: stringOrNull(raw.recipient),
    channel: stringOrNull(raw.channel),
    contentType: stringOrNull(content?.content_type),
    messageType: stringOrNull(metadata?.message_type),
    status: stringOrNull(raw.status),
    endTurn: booleanOrNull(raw.end_turn),
    weight: numberOrNull(raw.weight),
    createTime: numberOrNull(raw.create_time),
    updateTime: numberOrNull(raw.update_time),
    modelSlug: stringOrNull(metadata?.model_slug),
    resolvedModelSlug: stringOrNull(metadata?.resolved_model_slug),
    firstSeenAt: previous?.firstSeenAt ?? observedAt,
    lastSeenAt: observedAt,
    payloadHash: jsonHash(raw),
    raw,
  }
}
