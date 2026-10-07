export const TRANSPORT_EVENT = 'chatgpt-booster:transport-event'
export const TRANSPORT_BATCH_EVENT = 'chatgpt-booster:transport-batch'
export const TRANSPORT_CONFIG_EVENT = 'chatgpt-booster:transport-config'
export const TRANSPORT_CHANNEL = 'chatgpt-booster:transport'
export const ARCHIVE_POLICY_EVENT = 'chatgpt-booster:archive-policy'
export const ARCHIVE_NETWORK_EVENT = 'chatgpt-booster:archive-network'
export const CONVERSATION_REQUEST_EVENT = 'chatgpt-booster:conversation-request'
export const CONVERSATION_STOP_EVENT = 'chatgpt-booster:conversation-stop'
export const CONVERSATION_STREAM_STATUS_EVENT = 'chatgpt-booster:conversation-stream-status'
export const CONVERSATION_STREAM_EVENT = 'chatgpt-booster:conversation-stream'
export const CONVERSATION_CATALOG_EVENT = 'chatgpt-booster:conversation-catalog'
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
}
const archiveReads = new Map<string, { readId: string; readStartedAt: number }>()
const bufferedInitialPages = new Map<string, ConversationArchiveEventDetail>()

function pageConversationId(pathname = location.pathname): string | undefined {
  const match = pathname.match(/(?:^|\/)c\/([^/?#]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function archiveProjectId(payload: Record<string, unknown>, conversationId: string) {
  const incoming =
    typeof payload.gizmo_id === 'string' && payload.gizmo_id.startsWith('g-p-')
      ? payload.gizmo_id
      : null
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
function beginArchiveRequest(sourceUrl: string, requestId: string): ArchiveReadContext | undefined {
  const id = conversationHistoryId(sourceUrl)
  if (!id) return undefined
  const url = new URL(
    sourceUrl,
    typeof location === 'undefined' ? 'https://chatgpt.com/' : location.href,
  )
  const isInitial = !url.pathname.endsWith('/messages')
  if (isInitial && archivePolicy.manualConversationId !== id)
    archiveReads.set(id, { readId: requestId, readStartedAt: Date.now() })
  const read = archiveReads.get(id) ?? { readId: requestId, readStartedAt: Date.now() }
  if (archiveReads.size > 128) {
    const oldest = archiveReads.keys().next().value
    if (oldest) {
      archiveReads.delete(oldest)
      archiveProjects.delete(oldest)
    }
  }
  return { ...read, isInitial, requestedBefore: url.searchParams.get('before') }
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
  const status =
    httpStatus === 404 ? 'UNAVAILABLE' : normalizeConversationStreamStatus(record?.status)
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

function observeConversationStreamStatusResponse(response: Response, sourceUrl: string) {
  if (!isConversationStreamStatusUrl(sourceUrl)) return
  const observedAt = Date.now()
  if (response.status === 404) {
    publishConversationStreamStatus(
      conversationStreamStatusFromPayload(sourceUrl, null, observedAt, response.status),
    )
    return
  }
  void response
    .clone()
    .json()
    .then((payload) =>
      publishConversationStreamStatus(
        conversationStreamStatusFromPayload(sourceUrl, payload, observedAt, response.status),
      ),
    )
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
  if (typeof value.error === 'string' && value.error.trim()) {
    const errorCode =
      typeof value.error_code === 'string' && value.error_code.trim() ? value.error_code : null
    const errorReason =
      typeof value.error_reason === 'string' && value.error_reason.trim()
        ? value.error_reason
        : null
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
      value.protection_type === 'bio' || value.protection_type === 'cyber'
        ? value.protection_type
        : null
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

function observeConversationStreamResponse(response: Response, conversationId: string | null) {
  if (!response.ok || !/event-stream/i.test(response.headers.get('content-type') ?? '')) return
  const body = response.clone().body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
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
          if (data && data !== '[DONE]') {
            try {
              publishConversationStream(
                conversationStreamEventFromPayload(JSON.parse(data), conversationId, Date.now()),
              )
            } catch {
              // Encoded deltas and ordinary content chunks are intentionally ignored.
            }
          }
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // Recovery/status observation owns transport failure classification.
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
  return typeof payload?.conversation_id === 'string'
    ? payload.conversation_id
    : (pageConversationId() ?? null)
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
      url.origin === 'https://chatgpt.com' &&
      /^\/backend-api\/(?:f\/)?conversation$/.test(url.pathname)
    )
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
  return {
    conversationId:
      typeof payload?.conversation_id === 'string'
        ? payload.conversation_id
        : (pageConversationId() ?? null),
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

function publishConversationRequest(detail: ConversationRequestEventDetail | null) {
  if (!observerTarget || !detail) return
  observerTarget.postMessage(
    { channel: TRANSPORT_CHANNEL, type: CONVERSATION_REQUEST_EVENT, detail },
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

function isConversationCatalogUrl(sourceUrl: string) {
  return conversationCatalogProjectId(sourceUrl) !== undefined
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
      typeof record.gizmo_id === 'string' && record.gizmo_id.startsWith('g-p-')
        ? record.gizmo_id
        : null
    return [
      {
        conversationId: record.id,
        projectId: gizmoId ?? routeProjectId,
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

function observeConversationCatalogResponse(response: Response, sourceUrl: string) {
  if (!response.ok || !isConversationCatalogUrl(sourceUrl)) return
  const contentType = response.headers.get('content-type') ?? ''
  if (!/json/i.test(contentType)) return
  void response
    .clone()
    .json()
    .then((payload: unknown) =>
      publishConversationCatalog(conversationCatalogFromPayload(sourceUrl, payload, Date.now())),
    )
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
  if (
    !conversationId ||
    !captureAllowed(conversationId, archiveProjects.get(conversationId) ?? null)
  )
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

export interface ConversationRequestEventDetail {
  conversationId: string | null
  userMessageId: string | null
  conversationOrigin?: string | null
  startedAt: number
  observedAt: number
  source: 'message_create_time' | 'transport_request'
}

export interface ConversationStopEventDetail {
  conversationId: string | null
  phase: 'requested' | 'confirmed' | 'failed'
  timestamp: number
  status: number | null
}

export type ConversationStreamStatus = 'IS_STREAMING' | 'COMPLETE' | 'FAILURE' | 'UNAVAILABLE'

export interface ConversationStreamStatusEventDetail {
  conversationId: string
  status: ConversationStreamStatus
  observedAt: number
  httpStatus: number
}

export type ConversationStreamEventDetail =
  | {
      conversationId: string | null
      kind: 'message'
      record: Record<string, unknown>
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

export interface ConversationCatalogItem {
  conversationId: string
  projectId: string | null
  conversationOrigin: string | null
}

export interface ConversationCatalogEventDetail {
  items: ConversationCatalogItem[]
  observedAt: number
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
          : `[Blob ${child.type || 'unknown'} ${child.size}B]`
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
      reject(
        signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'),
      )
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
      reject(
        new Error(typeof data.detail.error === 'string' ? data.detail.error : 'Asset fetch failed'),
      )
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
    Array.isArray(record.messages) &&
    Boolean(record.page_info && typeof record.page_info === 'object')
  )
}

function observeConversationArchiveResponse(
  response: Response,
  sourceUrl: string,
  read: ArchiveReadContext | undefined,
) {
  const conversationId = conversationHistoryId(sourceUrl)
  if (!observerTarget || !response.ok || !conversationId || !read) return
  if (!read.isInitial && !shouldObserveArchiveConversation(conversationId)) return

  const contentType = response.headers.get('content-type') ?? ''
  if (!/json/i.test(contentType)) return

  const declaredSize = Number(response.headers.get('content-length')) || 0
  if (declaredSize > 32 * 1024 * 1024) return

  void response
    .clone()
    .json()
    .then((payload: unknown) => {
      if (!observerTarget || !isConversationHistoryPayload(payload)) return
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
      if (read.isInitial) {
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
function nextId(kind: TransportKind) {
  sequence += 1
  return `${kind}-${Date.now()}-${sequence}`
}

export function installTransportObserver(
  target: Window & typeof globalThis = window as Window & typeof globalThis,
): () => void {
  const marker = '__chatgptBoosterTransportObserverInstalled__'
  const tagged = target as Window & typeof globalThis & Record<string, unknown>
  if (tagged[marker]) return () => undefined
  tagged[marker] = true
  observerTarget = target

  archivePolicy = { ...DENY_ARCHIVE }
  const onArchivePolicy = (event: MessageEvent) => {
    if (event.origin !== target.location.origin || event.source !== target) return
    const data = event.data
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== ARCHIVE_POLICY_EVENT || !data.detail)
      return
    const previousManual = archivePolicy.manualConversationId
    archivePolicy = { ...DENY_ARCHIVE, ...data.detail }
    const currentBuffered = pageConversationId()
      ? bufferedInitialPages.get(pageConversationId() as string)
      : undefined
    if (currentBuffered) publishPreloadPage(currentBuffered)
    const manual = archivePolicy.manualConversationId
    if (manual && manual !== previousManual) {
      const readStartedAt =
        typeof archivePolicy.manualStartedAt === 'number' &&
        Number.isFinite(archivePolicy.manualStartedAt)
          ? archivePolicy.manualStartedAt
          : Date.now()
      const readId = `manual-${readStartedAt}`
      archiveReads.set(manual, { readId, readStartedAt })
      const bufferedManual = bufferedInitialPages.get(manual)
      if (bufferedManual)
        publishConversationPage({
          ...bufferedManual,
          readId,
          readStartedAt,
          isInitial: true,
          requestedBefore: null,
          timestamp: readStartedAt,
        })
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
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== ARCHIVE_ASSET_FETCH_REQUEST_EVENT)
      return
    const detail = data.detail as
      | { requestId?: unknown; assetId?: unknown; url?: unknown }
      | undefined
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
        if (buffer.byteLength > 512 * 1024 * 1024)
          throw new Error('Asset exceeds 512 MiB export limit')
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
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== ARCHIVE_ASSET_FETCH_CANCEL_EVENT)
      return
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
        !isConversationCatalogUrl(rawUrl)
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
        publishConversationRequest(
          conversationRequestTimingFromBody(rawUrl, method, init?.body, requestBoundaryAt),
        )
        const stopConversationId = conversationStopTargetFromBody(rawUrl, method, init?.body)
        if (stopConversationId)
          publishConversationStop({
            conversationId: stopConversationId,
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

        const historyRead = beginArchiveRequest(rawUrl, id)
        archiveNetwork(id, rawUrl, 'request')
        try {
          const response = await callUpstream(input, init)
          if (stopConversationId)
            publishConversationStop({
              conversationId: stopConversationId,
              phase: response.ok ? 'confirmed' : 'failed',
              timestamp: Date.now(),
              status: response.status,
            })
          archiveNetwork(id, rawUrl, response.ok ? 'response' : 'error', response.status)
          observeConversationArchiveResponse(response, rawUrl, historyRead)
          observeConversationCatalogResponse(response, rawUrl)
          observeConversationStreamStatusResponse(response, rawUrl)
          if (method.toUpperCase() === 'POST' && isConversationRequestUrl(rawUrl))
            observeConversationStreamResponse(response, conversationIdFromBody(init?.body))
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
          if (stopConversationId)
            publishConversationStop({
              conversationId: stopConversationId,
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
  Object.defineProperty(target, 'fetch', {
    configurable: true,
    enumerable: originalFetchDescriptor?.enumerable ?? true,
    get: () => fetchWrapper,
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

  OriginalXHR.prototype.open = function (
    method: string,
    url: string | URL,
    asyncFlag: boolean = true,
    user?: string | null,
    password?: string | null,
  ) {
    xhrMeta.set(this, { method, rawUrl: String(url) })
    return originalOpen.call(this, method, url, asyncFlag, user ?? null, password ?? null)
  }

  OriginalXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
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

    const id = diagnosticsEnabled ? nextId('xhr') : ''
    const safeUrl = diagnosticsEnabled ? sanitizeTransportUrl(meta.rawUrl) : ''
    const started = diagnosticsEnabled ? performance.now() : 0
    const requestBoundaryAt = Date.now()
    publishConversationRequest(
      conversationRequestTimingFromBody(meta.rawUrl, meta.method, body, requestBoundaryAt),
    )
    const stopConversationId =
      meta.method.toUpperCase() === 'POST' && conversationStop ? conversationIdFromBody(body) : null
    if (stopConversationId)
      publishConversationStop({
        conversationId: stopConversationId,
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
        ...(config.captureBodies
          ? { bodyPreview: sanitizeBodyPreview(body, config.maxBodyChars) }
          : {}),
      })

    this.addEventListener(
      'loadend',
      () => {
        if (stopConversationId)
          publishConversationStop({
            conversationId: stopConversationId,
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
            const value =
              this.responseType === 'json' ? this.response : JSON.parse(this.responseText)
            publishConversationStreamStatus(
              conversationStreamStatusFromPayload(meta.rawUrl, value, Date.now(), this.status),
            )
          } catch {
            if (this.status === 404)
              publishConversationStreamStatus(
                conversationStreamStatusFromPayload(meta.rawUrl, null, Date.now(), this.status),
              )
          }
        }
        if (resolverObserved && this.status >= 200 && this.status < 300) {
          try {
            const value =
              this.responseType === 'json' ? this.response : JSON.parse(this.responseText)
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

  const OriginalWebSocket = target.WebSocket
  const WrappedWebSocket = function (
    this: WebSocket,
    url: string | URL,
    protocols?: string | string[],
  ): WebSocket {
    const ws =
      protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols)
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
    if (enabled) {
      if (target.WebSocket === OriginalWebSocket) target.WebSocket = WrappedWebSocket
      if (target.EventSource === OriginalEventSource) target.EventSource = WrappedEventSource
      return
    }
    if (target.WebSocket === WrappedWebSocket) target.WebSocket = OriginalWebSocket
    if (target.EventSource === WrappedEventSource) target.EventSource = OriginalEventSource
  }

  return () => {
    target.removeEventListener('message', onConfig)
    target.removeEventListener('message', onArchivePolicy)
    target.removeEventListener('message', onArchiveAssetFetch)
    target.removeEventListener('message', onArchiveAssetFetchCancel)
    for (const controller of archiveAssetFetches.values()) controller.abort()
    archiveAssetFetches.clear()
    const currentDescriptor = Object.getOwnPropertyDescriptor(target, 'fetch')
    if (currentDescriptor?.get) {
      Object.defineProperty(target, 'fetch', {
        configurable: originalFetchDescriptor?.configurable ?? true,
        enumerable: originalFetchDescriptor?.enumerable ?? true,
        writable: true,
        value: fetchHost,
      })
    }
    OriginalXHR.prototype.open = originalOpen
    OriginalXHR.prototype.send = originalSend
    setRealtimeTransportHooksEnabled(false)
    bufferedInitialPages.clear()
    transportEmissionEnabled = false
    flushTransportBatch()
    delete tagged[marker]
  }
}
