import { type ArchiveRecordView, projectNativeMessage, serverTimeMs } from '@chatgpt-booster/core'
import {
  type ArchiveMessageSourceContext,
  type ArchiveMessageV1,
  archiveMessageKey,
  resolveArchiveMessage,
  validateArchiveMessage,
} from '@kobaproduction/browser-archive'

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
const text = (value: unknown) => (typeof value === 'string' ? value : null)

/** Actual ChatGPT source -> the shared stored/exported/wire model. Opaque source
 * slots retain references, and native originals remain the lossless companion. */
export function projectChatGptArchiveMessage(
  raw: Readonly<Record<string, unknown>>,
  source: ArchiveMessageSourceContext,
): ArchiveMessageV1 {
  const projection = projectNativeMessage(raw, {
    accountId: source.ownerId,
    conversationId: source.conversationId,
  })
  const identity = {
    providerId: 'chatgpt-booster',
    ownerId: source.ownerId,
    conversationId: source.conversationId,
    messageId: projection.messageId,
  }
  const key = archiveMessageKey(identity),
    metadata = object(raw.metadata),
    author = object(raw.author)
  const ids = new Map(
    projection.elements.map((element, index) => [element.elementId, JSON.stringify([key, index])]),
  )
  return validateArchiveMessage({
    schema: 'koba.message',
    modelVersion: 1,
    key,
    identity,
    author: { id: text(author?.id), role: projection.role, name: text(author?.name) },
    time: {
      createdAtMs:
        projection.sourceCreateTime === null ? null : serverTimeMs(projection.sourceCreateTime),
      updatedAtMs:
        projection.sourceUpdateTime === null ? null : serverTimeMs(projection.sourceUpdateTime),
      observedAtMs: source.observedAtMs,
    },
    links: {
      parentId: projection.parentObserved ? projection.parentMessageId : null,
      parentObserved: projection.parentObserved,
      replyToId: null,
      threadId: text(metadata?.thread_id),
    },
    context: {
      channel: projection.channel,
      recipient: projection.recipient,
      status: text(raw.status),
      endTurn: typeof raw.end_turn === 'boolean' ? raw.end_turn : null,
      projectId: source.projectId ?? null,
      requestId: text(metadata?.request_id),
      turnExchangeId: text(metadata?.turn_exchange_id),
      workingTurnId: text(metadata?.working_turn_id),
      requestedModel: text(metadata?.model_slug),
      resolvedModel: text(metadata?.resolved_model_slug),
      direction: null,
    },
    content: {
      coverage: projection.renderCoverage === 'typed' ? 'typed' : 'contains-opaque',
      elements: projection.elements.map((element) => ({
        id: ids.get(element.elementId),
        parentId: element.parentElementId === null ? null : ids.get(element.parentElementId),
        order: element.siblingOrder,
        kind: element.kind,
        visibility: element.visibility,
        text: element.text,
        language: element.language,
        sourcePath: element.sourcePath,
      })),
    },
    evidence: {
      terminal:
        projection.role === 'assistant' &&
        raw.end_turn === true &&
        raw.status === 'finished_successfully' &&
        (projection.channel === null || projection.channel === 'final') &&
        (projection.recipient === null || projection.recipient === 'all')
          ? 'observed'
          : 'unknown',
    },
    source: {
      snapshotKey: projection.messageKey,
      kind: source.sourceKind,
      version: source.sourceVersion,
      variantIndex: source.variantIndex ?? null,
    },
  })
}
export function readChatGptArchiveMessage(
  raw: Readonly<Record<string, unknown>>,
  source: ArchiveMessageSourceContext,
  stored?: unknown,
): ArchiveMessageV1 {
  return resolveArchiveMessage(stored, projectChatGptArchiveMessage(raw, source))
}
/** Bridge to the retained Reader/tool presentation API, derived from the one
 * normalized authority. Raw is retained only for explicit source/asset views. */
export function chatGptArchiveRecord(
  raw: Record<string, unknown>,
  normalized: ArchiveMessageV1,
): ArchiveRecordView {
  validateArchiveMessage(normalized)
  const context = normalized.context
  return {
    messageKey: normalized.key,
    messageId: normalized.identity.messageId,
    conversationId: normalized.identity.conversationId,
    role: normalized.author.role,
    authorName: normalized.author.name,
    channel: context.channel,
    recipient: context.recipient,
    status: context.status,
    modelSlug: context.requestedModel,
    resolvedModelSlug: context.resolvedModel,
    parentId: normalized.links.parentObserved ? normalized.links.parentId : null,
    turnExchangeId: context.turnExchangeId,
    workingTurnId: context.workingTurnId,
    createTime: normalized.time.createdAtMs === null ? null : normalized.time.createdAtMs / 1000,
    updateTime: normalized.time.updatedAtMs === null ? null : normalized.time.updatedAtMs / 1000,
    firstSeenAt: normalized.time.observedAtMs,
    contentType: text(object(raw.content)?.content_type),
    messageType: text(object(raw.metadata)?.message_type),
    raw,
    normalized,
  }
}
/** Optional additive metadata is never trusted instead of the source during recovery. */
export function validateChatGptNormalizedSnapshot(
  snapshot: {
    accountId: string
    sourceKind: string
    sourceVersion: string
    observedAtMs: number
    raw: Record<string, unknown>
    normalized?: ArchiveMessageV1
    projectId?: string | null
    versions?: readonly {
      sourceKind: string
      sourceVersion: string
      observedAtMs: number
      raw: Record<string, unknown>
      normalized?: ArchiveMessageV1
      projectId?: string | null
    }[]
  },
  conversationId: string,
  projectId: string | null = snapshot.projectId ?? null,
): void {
  const context = {
    ownerId: snapshot.accountId,
    conversationId,
    projectId,
    sourceKind: snapshot.sourceKind,
    sourceVersion: snapshot.sourceVersion,
    observedAtMs: snapshot.observedAtMs,
  }
  if (snapshot.normalized !== undefined)
    readChatGptArchiveMessage(snapshot.raw, context, snapshot.normalized)
  for (const [index, version] of (snapshot.versions ?? []).entries())
    if (version.normalized !== undefined)
      readChatGptArchiveMessage(
        version.raw,
        {
          ...context,
          sourceKind: version.sourceKind,
          sourceVersion: version.sourceVersion,
          observedAtMs: version.observedAtMs,
          variantIndex: index,
          projectId: version.projectId === undefined ? projectId : version.projectId,
        },
        version.normalized,
      )
}
