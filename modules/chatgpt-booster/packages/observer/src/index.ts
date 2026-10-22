import { conversationRequestErrorCode } from './conversation-request-error'
import { ConversationStreamDecoder } from './conversation-stream-decoder'
import { registerNativeAccountConsumer } from './native-account-source'

export type { ChatGptNativeAccountRegistry, ChatGptNativeAccountSource } from './native-account-source'
export { bindNativeAccountSource } from './native-account-source'
export const TRANSPORT_EVENT = 'chatgpt-booster:transport-event'
export const TRANSPORT_BATCH_EVENT = 'chatgpt-booster:transport-batch'
export const TRANSPORT_CONFIG_EVENT = 'chatgpt-booster:transport-config'
declare const __BOOSTER_INSTANCE_SCOPE__: string | undefined
declare const __BOOSTER_DELIVERY_TARGET__: string | undefined
const observerScope = typeof __BOOSTER_INSTANCE_SCOPE__ === 'string' ? __BOOSTER_INSTANCE_SCOPE__ : ''
const observerTargetId =
  typeof __BOOSTER_DELIVERY_TARGET__ === 'string' ? __BOOSTER_DELIVERY_TARGET__ : ''
export const TRANSPORT_CHANNEL = observerScope
  ? 'chatgpt-booster:transport:' + observerScope + (observerTargetId ? ':' + observerTargetId : '')
  : 'chatgpt-booster:transport'

export const ARCHIVE_POLICY_EVENT = 'chatgpt-booster:archive-policy'
export const ARCHIVE_NETWORK_EVENT = 'chatgpt-booster:archive-network'
export const ARCHIVE_CONTRACT_ERROR_EVENT = 'chatgpt-booster:archive-native-contract-error'
export const CONVERSATION_REQUEST_EVENT = 'chatgpt-booster:conversation-request'
export const CONVERSATION_STOP_EVENT = 'chatgpt-booster:conversation-stop'
export const CONVERSATION_STREAM_STATUS_EVENT = 'chatgpt-booster:conversation-stream-status'
export const CONVERSATION_STREAM_EVENT = 'chatgpt-booster:conversation-stream'
export const CONVERSATION_CATALOG_EVENT = 'chatgpt-booster:conversation-catalog'
export const CONVERSATION_ACCOUNT_EVENT = 'chatgpt-booster:conversation-account'
export const ARCHIVE_ASSET_EVENT = 'chatgpt-booster:archive-asset'
export const ARCHIVE_ASSET_FETCH_REQUEST_EVENT = 'chatgpt-booster:archive-asset-fetch-request'
export const ARCHIVE_ASSET_FETCH_RESULT_EVENT = 'chatgpt-booster:archive-asset-fetch-result'
export const ARCHIVE_ASSET_FETCH_CANCEL_EVENT = 'chatgpt-booster:archive-asset-fetch-cancel'
export interface ArchiveCapturePolicy {
  enabled: boolean
  defaultEnabled: boolean
  projects: Record<string, boolean>
  conversations: Record<string, boolean>
  manualConversationId: string | null
  manualStartedAt: number | null
}
const DENY_ARCHIVE: ArchiveCapturePolicy = {
  enabled: false,
  defaultEnabled: false,
  projects: {},
  conversations: {},
  manualConversationId: null,
  manualStartedAt: null,
}
let archivePolicy = { ...DENY_ARCHIVE }
const archiveProjects = new Map<string, string | null>()
interface ArchiveReadContext {
  readId: string
  readStartedAt: number
  isInitial: boolean
  requestedBefore: string | null
  accountId: string | null
  accountEpoch: number
}
const archiveReads = new Map<string, { readId: string; readStartedAt: number }>()
const bufferedInitialPages = new Map<string, ConversationArchiveEventDetail>()

function pageConversationId(pathname = location.pathname): string | undefined {
  const match = pathname.match(/(?:^|\/)c\/([^/?#]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function archiveProjectId(payload: Record<string, unknown>, conversationId: string) {
  const incoming =
    typeof payload.gizmo_id === 'string' && payload.gizmo_id.startsWith('g-p-') ? payload.gizmo_id : null
  return 'gizmo_id' in payload ? incoming : (archiveProjects.get(conversationId) ?? null)
}

function publishConversationPage(detail: ConversationArchiveEventDetail) {
  if (!observerTarget) return
  const projectId = archiveProjectId(detail.payload, detail.conversationId)
  if (!captureAllowed(detail.conversationId, projectId)) return
  archiveProjects.set(detail.conversationId, projectId)
  observerTarget.postMessage(
    { channel: TRANSPORT_CHANNEL, type: ARCHIVE_EVENT, detail },
    observerTarget.location.origin,
  )
}
function publishPreloadPage(detail: ConversationArchiveEventDetail) {
  if (!observerTarget || pageConversationId() !== detail.conversationId) return
  observerTarget.postMessage(
    { channel: TRANSPORT_CHANNEL, type: ARCHIVE_PRELOAD_EVENT, detail },
    observerTarget.location.origin,
  )
}
function beginArchiveRequest(
  sourceUrl: string,
  requestId: string,
  accountId: string | null,
  accountEpoch: number,
): ArchiveReadContext | undefined {
  const id = conversationHistoryId(sourceUrl)
  if (!id) return undefined
  const url = new URL(
    sourceUrl,
    typeof location === 'undefined' ? 'https://chatgpt.com/' : location.href,
  )
  const isInitial = !url.pathname.endsWith('/messages')
  if (isInitial) archiveReads.set(id, { readId: requestId, readStartedAt: Date.now() })
  const read = archiveReads.get(id) ?? { readId: requestId, readStartedAt: Date.now() }
  if (archiveReads.size > 128) {
    const oldest = archiveReads.keys().next().value
    if (oldest) {
      archiveReads.delete(oldest)
      archiveProjects.delete(oldest)
    }
  }
  return {
    ...read,
    isInitial,
    requestedBefore: url.searchParams.get('before'),
    accountId,
    accountEpoch,
  }
}
function captureAllowed(id: string, projectId: string | null): boolean {
  return (
    archivePolicy.manualConversationId === id ||
    (archivePolicy.enabled &&
      (archivePolicy.conversations[id] ??
        (projectId ? archivePolicy.projects[projectId] : undefined) ??
        archivePolicy.defaultEnabled))
  )
}

function shouldObserveArchiveConversation(id: string): boolean {
  if (pageConversationId() === id || archivePolicy.manualConversationId === id) return true
  if (!archivePolicy.enabled) return false

  const conversationRule = archivePolicy.conversations[id]
  if (conversationRule !== undefined) return conversationRule

  if (archiveProjects.has(id)) return captureAllowed(id, archiveProjects.get(id) ?? null)

  return archivePolicy.defaultEnabled || Object.values(archivePolicy.projects).some(Boolean)
}
function conversationStreamStatusTarget(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl, 'https://chatgpt.com/')
    if (url.origin !== 'https://chatgpt.com') return null
    const match = url.pathname.match(/^\/backend-api\/conversation\/([^/]+)\/stream_status$/)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

function isConversationStreamStatusUrl(sourceUrl: string) {
  return conversationStreamStatusTarget(sourceUrl) !== null
}

function normalizeConversationStreamStatus(value: unknown): ConversationStreamStatus | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return ['IS_STREAMING', 'COMPLETE', 'FAILURE', 'UNAVAILABLE'].includes(normalized)
    ? (normalized as ConversationStreamStatus)
    : null
}

export function conversationStreamStatusFromPayload(
  sourceUrl: string,
  payload: unknown,
  observedAt: number,
  httpStatus: number,
): ConversationStreamStatusEventDetail | null {
  const conversationId = conversationStreamStatusTarget(sourceUrl)
  if (!conversationId) return null
  const record = requestPayload(payload)
  const status = httpStatus === 404 ? 'UNAVAILABLE' : normalizeConversationStreamStatus(record?.status)
  if (!status) return null
  return { conversationId, status, observedAt, httpStatus }
}

function publishConversationStreamStatus(detail: ConversationStreamStatusEventDetail | null) {
  if (!observerTarget || !detail) return
  observerTarget.postMessage(
    { channel: TRANSPORT_CHANNEL, type: CONVERSATION_STREAM_STATUS_EVENT, detail },
    observerTarget.location.origin,
  )
}

function observeConversationStreamStatusResponse(
  response: Response,
  sourceUrl: string,
  requestId?: string,
) {
  if (!isConversationStreamStatusUrl(sourceUrl)) return
  const observedAt = Date.now()
  if (response.status === 404) {
    const detail = conversationStreamStatusFromPayload(sourceUrl, null, observedAt, response.status)
    publishConversationStreamStatus(detail ? { ...detail, ...(requestId ? { requestId } : {}) } : null)
    return
  }
  void response
    .clone()
    .json()
    .then((payload) => {
      const detail = conversationStreamStatusFromPayload(sourceUrl, payload, observedAt, response.status)
      publishConversationStreamStatus(detail ? { ...detail, ...(requestId ? { requestId } : {}) } : null)
    })
    .catch(() => undefined)
}

function publishConversationStream(detail: ConversationStreamEventDetail | null) {
  if (!observerTarget || !detail) return
  observerTarget.postMessage(
    { channel: TRANSPORT_CHANNEL, type: CONVERSATION_STREAM_EVENT, detail },
    observerTarget.location.origin,
  )
}

export function conversationStreamEventFromPayload(
  payload: unknown,
  fallbackConversationId: string | null,
  observedAt: number,
): ConversationStreamEventDetail | null {
  const value = requestPayload(payload)
  if (!value) return null
  const conversationId =
    typeof value.conversation_id === 'string' ? value.conversation_id : fallbackConversationId
  if (
    value.type === 'stream_handoff' &&
    typeof value.conversation_id === 'string' &&
    value.conversation_id.trim()
  )
    return { conversationId: value.conversation_id, kind: 'handoff', observedAt }
  if (typeof value.error === 'string' && value.error.trim()) {
    const errorCode =
      typeof value.error_code === 'string' && value.error_code.trim() ? value.error_code : null
    const errorReason =
      typeof value.error_reason === 'string' && value.error_reason.trim() ? value.error_reason : null
    const canRetry = typeof value.can_retry === 'boolean' ? value.can_retry : null
    return {
      conversationId,
      kind: 'error',
      errorCode,
      errorReason,
      canRetry,
      observedAt,
    }
  }
  const directMessage = conversationMessageRecord(value.message)
  if (directMessage) return { conversationId, kind: 'message', record: directMessage, observedAt }
  if (value.type === 'input_message') {
    const inputMessage = conversationMessageRecord(value.input_message)
    if (inputMessage) return { conversationId, kind: 'message', record: inputMessage, observedAt }
  }
  if (value.type === 'message_stream_complete')
    return { conversationId, kind: 'complete', phase: 'message', observedAt }
  if (value.type === 'main_stream_complete')
    return { conversationId, kind: 'complete', phase: 'main', observedAt }
  if (value.type === 'conversation_async_status') {
    const asyncStatus = value.async_status
    if (asyncStatus === null || typeof asyncStatus === 'number' || typeof asyncStatus === 'string')
      return { conversationId, kind: 'async-status', asyncStatus, observedAt }
    return null
  }
  if (value.type === 'safety_review_update') {
    if (typeof value.active !== 'boolean') return null
    const protectionType =
      value.protection_type === 'bio' || value.protection_type === 'cyber' ? value.protection_type : null
    const message = typeof value.message === 'string' && value.message.trim() ? value.message : null
    return {
      conversationId,
      kind: 'safety-review',
      active: value.active,
      protectionType,
      message,
      observedAt,
    }
  }
  return null
}

function observeConversationStreamResponse(
  response: Response,
  conversationId: string | null,
  accountId: string | null,
  requestEpoch: number,
  currentEpoch: () => number,
  requestId: string,
  userMessageId: string | null,
  onConversationKnown: (id: string, message?: Record<string, unknown>) => void,
) {
  if (!response.ok || !/event-stream/i.test(response.headers.get('content-type') ?? '')) return
  const body = response.clone().body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let nativeConversationId = conversationId
  const sourceDecoder = new ConversationStreamDecoder()
  let terminalSeen = false
  let handedOff = false
  const publishRetainedGapEvidence = () => {
    const baseline = sourceDecoder.retainedBaseline()
    const normalized = baseline
      ? conversationStreamEventFromPayload(baseline, nativeConversationId, Date.now())
      : null
    if (normalized?.kind === 'message' && requestEpoch === currentEpoch()) {
      publishConversationStream({
        ...normalized,
        accountId,
        requestId,
        userMessageId,
        evidence: sourceDecoder.takeGapEvidence(),
      })
    }
  }

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (requestEpoch !== currentEpoch()) break
        if (done) {
          if (!terminalSeen && !handedOff)
            publishConversationStream({
              conversationId: nativeConversationId,
              kind: 'error',
              errorCode: 'stream_interrupted',
              errorReason: null,
              canRetry: true,
              observedAt: Date.now(),
              accountId,
              requestId,
              userMessageId,
            })
          break
        }
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          const eventType =
            block
              .split('\n')
              .filter((line) => line.startsWith('event:'))
              .at(-1)
              ?.slice(6)
              .trim() ?? null
          if (data === '[DONE]' && requestEpoch === currentEpoch()) {
            terminalSeen = true
            if (!handedOff)
              publishConversationStream(
                sourceDecoder.hasGap()
                  ? {
                      conversationId: nativeConversationId,
                      kind: 'error',
                      errorCode: 'source_patch_gap',
                      errorReason: null,
                      canRetry: true,
                      observedAt: Date.now(),
                      accountId,
                      requestId,
                      userMessageId,
                    }
                  : {
                      conversationId: nativeConversationId,
                      kind: 'complete',
                      phase: 'main',
                      observedAt: Date.now(),
                      accountId,
                      requestId,
                      userMessageId,
                    },
              )
          }
          if (data && data !== '[DONE]') {
            try {
              // Native SSE JSON-encodes the encoding name just like other data.
              // Retain compatibility only with the exact bare v1 header.
              const decoded = eventType === 'delta_encoding' && data === 'v1' ? data : JSON.parse(data)
              const source = sourceDecoder.decode(decoded, eventType)
              if (!source && sourceDecoder.hasGap()) {
                publishConversationStream({
                  conversationId: nativeConversationId,
                  kind: 'error',
                  errorCode: 'source_patch_gap',
                  errorReason: null,
                  canRetry: true,
                  observedAt: Date.now(),
                  accountId,
                  requestId,
                  userMessageId,
                })
                publishRetainedGapEvidence()
              }
              const normalized =
                !source && sourceDecoder.hasGap()
                  ? null
                  : conversationStreamEventFromPayload(
                      source?.payload ?? decoded,
                      nativeConversationId,
                      Date.now(),
                    )
              if (normalized?.conversationId) {
                nativeConversationId = normalized.conversationId
                onConversationKnown(
                  nativeConversationId,
                  normalized.kind === 'message' ? normalized.record : undefined,
                )
              }
              if (normalized?.kind === 'handoff') handedOff = true
              if (
                (normalized?.kind === 'complete' && normalized.phase === 'main') ||
                normalized?.kind === 'error' ||
                (normalized?.kind === 'message' &&
                  requestPayload(normalized.record.author)?.role === 'assistant' &&
                  (normalized.record.recipient === undefined ||
                    normalized.record.recipient === null ||
                    normalized.record.recipient === 'all') &&
                  (normalized.record.channel === undefined ||
                    normalized.record.channel === null ||
                    normalized.record.channel === 'final') &&
                  normalized.record.end_turn === true &&
                  normalized.record.status === 'finished_successfully')
              )
                terminalSeen = true
              if (!normalized) {
                const value = requestPayload(decoded)
                const sourceId =
                  typeof value?.conversation_id === 'string'
                    ? value.conversation_id
                    : nativeConversationId
                const expectedMessage =
                  value?.type === 'input_message' ||
                  (value?.message !== undefined &&
                    (value?.type === undefined || value?.type === 'message'))
                if (sourceId && expectedMessage && shouldObserveArchiveConversation(sourceId))
                  observerTarget?.postMessage(
                    {
                      channel: TRANSPORT_CHANNEL,
                      type: ARCHIVE_CONTRACT_ERROR_EVENT,
                      detail: { conversationId: sourceId, path: 'stream.message' },
                    },
                    observerTarget.location.origin,
                  )
              }
              if (
                requestEpoch === currentEpoch() &&
                !(
                  sourceDecoder.hasGap() &&
                  (normalized?.kind === 'complete' || normalized?.kind === 'async-status')
                )
              )
                publishConversationStream(
                  normalized
                    ? {
                        ...normalized,
                        accountId,
                        requestId,
                        userMessageId,
                        ...(normalized.kind === 'message' && source
                          ? { evidence: [...sourceDecoder.takeGapEvidence(), source.evidence] }
                          : {}),
                      }
                    : null,
                )
            } catch {
              sourceDecoder.markGap({ unparsedSourceData: data })
              publishRetainedGapEvidence()
              if (requestEpoch === currentEpoch())
                publishConversationStream({
                  conversationId: nativeConversationId,
                  kind: 'error',
                  errorCode: 'source_patch_gap',
                  errorReason: null,
                  canRetry: true,
                  observedAt: Date.now(),
                  accountId,
                  requestId,
                  userMessageId,
                })
            }
          }
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch {
      if (!terminalSeen && !handedOff && requestEpoch === currentEpoch())
        publishConversationStream({
          conversationId: nativeConversationId,
          kind: 'error',
          errorCode: 'stream_interrupted',
          errorReason: null,
          canRetry: true,
          observedAt: Date.now(),
          accountId,
          requestId,
          userMessageId,
        })
    } finally {
      reader.releaseLock()
    }
  })()
}

function isConversationStopUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl, 'https://chatgpt.com/')
    return url.origin === 'https://chatgpt.com' && url.pathname === '/backend-api/stop_conversation'
  } catch {
    return false
  }
}

function conversationIdFromBody(body: unknown): string | null {
  const payload = requestPayload(body)
  return typeof payload?.conversation_id === 'string' ? payload.conversation_id : null
}

export function conversationStopTargetFromBody(
  sourceUrl: string,
  method: string,
  body: unknown,
): string | null {
  if (method.toUpperCase() !== 'POST' || !isConversationStopUrl(sourceUrl)) return null
  return conversationIdFromBody(body)
}

function publishConversationStop(detail: ConversationStopEventDetail | null) {
  if (!observerTarget || !detail) return
  observerTarget.postMessage(
    { channel: TRANSPORT_CHANNEL, type: CONVERSATION_STOP_EVENT, detail },
    observerTarget.location.origin,
  )
}

function isConversationRequestUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl, 'https://chatgpt.com/')
    return (
      url.origin === 'https://chatgpt.com' && /^\/backend-api\/(?:f\/)?conversation$/.test(url.pathname)
    )
  } catch {
    return false
  }
}
function isConversationResumeUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl, 'https://chatgpt.com/')
    return url.origin === 'https://chatgpt.com' && url.pathname === '/backend-api/f/conversation/resume'
  } catch {
    return false
  }
}

function sourceTimestampMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value < 10_000_000_000 ? value * 1000 : value
}

function conversationMessageRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const author = record.author
  if (
    typeof record.id !== 'string' ||
    !author ||
    typeof author !== 'object' ||
    Array.isArray(author) ||
    typeof (author as Record<string, unknown>).role !== 'string' ||
    !Object.hasOwn(record, 'content')
  )
    return null
  return record
}

function requestPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function conversationRequestTimingFromBody(
  sourceUrl: string,
  method: string,
  body: unknown,
  observedAt: number,
): ConversationRequestEventDetail | null {
  if (method.toUpperCase() !== 'POST' || !isConversationRequestUrl(sourceUrl)) return null
  const payload = requestPayload(body)
  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  const user = [...messages].reverse().find((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const author = (item as Record<string, unknown>).author
    return Boolean(
      author &&
        typeof author === 'object' &&
        !Array.isArray(author) &&
        (author as Record<string, unknown>).role === 'user',
    )
  }) as Record<string, unknown> | undefined
  const sourceStartedAt = sourceTimestampMs(user?.create_time)
  const attribution = payload?.turn_attribution
  const composer =
    !!attribution &&
    typeof attribution === 'object' &&
    !Array.isArray(attribution) &&
    (attribution as Record<string, unknown>).turn_trigger === 'composer'
  const effortPresent = !!payload && Object.hasOwn(payload, 'thinking_effort')
  // Do not infer model/effort from UI labels, ordinal power levels, prepare,
  // missing conversation IDs or an unrelated generation/retry action.
  const selection: ConversationSubmissionSelection | undefined =
    payload?.action === 'next' &&
    composer &&
    typeof payload.conversation_id === 'string' &&
    payload.conversation_id &&
    typeof user?.id === 'string' &&
    user.id &&
    typeof payload.model === 'string' &&
    payload.model &&
    (!effortPresent || typeof payload.thinking_effort === 'string') &&
    Number.isFinite(observedAt)
      ? {
          schema: SUBMISSION_SELECTION_SCHEMA,
          messageId: user.id,
          requestedModel: payload.model,
          thinkingEffort: effortPresent ? (payload.thinking_effort as string) : null,
          effortPresent,
          observedAtMs: observedAt,
          source: 'native-composer-submit',
        }
      : undefined
  const submission =
    payload?.action === 'next' &&
    composer &&
    messages.length === 1 &&
    typeof user?.id === 'string' &&
    user.id &&
    typeof payload.parent_message_id === 'string' &&
    payload.parent_message_id &&
    user.content &&
    typeof user.content === 'object' &&
    !Array.isArray(user.content)
      ? { message: structuredClone(user), parentMessageId: payload.parent_message_id }
      : undefined
  return {
    ...(selection ? { submissionSelection: selection } : {}),
    ...(submission ? { submission } : {}),
    ...(payload?.action === 'next' &&
    composer &&
    (!Object.hasOwn(payload, 'conversation_id') || payload.conversation_id === null) &&
    messages.length === 1 &&
    typeof user?.id === 'string' &&
    user.id &&
    typeof payload.parent_message_id === 'string' &&
    payload.parent_message_id &&
    user.content &&
    typeof user.content === 'object' &&
    !Array.isArray(user.content)
      ? {
          creation: {
            message: structuredClone(user),
            parentMessageId: payload.parent_message_id,
            ...(typeof payload.gizmo_id === 'string' &&
            /^g-p-[A-Za-z0-9_-]+$/.test(payload.gizmo_id) &&
            payload.gizmo_id.length <= 256
              ? { projectId: payload.gizmo_id }
              : {}),
          },
        }
      : {}),
    conversationId: typeof payload?.conversation_id === 'string' ? payload.conversation_id : null,
    userMessageId: typeof user?.id === 'string' ? user.id : null,
    ...(payload && Object.hasOwn(payload, 'conversation_origin')
      ? {
          conversationOrigin:
            typeof payload.conversation_origin === 'string' ? payload.conversation_origin : null,
        }
      : {}),
    startedAt: sourceStartedAt ?? observedAt,
    observedAt,
    source: sourceStartedAt ? 'message_create_time' : 'transport_request',
  }
}

