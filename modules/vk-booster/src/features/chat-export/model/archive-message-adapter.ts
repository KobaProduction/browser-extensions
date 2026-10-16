import {
  type ArchiveMessageElementV1,
  type ArchiveMessageSourceContext,
  type ArchiveMessageV1,
  archiveMessageKey,
  resolveArchiveMessage,
  validateArchiveMessage,
} from '@kobaproduction/browser-archive'
import type { VkMessage } from './types'

const time = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value * 1000 : null
const numericId = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null
const knownAttachments = new Set([
  'photo',
  'video',
  'audio',
  'doc',
  'sticker',
  'graffiti',
  'link',
  'wall',
  'wall_reply',
  'audio_message',
  'story',
  'poll',
  'gift',
  'market',
  'market_album',
])
/** The linear VK sequence has no observed parent relation. A reply reference
 * must not be turned into a fabricated conversation-chain edge. */
export function projectVkArchiveMessage(
  raw: Readonly<VkMessage>,
  source: ArchiveMessageSourceContext,
): ArchiveMessageV1 {
  const peer = Number(source.conversationId)
  if (
    !Number.isSafeInteger(peer) ||
    peer <= 0 ||
    String(peer) !== source.conversationId ||
    !Number.isSafeInteger(raw.id) ||
    raw.id <= 0 ||
    (raw.peer_id !== undefined && raw.peer_id !== peer)
  )
    throw Error('Invalid normalized VK identity')
  const identity = {
    providerId: 'vk-booster',
    ownerId: source.ownerId,
    conversationId: source.conversationId,
    messageId: String(raw.id),
  }
  const key = archiveMessageKey(identity),
    rootId = JSON.stringify([key, 0])
  const elements: ArchiveMessageElementV1[] = [
    {
      id: rootId,
      parentId: null,
      order: 0,
      kind: 'container',
      visibility: 'visible',
      text: null,
      language: null,
      sourcePath: '',
    },
  ]
  const append = (kind: ArchiveMessageElementV1['kind'], sourcePath: string, value: string | null) => {
    elements.push({
      id: JSON.stringify([key, elements.length]),
      parentId: rootId,
      order: elements.length - 1,
      kind,
      visibility: kind === 'opaque' ? 'unknown' : 'visible',
      text: value,
      language: null,
      sourcePath,
    })
  }
  if (typeof raw.text === 'string') append('text', 'text', raw.text)
  if (Array.isArray(raw.attachments))
    for (const [index, item] of raw.attachments.entries())
      append(
        item && knownAttachments.has(item.type) ? 'attachment' : 'opaque',
        `attachments[${index}]`,
        null,
      )
  else if (raw.attachments !== undefined) append('opaque', 'attachments', null)
  if (elements.length === 1) append('opaque', '', null)
  return validateArchiveMessage({
    schema: 'koba.message',
    modelVersion: 1,
    key,
    identity,
    author: { id: numericId(raw.from_id), role: 'participant', name: null },
    time: {
      createdAtMs: time(raw.date),
      updatedAtMs: time(raw.update_time),
      observedAtMs: source.observedAtMs,
    },
    links: {
      parentId: null,
      parentObserved: false,
      replyToId: numericId(raw.reply_message?.id),
      threadId: null,
    },
    context: {
      channel: null,
      recipient: null,
      status: null,
      endTurn: null,
      projectId: source.projectId ?? null,
      requestId: null,
      turnExchangeId: null,
      workingTurnId: null,
      requestedModel: null,
      resolvedModel: null,
      direction:
        raw.out === 1 || raw.out === true
          ? 'outgoing'
          : raw.out === 0 || raw.out === false
            ? 'incoming'
            : null,
    },
    content: {
      coverage: elements.some((element) => element.kind === 'opaque') ? 'contains-opaque' : 'typed',
      elements,
    },
    evidence: { terminal: 'unknown' },
    source: {
      snapshotKey: JSON.stringify([source.ownerId, peer, raw.id]),
      kind: source.sourceKind,
      version: source.sourceVersion,
      variantIndex: source.variantIndex ?? null,
    },
  })
}
export function readVkArchiveMessage(
  raw: Readonly<VkMessage>,
  source: ArchiveMessageSourceContext,
  stored?: unknown,
): ArchiveMessageV1 {
  return resolveArchiveMessage(stored, projectVkArchiveMessage(raw, source))
}
