import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import type { ArchiveV4Conversation, ArchiveV4Metadata } from './archive-v4-entities'

/** Native read-start time and conflicting read IDs gate which page may update
 * the selected head/title/project. Older pages cannot roll these fields back.
 */
export function reconcileArchiveConversationHead({
  previousConversation,
  previousPage,
  detail,
  accountId,
  conversationKey,
  projectId,
  observedAt,
  readId,
  readStartedAt,
}: {
  previousConversation: ArchiveV4Conversation | undefined
  previousPage: ArchiveV4Metadata | undefined
  detail: ConversationArchiveEventDetail
  accountId: string
  conversationKey: string
  projectId: string | null
  observedAt: number
  readId: string
  readStartedAt: number
}): ArchiveV4Conversation {
  const summary: ArchiveV4Conversation = previousConversation
    ? { ...previousConversation }
    : {
        key: conversationKey,
        accountId,
        conversationId: detail.conversationId,
        projectId,
        title: null,
        currentNodeId: null,
        instanceId: crypto.randomUUID(),
        headReadId: null,
        headReadStartedAt: null,
        latestReadId: null,
        latestReadStartedAt: null,
        latestReadConflicted: false,
        knownMessageCount: 0,
        unsequencedMessageCount: 0,
        firstKnownMessageId: null,
        lastKnownMessageId: null,
        firstKnownTime: null,
        lastKnownTime: null,
        verifiedPathRootId: null,
        verifiedPathTipId: null,
        verifiedPathReadId: null,
        verifiedPathRevision: null,
        coverage: 'unverified',
        revision: 0,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
      }
  const latestStart = summary.latestReadStartedAt ?? summary.headReadStartedAt ?? null
  const latestId = summary.latestReadId ?? summary.headReadId ?? null
  if (latestStart === null || readStartedAt > latestStart) {
    summary.latestReadId = readId
    summary.latestReadStartedAt = readStartedAt
    summary.latestReadConflicted = false
  } else if (readStartedAt === latestStart && latestId && latestId !== readId) {
    summary.latestReadConflicted = true
  }
  const canUpdateHead =
    detail.isInitial === true &&
    !summary.latestReadConflicted &&
    summary.latestReadId === readId &&
    readStartedAt === summary.latestReadStartedAt &&
    (summary.headReadId !== readId || !previousPage || observedAt >= previousPage.observedAt)
  if (canUpdateHead) {
    if (readStartedAt >= (summary.catalogReadStartedAt ?? -Infinity)) {
      if (Object.hasOwn(detail.payload, 'gizmo_id')) summary.projectId = projectId
      if (Object.hasOwn(detail.payload, 'title'))
        summary.title = typeof detail.payload.title === 'string' ? detail.payload.title : null
    }
    if (Object.hasOwn(detail.payload, 'current_node'))
      summary.currentNodeId =
        typeof detail.payload.current_node === 'string' ? detail.payload.current_node : null
    summary.headReadId = readId
    summary.headReadStartedAt = readStartedAt
  }
  return summary
}