function publishConversationRequest(
  detail: ConversationRequestEventDetail | null,
  accountId: string | null,
) {
  if (!observerTarget || !detail) return
  observerTarget.postMessage(
    {
      channel: TRANSPORT_CHANNEL,
      type: CONVERSATION_REQUEST_EVENT,
      detail: { ...detail, accountId },
    },
    observerTarget.location.origin,
  )
}

function conversationCatalogProjectId(sourceUrl: string): string | null | undefined {
  try {
    const url = new URL(sourceUrl, 'https://chatgpt.com/')
    if (url.origin !== 'https://chatgpt.com') return undefined
    if (url.pathname === '/backend-api/conversations') return null
    const match = url.pathname.match(/^\/backend-api\/gizmos\/([^/]+)\/conversations$/)
    return match?.[1] ? decodeURIComponent(match[1]) : undefined
  } catch {
    return undefined
  }
}

function isAccountCheckUrl(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl, 'https://chatgpt.com/')
    return (
      url.origin === 'https://chatgpt.com' &&
      /^\/backend-api\/accounts\/check(?:\/[^/]+)?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

function isConversationCatalogUrl(sourceUrl: string) {
  return conversationCatalogProjectId(sourceUrl) !== undefined
}
function nativeProjectDetailId(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl, 'https://chatgpt.com/')
    if (url.origin !== 'https://chatgpt.com') return null
    const match = url.pathname.match(/^\/backend-api\/gizmos\/([^/]+)$/)
    const id = match?.[1] ? decodeURIComponent(match[1]) : ''
    return id.startsWith('g-p-') && id.length > 4 && id.length <= 256 && !/[\s/?#]/.test(id) ? id : null
  } catch {
    return null
  }
}
/** Retain only source-confirmed project identity and display name. */
export function projectCatalogFromPayload(
  sourceUrl: string,
  payload: unknown,
  observedAt: number,
): ConversationCatalogEventDetail | null {
  const id = nativeProjectDetailId(sourceUrl)
  const gizmo = requestPayload(requestPayload(payload)?.gizmo)
  const title = requestPayload(gizmo?.display)?.name
  if (!id || gizmo?.id !== id || typeof title !== 'string' || !title.trim() || title.length > 4096)
    return null
  return { items: [], projects: [{ projectId: id, title }], observedAt }
}

export function conversationCatalogFromPayload(
  sourceUrl: string,
  payload: unknown,
  observedAt: number,
): ConversationCatalogEventDetail | null {
  const routeProjectId = conversationCatalogProjectId(sourceUrl)
  if (routeProjectId === undefined) return null
  const value = requestPayload(payload)
  const items = Array.isArray(value?.items) ? value.items : []
  const normalized = items.flatMap((item): ConversationCatalogItem[] => {
    const record = requestPayload(item)
    if (!record || typeof record.id !== 'string') return []
    const gizmoId =
      typeof record.gizmo_id === 'string' && record.gizmo_id.startsWith('g-p-') ? record.gizmo_id : null
    return [
      {
        conversationId: record.id,
        title: typeof record.title === 'string' ? record.title : null,
        projectId: Object.hasOwn(record, 'gizmo_id') ? gizmoId : routeProjectId,
        projectKnown: Object.hasOwn(record, 'gizmo_id') || routeProjectId !== null,
        conversationOrigin:
          typeof record.conversation_origin === 'string' ? record.conversation_origin : null,
      },
    ]
  })
  return normalized.length ? { items: normalized, observedAt } : null
}

function publishConversationCatalog(detail: ConversationCatalogEventDetail | null) {
  if (!observerTarget || !detail) return
  observerTarget.postMessage(
    { channel: TRANSPORT_CHANNEL, type: CONVERSATION_CATALOG_EVENT, detail },
    observerTarget.location.origin,
  )
}

function observeConversationCatalogResponse(
  response: Response,
  sourceUrl: string,
  accountId: string | null,
  requestEpoch: number,
  currentEpoch: () => number,
  requestStartedAt: number,
) {
  const projectDetail = nativeProjectDetailId(sourceUrl) !== null
  if (!response.ok || (!isConversationCatalogUrl(sourceUrl) && !projectDetail)) return
  if (projectDetail && !accountId) return
  const contentType = response.headers.get('content-type') ?? ''
  if (!/json/i.test(contentType)) return
  void response
    .clone()
    .json()
    .then((payload: unknown) => {
      if (currentEpoch() !== requestEpoch) return
      const detail = projectDetail
        ? projectCatalogFromPayload(sourceUrl, payload, Date.now())
        : conversationCatalogFromPayload(sourceUrl, payload, Date.now())
      if (detail) publishConversationCatalog({ ...detail, accountId, requestStartedAt })
    })
    .catch(() => undefined)
}

function isArchiveObservedUrl(sourceUrl: string) {
  return (
    sourceUrl.includes('/backend-api/conversations/') ||
    sourceUrl.includes('/backend-api/files/download/')
  )
}

function archiveNetwork(id: string, sourceUrl: string, phase: string, status?: number) {
  const conversationId = conversationHistoryId(sourceUrl)
  if (!conversationId || !captureAllowed(conversationId, archiveProjects.get(conversationId) ?? null))
    return
  observerTarget?.postMessage(
    {
      channel: TRANSPORT_CHANNEL,
      type: ARCHIVE_NETWORK_EVENT,
      detail: { id, conversationId, phase, status, timestamp: Date.now() },
    },
    observerTarget.location.origin,
  )
}
export const ARCHIVE_EVENT = 'chatgpt-booster:archive-event'
export const ARCHIVE_PRELOAD_EVENT = 'chatgpt-booster:archive-preload'

export type TransportKind = 'fetch' | 'xhr' | 'websocket' | 'eventsource'
export type TransportDirection = 'outbound' | 'inbound'
export type TransportPhase = 'request' | 'response' | 'message' | 'open' | 'close' | 'error'

export interface TransportObserverConfig {
  enabled: boolean
  captureBodies: boolean
  maxBodyChars: number
}

export interface TransportEventDetail {
  id: string
  kind: TransportKind
  direction: TransportDirection
  phase: TransportPhase
  timestamp: number
  method?: string | undefined
  url?: string | undefined
  status?: number | undefined
  durationMs?: number | undefined
  contentType?: string | undefined
  bodyPreview?: string | undefined
  size?: number | undefined
  error?: string | undefined
  errorClass?: 'aborted' | 'network' | 'stream' | 'socket' | undefined
}

/** Documented native composer submission fields only; never the prepare request. */
export const SUBMISSION_SELECTION_SCHEMA = 'chatgpt-submit-selection-2026-10-v1'
export interface ConversationSubmissionSelection {
  schema: typeof SUBMISSION_SELECTION_SCHEMA
  messageId: string
  requestedModel: string
  thinkingEffort: string | null
  effortPresent: boolean
  observedAtMs: number
  source: 'native-composer-submit'
}

export interface ConversationRequestEventDetail {
  requestId?: string
  accountId?: string | null
  submissionSelection?: ConversationSubmissionSelection
  /** Exact composer request original; existing conversation identity is already known. */
  submission?: { message: Record<string, unknown>; parentMessageId: string }
  /** Native first-submit evidence; the server must still assign this run a conversation ID. */
  creation?: { message: Record<string, unknown>; parentMessageId: string; projectId?: string }
  conversationId: string | null
  userMessageId: string | null
  conversationOrigin?: string | null
  startedAt: number
  observedAt: number
  source: 'message_create_time' | 'transport_request'
}

export interface ConversationStopEventDetail {
  requestId?: string | undefined
  conversationId: string | null
  phase: 'requested' | 'confirmed' | 'failed'
  timestamp: number
  status: number | null
}

export type ConversationStreamStatus = 'IS_STREAMING' | 'COMPLETE' | 'FAILURE' | 'UNAVAILABLE'

export interface ConversationStreamStatusEventDetail {
  requestId?: string
  conversationId: string
  status: ConversationStreamStatus
  observedAt: number
  httpStatus: number
}

export type ConversationStreamEventDetail = (
  | {
      conversationId: string
      kind: 'handoff'
      observedAt: number
    }
  | {
      conversationId: string | null
      kind: 'message'
      record: Record<string, unknown>
      evidence?: readonly Record<string, unknown>[]
      observedAt: number
    }
  | {
      conversationId: string | null
      kind: 'complete'
      phase: 'main' | 'message'
      observedAt: number
    }
  | {
      conversationId: string | null
      kind: 'async-status'
      asyncStatus: number | string | null
      observedAt: number
    }
  | {
      conversationId: string | null
      kind: 'safety-review'
      active: boolean
      protectionType: 'bio' | 'cyber' | null
      message: string | null
      observedAt: number
    }
  | {
      conversationId: string | null
      kind: 'error'
      errorCode: string | null
      errorReason: string | null
      canRetry: boolean | null
      observedAt: number
    }
) & {
  accountId?: string | null
  requestId?: string | undefined
  userMessageId?: string | null | undefined
}

export interface ConversationCatalogItem {
  projectKnown?: boolean
  conversationId: string
  title?: string | null
  projectId: string | null
  conversationOrigin: string | null
}

/**
 * A native catalog selector must match a validated native registry result (network or
 * explicitly bound method). A single-account network registry can also prove an owner.
 * Never infer the selected account from an arbitrary page message or default record alone.
 */
export interface ConversationAccountEventDetail {
  accountId: string | null
  observedAt: number
}

