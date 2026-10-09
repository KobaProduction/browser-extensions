import type {
  ArchiveV4Conversation,
  ArchiveV4Message,
  ArchiveV4Metadata,
  Source,
} from './archive-v4-entities'
import { comparePoint, key, sourceObject } from './archive-v4-identities'
import { canonicalSourceJson } from './archive-v4-write'

export interface FingerprintedArchiveMessage {
  readonly raw: Source
  readonly canonical: string
  readonly fingerprint: string
}
export interface ArchiveMessageMutation {
  readonly inserted: number
  readonly changed: number
  readonly unchanged: number
  readonly staleRecordCount: number
}
/** All mutations occur inside the caller's one write transaction. */
export function writeArchiveMessages({
  records,
  metadata,
  messages,
  previousMessages,
  summary,
  conversationKey,
  readId,
  readStartedAt,
  observedAt,
}: {
  records: IDBObjectStore
  metadata: IDBObjectStore
  messages: readonly FingerprintedArchiveMessage[]
  previousMessages: readonly (ArchiveV4Message | undefined)[]
  summary: ArchiveV4Conversation
  conversationKey: string
  readId: string
  readStartedAt: number
  observedAt: number
}): ArchiveMessageMutation {
  let inserted = 0
  let changed = 0
  let unchanged = 0
  let staleRecordCount = 0
  for (let i = 0; i < messages.length; i++) {
    const item = messages[i]
    if (!item) continue
    const { raw, canonical, fingerprint } = item
    const messageId = raw.id as string
    const sourceCreateTime = raw.create_time as number | null
    const previous = previousMessages[i]
    if (
      previous &&
      (previous.conversationKey !== conversationKey || previous.messageId !== messageId)
    )
      throw new Error('archive.error.auth')
    const identical =
      !!previous &&
      (previous.sourceFingerprint
        ? previous.sourceFingerprint === fingerprint
        : canonicalSourceJson(previous.raw) === canonical)
    const previousStart = previous?.sourceReadStartedAt ?? previous?.lastSeenAt ?? -Infinity
    const oldVersion =
      previous && typeof previous.raw.update_time === 'number'
        ? previous.raw.update_time
        : previous?.sourceCreateTime
    const newVersion = typeof raw.update_time === 'number' ? raw.update_time : sourceCreateTime
    const older =
      !!previous &&
      (readStartedAt < previousStart ||
        (readStartedAt === previousStart &&
          !!previous.sourceReadId &&
          previous.sourceReadId !== readId) ||
        observedAt < previous.lastSeenAt ||
        (oldVersion != null && newVersion !== null && newVersion < oldVersion))
    if (identical && previous) {
      if (!older && (readStartedAt > previousStart || !previous.sourceFingerprint)) {
        records.put({
          ...previous,
          sourceFingerprint: fingerprint,
          sourceReadId: readId,
          sourceReadStartedAt: readStartedAt,
          lastSeenAt: Math.max(previous.lastSeenAt, observedAt),
        } satisfies ArchiveV4Message)
      }
      unchanged++
      continue
    }
    if (older) {
      staleRecordCount++
      unchanged++
      continue
    }
    if (previous && previous.sourceCreateTime !== sourceCreateTime)
      throw new Error('archive.error.sourceChanged')
    if (previous) {
      metadata.put({
        key: key(previous.key, 'snapshot', String(previous.revision)),
        ownerType: 'message',
        ownerKey: previous.key,
        kind: 'message-snapshot',
        observedAt: previous.lastSeenAt,
        payload: {
          raw: previous.raw,
          revision: previous.revision,
          sourceFingerprint: previous.sourceFingerprint ?? null,
          sourceReadId: previous.sourceReadId ?? null,
          sourceReadStartedAt: previous.sourceReadStartedAt ?? null,
        },
      } satisfies ArchiveV4Metadata)
      // Evidence consumed by the compact writer stays tiny even when the
      // retained original snapshot contains very large multimodal data.
      // Both rows belong to the same all-or-nothing source transaction.
      metadata.put({
        key: key(previous.key, 'revision-evidence', String(previous.revision)),
        ownerType: 'message',
        ownerKey: previous.key,
        kind: 'message-revision-evidence',
        observedAt: previous.lastSeenAt,
        payload: {
          revision: previous.revision,
          sourceReadId: previous.sourceReadId ?? null,
          sourceReadStartedAt: previous.sourceReadStartedAt ?? null,
        },
      } satisfies ArchiveV4Metadata)
      changed++
    } else {
      inserted++
      summary.knownMessageCount++
      if (sourceCreateTime === null) summary.unsequencedMessageCount++
    }
    const meta = sourceObject(raw.metadata)
    records.put({
      key: key(conversationKey, messageId),
      conversationKey,
      messageId,
      parentId: typeof meta.parent_id === 'string' ? meta.parent_id : null,
      parentKnown:
        Object.hasOwn(meta, 'parent_id') &&
        (meta.parent_id === null || typeof meta.parent_id === 'string'),
      sourceCreateTime,
      firstSeenAt: previous?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
      revision: (previous?.revision ?? 0) + 1,
      sourceReadId: readId,
      sourceReadStartedAt: readStartedAt,
      sourceFingerprint: fingerprint,
      raw,
    } satisfies ArchiveV4Message)
    if (sourceCreateTime !== null) {
      if (
        summary.firstKnownTime === null ||
        !summary.firstKnownMessageId ||
        comparePoint(
          sourceCreateTime,
          messageId,
          summary.firstKnownTime,
          summary.firstKnownMessageId,
        ) < 0
      ) {
        summary.firstKnownTime = sourceCreateTime
        summary.firstKnownMessageId = messageId
      }
      if (
        summary.lastKnownTime === null ||
        !summary.lastKnownMessageId ||
        comparePoint(
          sourceCreateTime,
          messageId,
          summary.lastKnownTime,
          summary.lastKnownMessageId,
        ) > 0
      ) {
        summary.lastKnownTime = sourceCreateTime
        summary.lastKnownMessageId = messageId
      }
    }
  }
  return { inserted, changed, unchanged, staleRecordCount }
}