export interface ConversationCatalogEventDetail {
  requestStartedAt?: number
  items: ConversationCatalogItem[]
  projects?: { projectId: string; title: string }[]
  observedAt: number
  accountId?: string | null
}

export interface ArchiveAssetResolutionEventDetail {
  assetId: string
  downloadUrl: string
  fileName: string | null
  mimeType: string | null
  fileSizeBytes: number | null
  observedAt: number
}

export interface ConversationArchiveEventDetail {
  kind: 'conversation-page'
  readId?: string | undefined
  readStartedAt?: number | undefined
  accountId?: string | null | undefined
  isInitial?: boolean | undefined
  requestedBefore?: string | null | undefined
  timestamp: number
  sourceUrl: string
  conversationId: string
  payload: Record<string, unknown>
}

const DEFAULT_CONFIG: TransportObserverConfig = {
  enabled: false,
  captureBodies: false,
  maxBodyChars: 2048,
}

const SECRET_KEY =
  /(authorization|cookie|token|secret|password|passwd|api[-_]?key|session|credential|verify|turnstile|proof|challenge)/i

const JSON_SECRET_VALUE =
  /("(?:authorization|cookie|token|secret|password|passwd|api[-_]?key|session|credential|verify|turnstile|proof|challenge)[^"]*"\s*:\s*")[^"]*(")/gi
const QUERY_SECRET_TEXT =
  /([?&](?:token|access_token|api_key|key|session|secret|auth|verify|turnstile|proof|challenge)=)[^&#\s"]*/gi
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g

function redactTextSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(JSON_SECRET_VALUE, '$1[REDACTED]$2')
    .replace(QUERY_SECRET_TEXT, '$1[REDACTED]')
    .replace(JWT_LIKE, '[REDACTED_JWT]')
}

function classifyError(error: unknown): {
  message: string
  errorClass: 'aborted' | 'network' | 'stream'
} {
  const message =
    error instanceof Error
      ? error.message.slice(0, 300)
      : String(error || 'transport failed').slice(0, 300)
  const name = error instanceof Error ? error.name : ''
  if (
    name === 'AbortError' ||
    /abort(ed|ing)?|signal is aborted|BodyStreamBuffer was aborted/i.test(message)
  ) {
    return { message, errorClass: 'aborted' }
  }
  if (/stream/i.test(message)) return { message, errorClass: 'stream' }
  return { message, errorClass: 'network' }
}

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i
const LONG_ID = /^[A-Za-z0-9_-]{24,}$/

export function sanitizeTransportUrl(
  input: string,
  baseHref = typeof location === 'undefined' ? 'https://chatgpt.com/' : location.href,
): string {
  try {
    const url = new URL(input, baseHref)
    for (const [key] of url.searchParams) {
      if (SECRET_KEY.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    url.pathname = url.pathname
      .split('/')
      .map((part) => (UUIDISH.test(part) || LONG_ID.test(part) ? ':id' : part))
      .join('/')
    return url.toString()
  } catch {
    return input.slice(0, 512)
  }
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]'
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      result[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redact(child, depth + 1)
    }
    return result
  }
  if (typeof value === 'string' && /Bearer\s+[A-Za-z0-9._~+/-]+=*/i.test(value)) {
    return '[REDACTED]'
  }
  return value
}

export function sanitizeBodyPreview(value: unknown, maxChars: number): string | undefined {
  if (value == null) return undefined

  let text: string
  if (typeof value === 'string') {
    try {
      text = JSON.stringify(redact(JSON.parse(value)))
    } catch {
      text = value
    }
  } else if (value instanceof URLSearchParams) {
    const params = new URLSearchParams(value)
    for (const [key] of params) if (SECRET_KEY.test(key)) params.set(key, '[REDACTED]')
    text = params.toString()
  } else if (value instanceof FormData) {
    const result: Record<string, unknown> = {}
    for (const [key, child] of value.entries()) {
      result[key] = SECRET_KEY.test(key)
        ? '[REDACTED]'
        : typeof child === 'string'
          ? child
          : `[Blob ${(child as Blob).type || 'unknown'} ${(child as Blob).size}B]`
    }
    text = JSON.stringify(result)
  } else if (value instanceof Blob) {
    return `[Blob ${value.type || 'unknown'} ${value.size}B]`
  } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return '[Binary]'
  } else {
    try {
      text = JSON.stringify(redact(value))
    } catch {
      text = String(value)
    }
  }

  const redacted = redactTextSecrets(text)
  return redacted.length > maxChars ? `${redacted.slice(0, maxChars)}…` : redacted
}

let observerTarget: Window | undefined = typeof window === 'undefined' ? undefined : window
let transportEmissionEnabled = false
let transportBatch: TransportEventDetail[] = []
let transportBatchTimer: ReturnType<typeof setTimeout> | undefined
const TRANSPORT_BATCH_DELAY_MS = 50
const TRANSPORT_BATCH_MAX = 50

function flushTransportBatch() {
  if (transportBatchTimer) {
    clearTimeout(transportBatchTimer)
    transportBatchTimer = undefined
  }
  if (!observerTarget || transportBatch.length === 0) {
    transportBatch = []
    return
  }
  const details = transportBatch
  transportBatch = []
  observerTarget.postMessage(
    {
      channel: TRANSPORT_CHANNEL,
      type: TRANSPORT_BATCH_EVENT,
      details,
    },
    '*',
  )
}

function emit(detail: TransportEventDetail) {
  if (!observerTarget || !transportEmissionEnabled) return
  transportBatch.push(detail)
  if (transportBatch.length >= TRANSPORT_BATCH_MAX) {
    flushTransportBatch()
    return
  }
  transportBatchTimer ??= setTimeout(flushTransportBatch, TRANSPORT_BATCH_DELAY_MS)
}

function conversationHistoryId(input: string): string | undefined {
  try {
    const url = new URL(input, location.href)
    if (url.origin !== 'https://chatgpt.com') return undefined
    const match = url.pathname.match(/^\/backend-api\/conversations\/([^/]+)(?:\/messages)?$/)
    return match?.[1] ? decodeURIComponent(match[1]) : undefined
  } catch {
    return undefined
  }
}

export function archiveFileResolverId(input: string): string | undefined {
  try {
    const url = new URL(input, 'https://chatgpt.com')
    if (url.origin !== 'https://chatgpt.com') return undefined
    const match = url.pathname.match(/^\/backend-api\/files\/download\/(file_[A-Za-z0-9_-]+)$/)
    return match?.[1]
  } catch {
    return undefined
  }
}

export function archiveAssetContentUrl(value: string, assetId: string): string | null {
  try {
    const url = new URL(value, 'https://chatgpt.com')
    if (
      url.origin === 'https://chatgpt.com' &&
      url.pathname === '/backend-api/estuary/content' &&
      url.searchParams.get('id') === assetId
    )
      return url.href
  } catch {
    // Invalid or non-ChatGPT URL.
  }
  return null
}

export async function fetchArchiveAssetBytes(
  value: string,
  assetId: string,
  target: Window = window,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const url = archiveAssetContentUrl(value, assetId)
  if (!url) throw new Error('Invalid archive asset URL')
  if (signal?.aborted)
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
  const requestId = `asset-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      target.removeEventListener('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      target.postMessage(
        {
          channel: TRANSPORT_CHANNEL,
          type: ARCHIVE_ASSET_FETCH_CANCEL_EVENT,
          detail: { requestId, assetId },
        },
        target.location.origin,
      )
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== target.location.origin || event.source !== target) return
      const data = event.data
      if (
        data?.channel !== TRANSPORT_CHANNEL ||
        data.type !== ARCHIVE_ASSET_FETCH_RESULT_EVENT ||
        data.detail?.requestId !== requestId ||
        data.detail?.assetId !== assetId
      )
        return
      cleanup()
      if (data.detail.ok === true && data.detail.bytes instanceof ArrayBuffer) {
        resolve(data.detail.bytes)
        return
      }
      reject(new Error(typeof data.detail.error === 'string' ? data.detail.error : 'Asset fetch failed'))
    }
    const timer = setTimeout(() => {
      cleanup()
      target.postMessage(
        {
          channel: TRANSPORT_CHANNEL,
          type: ARCHIVE_ASSET_FETCH_CANCEL_EVENT,
          detail: { requestId, assetId },
        },
        target.location.origin,
      )
      reject(new Error('Asset fetch timed out'))
    }, 30_000)
    target.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort, { once: true })
    target.postMessage(
      {
        channel: TRANSPORT_CHANNEL,
        type: ARCHIVE_ASSET_FETCH_REQUEST_EVENT,
        detail: { requestId, assetId, url },
      },
      target.location.origin,
    )
  })
}

export function parseArchiveAssetResolution(
  value: unknown,
  assetId: string,
): ArchiveAssetResolutionEventDetail | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const payload = value as Record<string, unknown>
  if (payload.status !== 'success' || typeof payload.download_url !== 'string') return undefined
  const downloadUrl = archiveAssetContentUrl(payload.download_url, assetId)
  if (!downloadUrl) return undefined
  try {
    return {
      assetId,
      downloadUrl,
      fileName: typeof payload.file_name === 'string' ? payload.file_name : null,
      mimeType: typeof payload.mime_type === 'string' ? payload.mime_type : null,
      fileSizeBytes:
        typeof payload.file_size_bytes === 'number' && Number.isFinite(payload.file_size_bytes)
          ? payload.file_size_bytes
          : null,
      observedAt: Date.now(),
    }
  } catch {
    return undefined
  }
}

function publishAssetResolution(value: unknown, sourceUrl: string) {
  const assetId = archiveFileResolverId(sourceUrl)
  if (!observerTarget || !assetId) return
  const detail = parseArchiveAssetResolution(value, assetId)
  if (!detail) return
  observerTarget.postMessage(
    { channel: TRANSPORT_CHANNEL, type: ARCHIVE_ASSET_EVENT, detail },
    observerTarget.location.origin,
  )
}

function observeArchiveAssetResponse(response: Response, sourceUrl: string) {
  if (!response.ok || !archiveFileResolverId(sourceUrl)) return
  void response
    .clone()
    .json()
    .then((value: unknown) => publishAssetResolution(value, sourceUrl))
    .catch(() => undefined)
}

function isConversationHistoryPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    Array.isArray(record.messages) && Boolean(record.page_info && typeof record.page_info === 'object')
  )
}

function observeConversationArchiveResponse(
  response: Response,
  sourceUrl: string,
  read: ArchiveReadContext | undefined,
  activeAccountEpoch: () => number,
) {
  const conversationId = conversationHistoryId(sourceUrl)
  if (!observerTarget || !response.ok || !conversationId || !read) return
  if (read.accountEpoch !== activeAccountEpoch()) return
  if (!read.isInitial && !shouldObserveArchiveConversation(conversationId)) return

  const contentType = response.headers.get('content-type') ?? ''
  if (!/json/i.test(contentType)) return

  const declaredSize = Number(response.headers.get('content-length')) || 0
  if (declaredSize > 32 * 1024 * 1024) return

  void response
    .clone()
    .json()
    .then((payload: unknown) => {
      if (!observerTarget || read.accountEpoch !== activeAccountEpoch()) return
      if (!isConversationHistoryPayload(payload)) {
        // Malformed history must not disappear silently: an archive-only gate takes over.
        // Keep message text and nested transport payload out of diagnostics.
        if (shouldObserveArchiveConversation(conversationId))
          observerTarget.postMessage(
            {
              channel: TRANSPORT_CHANNEL,
              type: ARCHIVE_CONTRACT_ERROR_EVENT,
              detail: { conversationId, path: 'payload.messages/page_info' },
            },
            observerTarget.location.origin,
          )
        return
      }
      const detail = {
        kind: 'conversation-page',
        ...read,
        timestamp: Date.now(),
        sourceUrl,
        conversationId,
        payload,
      } satisfies ConversationArchiveEventDetail
      // Keep a small per-chat initial-page buffer. ChatGPT can resolve a prefetched initial
      // request just before SPA navigation commits the new /c/{id} URL. We still publish only
      // when that conversation is actually current, so sidebar/background prefetches stay inert.
      const buffered = bufferedInitialPages.get(conversationId)
      if (
        read.isInitial &&
        (!buffered ||
          read.readStartedAt > (buffered.readStartedAt ?? buffered.timestamp) ||
          (read.readId === buffered.readId && detail.timestamp >= buffered.timestamp))
      ) {
        bufferedInitialPages.delete(conversationId)
        bufferedInitialPages.set(conversationId, detail)
        while (bufferedInitialPages.size > 32) {
          const oldest = bufferedInitialPages.keys().next().value
          if (!oldest) break
          bufferedInitialPages.delete(oldest)
        }
      }
      const projectId = archiveProjectId(payload, conversationId)
      if (!captureAllowed(conversationId, projectId)) publishPreloadPage(detail)
      publishConversationPage(detail)
    })
    .catch(() => undefined)
}

function observeFetchResponseBody(
  response: Response,
  context: { id: string; method: string; url: string },
  config: TransportObserverConfig,
) {
  if (!config.captureBodies) return

  const contentType = response.headers.get('content-type') ?? ''
  if (!/(text|json|event-stream|javascript|xml)/i.test(contentType)) return

  const body = response.clone().body
  if (!body) return

  const reader = body.getReader()
  const decoder = new TextDecoder()

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        if (!text) continue
        emit({
          id: context.id,
          kind: 'fetch',
          direction: 'inbound',
          phase: 'message',
          timestamp: Date.now(),
          method: context.method,
          url: context.url,
          contentType,
          size: value.byteLength,
          bodyPreview: sanitizeBodyPreview(text, config.maxBodyChars),
        })
      }
    } catch (error) {
      const classified = classifyError(error)
      emit({
        id: context.id,
        kind: 'fetch',
        direction: 'inbound',
        phase: 'error',
        timestamp: Date.now(),
        method: context.method,
        url: context.url,
        error: classified.message,
        errorClass: classified.errorClass,
      })
    } finally {
      reader.releaseLock()
    }
  })()
}

let sequence = 0
let observerIdentity: string | undefined
function nextId(kind: TransportKind) {
  observerIdentity ??= crypto.randomUUID()
  sequence += 1
  return `${kind}-${observerIdentity}-${sequence}`
}

export function installTransportObserver(
  target: Window & typeof globalThis = window as Window & typeof globalThis,
): () => void {
  // Two installed DEV/PROD userscripts must never share one observer marker.
  const marker = '__chatgptBoosterTransportObserverInstalled__:' + TRANSPORT_CHANNEL
  const tagged = target as Window & typeof globalThis & Record<string, unknown>
  if (tagged[marker]) return () => undefined
  tagged[marker] = true
  // Cross-bundle registry: userscript DEV/PROD and MV3 MAIN-world observers
  // can be present on the same host page. Preserve the ORIGINAL host APIs
  // until the final live layer is detached, without disabling a sibling.
  const registryKey = '__kobaBrowserNativeHookLayers__'
  type HookRegistry = {
    active: Set<string>
    originalFetch: PropertyDescriptor | undefined
    hostFetch: typeof target.fetch
    originalXhrOpen: typeof XMLHttpRequest.prototype.open
    originalXhrSend: typeof XMLHttpRequest.prototype.send
    originalWebSocket: typeof target.WebSocket
    originalEventSource: typeof target.EventSource
    fetchGetters: Set<() => typeof target.fetch>
    xhrOpens: Set<typeof XMLHttpRequest.prototype.open>
    xhrSends: Set<typeof XMLHttpRequest.prototype.send>
  }
  let shared = tagged[registryKey] as HookRegistry | undefined
  if (!shared) {
    shared = {
      active: new Set(),
      originalFetch: Object.getOwnPropertyDescriptor(target, 'fetch'),
      hostFetch: target.fetch,
      originalXhrOpen: target.XMLHttpRequest.prototype.open,
      originalXhrSend: target.XMLHttpRequest.prototype.send,
      originalWebSocket: target.WebSocket,
      originalEventSource: target.EventSource,
      fetchGetters: new Set(),
      xhrOpens: new Set(),
      xhrSends: new Set(),
    }
    tagged[registryKey] = shared
  }
  shared.active.add(marker)
  let observerActive = true
  observerTarget = target

  archivePolicy = { ...DENY_ARCHIVE }
  let verifiedAccountIds = new Set<string>()
  let nativeRegistrySelectedId: string | null = null
  let selectedAccountId: string | null = null
  let confirmedCatalogAccountId: string | null = null
  let emittedAccountId: string | null = null
  let accountEpoch = 0
  const activeRuns = new Map<string, { id: string; at: number }>()
  const nativeStreamRuns = new Map<string, { id: string; at: number }>()
  // Selection changes, not request count or page-load timing, govern whether
  // a native account-registry response is still attributable to this account.
  let accountSelectionSerial = 0

  const publishAccount = (accountId: string | null, observedAt: number) => {
    if (emittedAccountId === accountId) return
    emittedAccountId = accountId
    accountEpoch += 1
    // Cached request pages from a prior account must never be replayed as
    // belonging to the new selected account.
    archiveReads.clear()
    activeRuns.clear()
    nativeStreamRuns.clear()
    archiveProjects.clear()
    bufferedInitialPages.clear()
    target.postMessage(
      {
        channel: TRANSPORT_CHANNEL,
        type: CONVERSATION_ACCOUNT_EVENT,
        detail: { accountId, observedAt } satisfies ConversationAccountEventDetail,
      },
      target.location.origin,
    )
  }

  const verifyAccountCatalog = (
    response: Response,
    selectionSerialAtRequest: number,
    selectedAtRequest: string | null,
  ) => {
    if (!response.ok || !/json/i.test(response.headers.get('content-type') ?? '')) return
    void response
      .clone()
      .json()
      .then((value: unknown) => {
        // Native registry and conversation catalog requests can overlap and
        // complete in either order. Accept one initial null -> selected account
        // transition, but not a response which spans another selection (even
        // an A -> B -> A change that returns to the same string).
        const unchanged =
          accountSelectionSerial === selectionSerialAtRequest && selectedAtRequest === selectedAccountId
        const initialSelection =
          selectedAtRequest === null &&
          selectedAccountId !== null &&
          accountSelectionSerial === selectionSerialAtRequest + 1
        if (!unchanged && !initialSelection) return
        const root = requestPayload(value)
        const accounts = requestPayload(root?.accounts)
        if (!accounts) return
        const ids = new Set<string>()
        for (const [key, raw] of Object.entries(accounts)) {
          if (key === 'default') continue
          const account = requestPayload(requestPayload(raw)?.account)
          if (typeof account?.account_id === 'string' && account.account_id === key) ids.add(key)
        }
        verifiedAccountIds = ids
        nativeRegistrySelectedId = null
        const confirmedByCatalog =
          selectedAccountId &&
          confirmedCatalogAccountId === selectedAccountId &&
          ids.has(selectedAccountId)
            ? selectedAccountId
            : null
        // Some ChatGPT routes hydrate the sidebar without a conversation
        // catalog request. The native registry itself identifies the owner
        // unambiguously if it contains exactly one validated account. Do not
        // infer a preferred owner when multiple accounts exist.
        const confirmedByUniqueRegistry =
          selectedAccountId === null && ids.size === 1 ? (ids.values().next().value ?? null) : null
        publishAccount(confirmedByCatalog ?? confirmedByUniqueRegistry, Date.now())
      })
      .catch(() => undefined)
  }

  const observeAccountSelector = (
    sourceUrl: string,
    method: string,
    headerValue: string | null,
    observedAt: number,
  ) => {
    if (method.toUpperCase() !== 'GET' || !isConversationCatalogUrl(sourceUrl)) return
    if ((headerValue?.trim() || null) !== selectedAccountId) return
    confirmedCatalogAccountId = selectedAccountId
    const confirmed =
      selectedAccountId &&
      verifiedAccountIds.has(selectedAccountId) &&
      (nativeRegistrySelectedId === null || nativeRegistrySelectedId === selectedAccountId)
        ? selectedAccountId
        : null
    publishAccount(confirmed, observedAt)
  }

  const unregisterNativeAccount = registerNativeAccountConsumer(target, {
    begin: () => ({ selected: selectedAccountId, serial: accountSelectionSerial }),
    accept(registry, ticket) {
      if (!observerActive) return
      const started = ticket as { selected: string | null; serial: number }
      const unchanged =
        started.serial === accountSelectionSerial && started.selected === selectedAccountId
      const initialSelection =
        started.selected === null &&
        selectedAccountId === registry.selectedAccountId &&
        accountSelectionSerial === started.serial + 1
      if (!unchanged && !initialSelection) return
      if (selectedAccountId !== null && selectedAccountId !== registry.selectedAccountId) return
      verifiedAccountIds = new Set(registry.accountIds)
      nativeRegistrySelectedId = registry.selectedAccountId
      publishAccount(
        confirmedCatalogAccountId === registry.selectedAccountId &&
          selectedAccountId === registry.selectedAccountId &&
          verifiedAccountIds.has(registry.selectedAccountId)
          ? registry.selectedAccountId
          : null,
        Date.now(),
      )
    },
  })

  const onArchivePolicy = (event: MessageEvent) => {
    if (event.origin !== target.location.origin || event.source !== target) return
    const data = event.data
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== ARCHIVE_POLICY_EVENT || !data.detail) return
    archivePolicy = { ...DENY_ARCHIVE, ...data.detail }
    const id = pageConversationId()
    const currentBuffered = id ? bufferedInitialPages.get(id) : undefined
    if (currentBuffered) {
      // Reuse exactly the observed source read. Manual consent is NOT a new
      // native response and cannot advance its timestamp or invent a read ID.
      publishPreloadPage(currentBuffered)
      if (archivePolicy.manualConversationId === id) publishConversationPage(currentBuffered)
    }
  }

  target.addEventListener('message', onArchivePolicy)
  let config = { ...DEFAULT_CONFIG }
  const onConfig = (event: MessageEvent) => {
    if (event.origin && event.origin !== target.location.origin) return
    const data = event.data as {
      channel?: string
      type?: string
      detail?: Partial<TransportObserverConfig>
    }
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== TRANSPORT_CONFIG_EVENT) return

    const detail = data.detail
    config = {
      enabled: detail?.enabled ?? config.enabled,
      captureBodies: detail?.captureBodies ?? config.captureBodies,
      maxBodyChars: Math.min(Math.max(detail?.maxBodyChars ?? config.maxBodyChars, 128), 16384),
    }
    transportEmissionEnabled = config.enabled
    setRealtimeTransportHooksEnabled(transportEmissionEnabled)
    if (!transportEmissionEnabled) flushTransportBatch()
  }
  target.addEventListener('message', onConfig)

  const fetchWrapperMarker = '__chatgptBoosterFetchWrapper__'
  type TaggedFetch = typeof target.fetch & { [fetchWrapperMarker]?: boolean }
  const originalFetchDescriptor = Object.getOwnPropertyDescriptor(target, 'fetch')
  let fetchHost = target.fetch
  let fetchWrapper: typeof target.fetch
  let fetchCallDepth = 0
  const archiveAssetFetches = new Map<string, AbortController>()
  const onArchiveAssetFetch = (event: MessageEvent) => {
    if (event.origin !== target.location.origin || event.source !== target) return
    const data = event.data
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== ARCHIVE_ASSET_FETCH_REQUEST_EVENT) return
    const detail = data.detail as { requestId?: unknown; assetId?: unknown; url?: unknown } | undefined
    if (
      typeof detail?.requestId !== 'string' ||
      typeof detail.assetId !== 'string' ||
      typeof detail.url !== 'string'
    )
      return
    const safeUrl = archiveAssetContentUrl(detail.url, detail.assetId)
    if (!safeUrl) return
    const controller = new AbortController()
    archiveAssetFetches.set(detail.requestId, controller)
    void (async () => {
      try {
        const response = await fetchHost.call(target, safeUrl, {
          credentials: 'omit',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const announced = Number(response.headers.get('content-length'))
        if (Number.isFinite(announced) && announced > 512 * 1024 * 1024)
          throw new Error('Asset exceeds 512 MiB export limit')
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > 512 * 1024 * 1024) throw new Error('Asset exceeds 512 MiB export limit')
        target.postMessage(
          {
            channel: TRANSPORT_CHANNEL,
            type: ARCHIVE_ASSET_FETCH_RESULT_EVENT,
            detail: {
              requestId: detail.requestId,
              assetId: detail.assetId,
              ok: true,
              bytes: buffer,
            },
          },
          target.location.origin,
          [buffer],
        )
      } catch (error) {
        if (controller.signal.aborted) return
        target.postMessage(
          {
            channel: TRANSPORT_CHANNEL,
            type: ARCHIVE_ASSET_FETCH_RESULT_EVENT,
            detail: {
              requestId: detail.requestId,
              assetId: detail.assetId,
              ok: false,
              error: error instanceof Error ? error.message : 'Asset fetch failed',
            },
          },
          target.location.origin,
        )
      } finally {
        archiveAssetFetches.delete(detail.requestId as string)
      }
    })()
  }
  const onArchiveAssetFetchCancel = (event: MessageEvent) => {
    if (event.origin !== target.location.origin || event.source !== target) return
    const data = event.data
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== ARCHIVE_ASSET_FETCH_CANCEL_EVENT) return
    const requestId = data.detail?.requestId
    if (typeof requestId === 'string') archiveAssetFetches.get(requestId)?.abort()
  }
  target.addEventListener('message', onArchiveAssetFetch)
  target.addEventListener('message', onArchiveAssetFetchCancel)

  const createFetchWrapper = (upstream: typeof target.fetch): typeof target.fetch => {
    const callUpstream = (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCallDepth += 1
      try {
        return upstream.call(target, input, init)
      } finally {
        fetchCallDepth -= 1
      }
    }

    const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (!observerActive) return callUpstream(input, init)
      if (fetchCallDepth > 0) return upstream.call(target, input, init)
      const request = input instanceof Request ? input : undefined
      const rawUrl = request?.url ?? String(input)

      // Transport diagnostics are opt-in. Keep ordinary ChatGPT fetches on the host's
      // original promise path when diagnostics are disabled; only archive history/file
      // resolver routes still need observation in that mode.
      if (
        !transportEmissionEnabled &&
        !isArchiveObservedUrl(rawUrl) &&
        !isConversationRequestUrl(rawUrl) &&
        !isConversationStopUrl(rawUrl) &&
        !isConversationStreamStatusUrl(rawUrl) &&
        !isConversationCatalogUrl(rawUrl) &&
        !nativeProjectDetailId(rawUrl) &&
        !isAccountCheckUrl(rawUrl)
      )
        return callUpstream(input, init)

      return (async () => {
        const diagnosticsEnabled = transportEmissionEnabled
        const id = nextId('fetch')
        const started = diagnosticsEnabled ? performance.now() : 0
        const method = init?.method ?? request?.method ?? 'GET'
        const url = diagnosticsEnabled ? sanitizeTransportUrl(rawUrl) : ''
        const body =
          diagnosticsEnabled && config.captureBodies
            ? sanitizeBodyPreview(init?.body, config.maxBodyChars)
            : undefined
        const requestBoundaryAt = Date.now()
        const accountSelectedAtRequest = selectedAccountId
        const selectionSerialAtRequest = accountSelectionSerial
        const headers = new Headers(request?.headers)
        if (init?.headers)
          new Headers(init.headers).forEach((value, key) => {
            headers.set(key, value)
          })
        const projectOwnerAtRequest =
          emittedAccountId &&
          (!headers.get('chatgpt-account-id')?.trim() ||
            headers.get('chatgpt-account-id')?.trim() === emittedAccountId)
            ? emittedAccountId
            : null
        // Revoke the verified account immediately when native ChatGPT starts
        // selecting another one, not after a potentially slow response.
        if (method.toUpperCase() === 'GET' && isConversationCatalogUrl(rawUrl)) {
          const candidate = headers.get('chatgpt-account-id')?.trim() || null
          if (candidate !== selectedAccountId) {
            selectedAccountId = candidate
            accountSelectionSerial++
            confirmedCatalogAccountId = null
            if (emittedAccountId === null) accountEpoch += 1
            publishAccount(null, requestBoundaryAt)
          }
        }
        const conversationRequest = conversationRequestTimingFromBody(
          rawUrl,
          method,
          init?.body,
          requestBoundaryAt,
        )
        if (conversationRequest?.conversationId)
          activeRuns.set(conversationRequest.conversationId, { id, at: requestBoundaryAt })
        const statusConversationId = conversationStreamStatusTarget(rawUrl)
        const statusRunAtRequest = statusConversationId
          ? activeRuns.get(statusConversationId)?.id
          : undefined
        const resumeConversationId = isConversationResumeUrl(rawUrl)
          ? conversationIdFromBody(init?.body)
          : null
        const resumeRunAtRequest = resumeConversationId
          ? activeRuns.get(resumeConversationId)?.id
          : undefined
        publishConversationRequest(
          conversationRequest ? { ...conversationRequest, requestId: id } : null,
          emittedAccountId,
        )
        const stopConversationId = conversationStopTargetFromBody(rawUrl, method, init?.body)
        const stopRunAtRequest = stopConversationId ? activeRuns.get(stopConversationId)?.id : undefined
        if (stopConversationId)
          publishConversationStop({
            conversationId: stopConversationId,
            requestId: stopRunAtRequest,
            phase: 'requested',
            timestamp: requestBoundaryAt,
            status: null,
          })

        if (diagnosticsEnabled)
          emit({
            id,
            kind: 'fetch',
            direction: 'outbound',
            phase: 'request',
            timestamp: requestBoundaryAt,
            method,
            url,
            ...(body ? { bodyPreview: body } : {}),
          })

        const historyRead = beginArchiveRequest(rawUrl, id, emittedAccountId, accountEpoch)
        const accountCheckEpoch = accountEpoch
        archiveNetwork(id, rawUrl, 'request')
        try {
          const response = await callUpstream(input, init)
          if (!response.ok && (conversationRequest || resumeConversationId)) {
            void response
              .clone()
              .json()
              .catch(() => null)
              .then((payload) => {
                if (accountCheckEpoch !== accountEpoch || !observerActive) return
                publishConversationStream({
                  conversationId: conversationRequest?.conversationId ?? resumeConversationId,
                  kind: 'error',
                  errorCode: conversationRequestErrorCode(
                    payload,
                    response.status,
                    resumeConversationId ? 'network_error' : 'request_rejected',
                  ),
                  errorReason: null,
                  canRetry: response.status === 429 || response.status >= 500,
                  observedAt: Date.now(),
                  accountId: emittedAccountId,
                  requestId: conversationRequest ? id : resumeRunAtRequest,
                  userMessageId: conversationRequest?.userMessageId ?? null,
                })
              })
          }
          if (stopConversationId)
            publishConversationStop({
              conversationId: stopConversationId,
              requestId: stopRunAtRequest,
              phase: response.ok ? 'confirmed' : 'failed',
              timestamp: Date.now(),
              status: response.status,
            })
          archiveNetwork(id, rawUrl, response.ok ? 'response' : 'error', response.status)
          observeConversationArchiveResponse(response, rawUrl, historyRead, () => accountEpoch)
          if (accountCheckEpoch === accountEpoch) {
            if (response.ok)
              observeAccountSelector(
                rawUrl,
                method,
                headers.get('chatgpt-account-id'),
                requestBoundaryAt,
              )
            // Account confirmation caused by this request is allowed. A request
            // spanning another account selection is discarded, including A→B→A.
            if (method.toUpperCase() === 'GET' || !nativeProjectDetailId(rawUrl))
              observeConversationCatalogResponse(
                response,
                rawUrl,
                nativeProjectDetailId(rawUrl) ? projectOwnerAtRequest : emittedAccountId,
                accountEpoch,
                () => (observerActive ? accountEpoch : -1),
                requestBoundaryAt,
              )
          }
          if (method.toUpperCase() === 'GET' && isAccountCheckUrl(rawUrl))
            verifyAccountCatalog(response, selectionSerialAtRequest, accountSelectedAtRequest)
          observeConversationStreamStatusResponse(response, rawUrl, statusRunAtRequest)
          if (method.toUpperCase() === 'POST' && isConversationRequestUrl(rawUrl))
            observeConversationStreamResponse(
              response,
              conversationIdFromBody(init?.body),
              historyRead?.accountId ?? emittedAccountId,
              accountCheckEpoch,
              () => accountEpoch,
              id,
              conversationRequest?.userMessageId ?? null,
              (nativeId, message) => {
                if ((activeRuns.get(nativeId)?.at ?? 0) <= requestBoundaryAt)
                  activeRuns.set(nativeId, { id, at: requestBoundaryAt })
                const nativeRequestId = requestPayload(message?.metadata)?.request_id
                if (
                  typeof nativeRequestId === 'string' &&
                  nativeRequestId.length > 0 &&
                  nativeRequestId.length <= 1024
                ) {
                  nativeStreamRuns.set(JSON.stringify([nativeId, nativeRequestId]), {
                    id,
                    at: requestBoundaryAt,
                  })
                  if (nativeStreamRuns.size > 128) {
                    const oldest = nativeStreamRuns.keys().next().value
                    if (oldest !== undefined) nativeStreamRuns.delete(oldest)
                  }
                }
              },
            )
          if (method.toUpperCase() === 'POST' && resumeConversationId)
            observeConversationStreamResponse(
              response,
              resumeConversationId,
              emittedAccountId,
              accountCheckEpoch,
              () => accountEpoch,
              resumeRunAtRequest ?? id,
              null,
              () => undefined,
            )
          observeArchiveAssetResponse(response, rawUrl)
          if (diagnosticsEnabled) {
            observeFetchResponseBody(response, { id, method, url }, config)
            emit({
              id,
              kind: 'fetch',
              direction: 'inbound',
              phase: 'response',
              timestamp: Date.now(),
              method,
              url,
              status: response.status,
              durationMs: Math.round((performance.now() - started) * 100) / 100,
              contentType: response.headers.get('content-type') ?? undefined,
              size: Number(response.headers.get('content-length')) || undefined,
            })
          }
          return response
        } catch (error) {
          if ((conversationRequest || resumeConversationId) && accountCheckEpoch === accountEpoch)
            publishConversationStream({
              conversationId: conversationRequest?.conversationId ?? resumeConversationId,
              kind: 'error',
              errorCode: 'network_error',
              errorReason: null,
              canRetry: true,
              observedAt: Date.now(),
              accountId: emittedAccountId,
              requestId: conversationRequest ? id : resumeRunAtRequest,
              userMessageId: conversationRequest?.userMessageId ?? null,
            })
          if (stopConversationId)
            publishConversationStop({
              conversationId: stopConversationId,
              requestId: stopRunAtRequest,
              phase: 'failed',
              timestamp: Date.now(),
              status: null,
            })
          archiveNetwork(id, rawUrl, 'error', 0)
          if (diagnosticsEnabled) {
            const classified = classifyError(error)
            emit({
              id,
              kind: 'fetch',
              direction: 'inbound',
              phase: 'error',
              timestamp: Date.now(),
              method,
              url,
              durationMs: Math.round((performance.now() - started) * 100) / 100,
              error: classified.message,
              errorClass: classified.errorClass,
            })
          }
          throw error
        }
      })()
    }) as typeof target.fetch
    Object.defineProperty(wrapped, fetchWrapperMarker, { value: true })
    return wrapped
  }

  fetchWrapper = createFetchWrapper(fetchHost)
  const ownFetchGetter = () => fetchWrapper
  shared.fetchGetters.add(ownFetchGetter)
  Object.defineProperty(target, 'fetch', {
    configurable: true,
    enumerable: originalFetchDescriptor?.enumerable ?? true,
    get: ownFetchGetter,
    set: (next: typeof target.fetch) => {
      if (typeof next !== 'function' || (next as TaggedFetch)[fetchWrapperMarker]) return
      // ChatGPT installs its own fetch instrumentation after document-start. Keep that
      // function as the host transport, while continuing to expose Booster's wrapper.
      fetchHost = next
      fetchWrapper = createFetchWrapper(fetchHost)
    },
  })

  const OriginalXHR = target.XMLHttpRequest
  const originalOpen = OriginalXHR.prototype.open
  const originalSend = OriginalXHR.prototype.send
  const xhrMeta = new WeakMap<XMLHttpRequest, { method: string; rawUrl: string }>()

  const wrappedXhrOpen: typeof OriginalXHR.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    asyncFlag: boolean = true,
    user?: string | null,
    password?: string | null,
  ) {
    xhrMeta.set(this, { method, rawUrl: String(url) })
    return originalOpen.call(this, method, url, asyncFlag, user ?? null, password ?? null)
  }

  const wrappedXhrSend: typeof OriginalXHR.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    if (!observerActive) return originalSend.call(this, body)
    const meta = xhrMeta.get(this)
    if (!meta) return originalSend.call(this, body)

    const diagnosticsEnabled = transportEmissionEnabled
    const resolverObserved = Boolean(archiveFileResolverId(meta.rawUrl))
    const conversationRequest = isConversationRequestUrl(meta.rawUrl)
    const conversationStop = isConversationStopUrl(meta.rawUrl)
    const conversationStreamStatus = isConversationStreamStatusUrl(meta.rawUrl)
    if (
      !diagnosticsEnabled &&
      !resolverObserved &&
      !conversationRequest &&
      !conversationStop &&
      !conversationStreamStatus
    )
      return originalSend.call(this, body)

    const id = nextId('xhr')
    const safeUrl = diagnosticsEnabled ? sanitizeTransportUrl(meta.rawUrl) : ''
    const started = diagnosticsEnabled ? performance.now() : 0
    const requestBoundaryAt = Date.now()
    const xhrAccountEpoch = accountEpoch
    const requestTiming = conversationRequestTimingFromBody(
      meta.rawUrl,
      meta.method,
      body,
      requestBoundaryAt,
    )
    if (requestTiming?.conversationId)
      activeRuns.set(requestTiming.conversationId, { id, at: requestBoundaryAt })
    const statusId = conversationStreamStatusTarget(meta.rawUrl)
    const statusRun = statusId ? activeRuns.get(statusId)?.id : undefined
    publishConversationRequest(
      requestTiming ? { ...requestTiming, requestId: id } : null,
      emittedAccountId,
    )
    const stopConversationId =
      meta.method.toUpperCase() === 'POST' && conversationStop ? conversationIdFromBody(body) : null
    const stopRun = stopConversationId ? activeRuns.get(stopConversationId)?.id : undefined
    if (stopConversationId)
      publishConversationStop({
        conversationId: stopConversationId,
        requestId: stopRun,
        phase: 'requested',
        timestamp: requestBoundaryAt,
        status: null,
      })
    if (diagnosticsEnabled)
      emit({
        id,
        kind: 'xhr',
        direction: 'outbound',
        phase: 'request',
        timestamp: requestBoundaryAt,
        method: meta.method,
        url: safeUrl,
        ...(config.captureBodies ? { bodyPreview: sanitizeBodyPreview(body, config.maxBodyChars) } : {}),
      })

    this.addEventListener(
      'loadend',
      () => {
        if (!observerActive || xhrAccountEpoch !== accountEpoch) return
        if (stopConversationId)
          publishConversationStop({
            conversationId: stopConversationId,
            requestId: stopRun,
            phase: this.status >= 200 && this.status < 300 ? 'confirmed' : 'failed',
            timestamp: Date.now(),
            status: this.status || null,
          })
        if (diagnosticsEnabled)
          emit({
            id,
            kind: 'xhr',
            direction: 'inbound',
            phase: 'response',
            timestamp: Date.now(),
            method: meta.method,
            url: safeUrl,
            status: this.status,
            durationMs: Math.round((performance.now() - started) * 100) / 100,
            contentType: this.getResponseHeader('content-type') ?? undefined,
          })
        if (conversationStreamStatus) {
          try {
            const value = this.responseType === 'json' ? this.response : JSON.parse(this.responseText)
            const detail = conversationStreamStatusFromPayload(
              meta.rawUrl,
              value,
              Date.now(),
              this.status,
            )
            publishConversationStreamStatus(
              detail ? { ...detail, ...(statusRun ? { requestId: statusRun } : {}) } : null,
            )
          } catch {
            if (this.status === 404)
              publishConversationStreamStatus(
                conversationStreamStatusFromPayload(meta.rawUrl, null, Date.now(), this.status),
              )
          }
        }
        if (requestTiming && (this.status < 200 || this.status >= 300)) {
          let payload: unknown = null
          try {
            payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText)
          } catch {
            // Unavailable/non-JSON error bodies retain the ordinary failure state.
          }
          publishConversationStream({
            conversationId: requestTiming.conversationId,
            requestId: id,
            userMessageId: requestTiming.userMessageId,
            kind: 'error',
            errorCode: conversationRequestErrorCode(
              payload,
              this.status,
              this.status ? 'request_rejected' : 'network_error',
            ),
            errorReason: null,
            canRetry: this.status === 0 || this.status === 429 || this.status >= 500,
            observedAt: Date.now(),
            accountId: emittedAccountId,
          })
        }
        if (resolverObserved && this.status >= 200 && this.status < 300) {
          try {
            const value = this.responseType === 'json' ? this.response : JSON.parse(this.responseText)
            publishAssetResolution(value, meta.rawUrl)
          } catch {
            // Resolver response was unavailable or not JSON.
          }
        }
        if (diagnosticsEnabled && config.captureBodies) {
          try {
            const value = this.responseType === 'json' ? this.response : this.responseText
            const bodyPreview = sanitizeBodyPreview(value, config.maxBodyChars)
            if (bodyPreview) {
              emit({
                id,
                kind: 'xhr',
                direction: 'inbound',
                phase: 'message',
                timestamp: Date.now(),
                method: meta.method,
                url: safeUrl,
                bodyPreview,
              })
            }
          } catch {
            // Some response types do not expose responseText.
          }
        }
      },
      { once: true },
    )
    return originalSend.call(this, body)
  }

  shared.xhrOpens.add(wrappedXhrOpen)
  shared.xhrSends.add(wrappedXhrSend)
  OriginalXHR.prototype.open = wrappedXhrOpen
  OriginalXHR.prototype.send = wrappedXhrSend

  const OriginalWebSocket = target.WebSocket
  const WrappedWebSocket = function (
    this: WebSocket,
    url: string | URL,
    protocols?: string | string[],
  ): WebSocket {
    const ws =
      protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols)
    const socketAccountEpoch = accountEpoch
    const socketDecoders = new Map<string, ConversationStreamDecoder>()
    const sourceSocket = (() => {
      try {
        const host = new URL(String(url), target.location.href).hostname
        return host === 'chatgpt.com' || host.endsWith('.chatgpt.com')
      } catch {
        return false
      }
    })()
    let id: string | undefined
    let safe: string | undefined
    const diagnosticMeta = () => {
      if (!transportEmissionEnabled) return undefined
      id ??= nextId('websocket')
      safe ??= sanitizeTransportUrl(String(url))
      return { id, safe }
    }
    const originalSendWs = ws.send.bind(ws)

    ws.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      const meta = diagnosticMeta()
      if (meta)
        emit({
          id: meta.id,
          kind: 'websocket',
          direction: 'outbound',
          phase: 'message',
          timestamp: Date.now(),
          url: meta.safe,
          size: typeof data === 'string' ? data.length : undefined,
          ...(config.captureBodies
            ? { bodyPreview: sanitizeBodyPreview(data, config.maxBodyChars) }
            : {}),
        })
      return originalSendWs(data)
    }
    ws.addEventListener('open', () => {
      const meta = diagnosticMeta()
      if (meta)
        emit({
          id: meta.id,
          kind: 'websocket',
          direction: 'outbound',
          phase: 'open',
          timestamp: Date.now(),
          url: meta.safe,
        })
    })
    ws.addEventListener('message', (event: MessageEvent) => {
      // Native protocol messages drive lifecycle regardless of diagnostic opt-in.
      // A generic socket close is never proof that an assistant completed a turn.
      if (
        observerActive &&
        sourceSocket &&
        socketAccountEpoch === accountEpoch &&
        confirmedCatalogAccountId &&
        typeof event.data === 'string'
      ) {
        try {
          const envelope: unknown = JSON.parse(event.data)
          const candidate = requestPayload(envelope)
          const payload =
            candidate?.type === 'message' && requestPayload(candidate.data) ? candidate.data : envelope
          const value = requestPayload(payload)
          const key =
            typeof value?.stream_id === 'string'
              ? value.stream_id
              : typeof value?.conversation_id === 'string'
                ? value.conversation_id
                : null
          let source: ReturnType<ConversationStreamDecoder['decode']> = null
          let sourceDecoder: ConversationStreamDecoder | undefined
          if (key) {
            let decoder = socketDecoders.get(key)
            if (!decoder) {
              decoder = new ConversationStreamDecoder()
              socketDecoders.set(key, decoder)
            }
            sourceDecoder = decoder
            source = decoder.decode(payload)
            if (decoder.hasGap()) {
              const conversationId =
                typeof value?.conversation_id === 'string' ? value.conversation_id : null
              if (conversationId)
                publishConversationStream({
                  conversationId,
                  kind: 'error',
                  errorCode: 'source_patch_gap',
                  errorReason: null,
                  canRetry: true,
                  observedAt: Date.now(),
                  accountId: confirmedCatalogAccountId,
                })
              const baseline = decoder.retainedBaseline()
              const retained = baseline
                ? conversationStreamEventFromPayload(baseline, conversationId, Date.now())
                : null
              if (
                retained?.kind === 'message' &&
                retained.conversationId &&
                shouldObserveArchiveConversation(retained.conversationId)
              )
                publishConversationStream({
                  ...retained,
                  accountId: confirmedCatalogAccountId,
                  evidence: decoder.takeGapEvidence(),
                })
            }
            if (socketDecoders.size > 32) {
              const oldest = socketDecoders.keys().next().value
              if (oldest !== undefined) socketDecoders.delete(oldest)
            }
          }
          const detail =
            !source && sourceDecoder?.hasGap()
              ? null
              : conversationStreamEventFromPayload(source?.payload ?? payload, null, Date.now())
          // Only the exact server request identity observed on SSE can bind a
          // socket update. Conversation identity alone cannot distinguish retries.
          const nativeRequestId =
            detail?.kind === 'message' ? requestPayload(detail.record.metadata)?.request_id : null
          const correlatedRun =
            detail?.conversationId && typeof nativeRequestId === 'string'
              ? nativeStreamRuns.get(JSON.stringify([detail.conversationId, nativeRequestId]))
              : undefined
          if (
            detail?.conversationId &&
            shouldObserveArchiveConversation(detail.conversationId) &&
            !(sourceDecoder?.hasGap() && (detail.kind === 'complete' || detail.kind === 'async-status'))
          )
            publishConversationStream({
              ...detail,
              accountId: confirmedCatalogAccountId,
              ...(correlatedRun ? { requestId: correlatedRun.id } : {}),
              ...(detail.kind === 'message' && source
                ? { evidence: [...(sourceDecoder?.takeGapEvidence() ?? []), source.evidence] }
                : {}),
            })
        } catch {
          // The malformed packet has only socket-level correlation. Conservatively
          // mark every known stream on this socket as interrupted; do not guess its
          // message or fabricate a terminal event.
          for (const decoder of socketDecoders.values()) {
            decoder.markGap({ unparsedSocketEnvelope: event.data, correlation: 'socket_only' })
            const baseline = decoder.retainedBaseline()
            const retained = baseline
              ? conversationStreamEventFromPayload(baseline, null, Date.now())
              : null
            if (retained?.conversationId && shouldObserveArchiveConversation(retained.conversationId)) {
              publishConversationStream({
                conversationId: retained.conversationId,
                kind: 'error',
                errorCode: 'source_patch_gap',
                errorReason: null,
                canRetry: true,
                observedAt: Date.now(),
                accountId: confirmedCatalogAccountId,
              })
              if (retained.kind === 'message')
                publishConversationStream({
                  ...retained,
                  accountId: confirmedCatalogAccountId,
                  evidence: decoder.takeGapEvidence(),
                })
            }
          }
        }
      }
      const meta = diagnosticMeta()
      if (meta)
        emit({
          id: meta.id,
          kind: 'websocket',
          direction: 'inbound',
          phase: 'message',
          timestamp: Date.now(),
          url: meta.safe,
          size: typeof event.data === 'string' ? event.data.length : undefined,
          ...(config.captureBodies
            ? { bodyPreview: sanitizeBodyPreview(event.data, config.maxBodyChars) }
            : {}),
        })
    })
    ws.addEventListener('close', () => {
      const meta = diagnosticMeta()
      if (meta)
        emit({
          id: meta.id,
          kind: 'websocket',
          direction: 'inbound',
          phase: 'close',
          timestamp: Date.now(),
          url: meta.safe,
        })
    })
    ws.addEventListener('error', () => {
      const meta = diagnosticMeta()
      if (meta)
        emit({
          id: meta.id,
          kind: 'websocket',
          direction: 'inbound',
          phase: 'error',
          timestamp: Date.now(),
          url: meta.safe,
          errorClass: 'socket',
        })
    })
    return ws
  } as unknown as typeof WebSocket
  Object.setPrototypeOf(WrappedWebSocket, OriginalWebSocket)
  WrappedWebSocket.prototype = OriginalWebSocket.prototype

  const OriginalEventSource = target.EventSource
  const WrappedEventSource = function (
    this: EventSource,
    url: string | URL,
    eventSourceInitDict?: EventSourceInit,
  ): EventSource {
    const source = new OriginalEventSource(url, eventSourceInitDict)
    let id: string | undefined
    let safe: string | undefined
    const diagnosticMeta = () => {
      if (!transportEmissionEnabled) return undefined
      id ??= nextId('eventsource')
      safe ??= sanitizeTransportUrl(String(url))
      return { id, safe }
    }
    source.addEventListener('open', () => {
      const meta = diagnosticMeta()
      if (meta)
        emit({
          id: meta.id,
          kind: 'eventsource',
          direction: 'inbound',
          phase: 'open',
          timestamp: Date.now(),
          url: meta.safe,
        })
    })
    source.addEventListener('message', (event: MessageEvent) => {
      const meta = diagnosticMeta()
      if (meta)
        emit({
          id: meta.id,
          kind: 'eventsource',
          direction: 'inbound',
          phase: 'message',
          timestamp: Date.now(),
          url: meta.safe,
          size: (event as MessageEvent).data?.length,
          ...(config.captureBodies
            ? {
                bodyPreview: sanitizeBodyPreview((event as MessageEvent).data, config.maxBodyChars),
              }
            : {}),
        })
    })
    source.addEventListener('error', () => {
      const meta = diagnosticMeta()
      if (meta)
        emit({
          id: meta.id,
          kind: 'eventsource',
          direction: 'inbound',
          phase: 'error',
          timestamp: Date.now(),
          url: meta.safe,
          errorClass: 'stream',
        })
    })
    return source
  } as unknown as typeof EventSource
  Object.setPrototypeOf(WrappedEventSource, OriginalEventSource)
  WrappedEventSource.prototype = OriginalEventSource.prototype

  function setRealtimeTransportHooksEnabled(enabled: boolean) {
    enabled = enabled || observerActive
    if (enabled) {
      if (target.WebSocket === OriginalWebSocket) target.WebSocket = WrappedWebSocket
      if (target.EventSource === OriginalEventSource) target.EventSource = WrappedEventSource
      return
    }
    if (target.WebSocket === WrappedWebSocket) target.WebSocket = OriginalWebSocket
    if (target.EventSource === WrappedEventSource) target.EventSource = OriginalEventSource
  }

  setRealtimeTransportHooksEnabled(true)
  return () => {
    if (!observerActive) return
    observerActive = false
    unregisterNativeAccount()
    target.removeEventListener('message', onConfig)
    target.removeEventListener('message', onArchivePolicy)
    target.removeEventListener('message', onArchiveAssetFetch)
    target.removeEventListener('message', onArchiveAssetFetchCancel)
    for (const controller of archiveAssetFetches.values()) controller.abort()
    archiveAssetFetches.clear()
    const currentDescriptor = Object.getOwnPropertyDescriptor(target, 'fetch')
    shared.active.delete(marker)
    if (shared.active.size === 0) {
      // Only undo our own chain; do not clobber an unrelated site's newer hook.
      if (
        currentDescriptor?.get &&
        shared.fetchGetters.has(currentDescriptor.get as () => typeof target.fetch)
      ) {
        if (shared.originalFetch) Object.defineProperty(target, 'fetch', shared.originalFetch)
        else
          Object.defineProperty(target, 'fetch', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: shared.hostFetch,
          })
      }
      if (shared.xhrOpens.has(OriginalXHR.prototype.open))
        OriginalXHR.prototype.open = shared.originalXhrOpen
      if (shared.xhrSends.has(OriginalXHR.prototype.send))
        OriginalXHR.prototype.send = shared.originalXhrSend
      if (target.WebSocket && target.WebSocket !== shared.originalWebSocket)
        setRealtimeTransportHooksEnabled(false)
      if (target.EventSource && target.EventSource !== shared.originalEventSource)
        setRealtimeTransportHooksEnabled(false)
      delete tagged[registryKey]
    } else {
      if (currentDescriptor?.get === ownFetchGetter) {
        if (originalFetchDescriptor) Object.defineProperty(target, 'fetch', originalFetchDescriptor)
        else
          Object.defineProperty(target, 'fetch', {
            configurable: true,
            writable: true,
            enumerable: true,
            value: fetchHost,
          })
      }
      if (OriginalXHR.prototype.open === wrappedXhrOpen) OriginalXHR.prototype.open = originalOpen
      if (OriginalXHR.prototype.send === wrappedXhrSend) OriginalXHR.prototype.send = originalSend
    }
    setRealtimeTransportHooksEnabled(false)
    bufferedInitialPages.clear()
    verifiedAccountIds.clear()
    selectedAccountId = null
    emittedAccountId = null
    transportEmissionEnabled = false
    flushTransportBatch()
    delete tagged[marker]
  }
}
