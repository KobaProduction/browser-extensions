export const TRANSPORT_EVENT = 'chatgpt-booster:transport-event'
export const TRANSPORT_CONFIG_EVENT = 'chatgpt-booster:transport-config'
export const TRANSPORT_CHANNEL = 'chatgpt-booster:transport'
export const ARCHIVE_POLICY_EVENT = 'chatgpt-booster:archive-policy'
export const ARCHIVE_NETWORK_EVENT = 'chatgpt-booster:archive-network'
export const ARCHIVE_ASSET_EVENT = 'chatgpt-booster:archive-asset'
export interface ArchiveCapturePolicy {
  enabled: boolean
  defaultEnabled: boolean
  projects: Record<string, boolean>
  conversations: Record<string, boolean>
  manualConversationId: string | null
}
const DENY_ARCHIVE: ArchiveCapturePolicy = {
  enabled: false,
  defaultEnabled: false,
  projects: {},
  conversations: {},
  manualConversationId: null,
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
function beginArchiveRequest(sourceUrl: string, requestId: string): ArchiveReadContext | undefined {
  const id = conversationHistoryId(sourceUrl)
  if (!id) return undefined
  const url = new URL(sourceUrl, location.href)
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

export type TransportKind = 'fetch' | 'xhr' | 'websocket' | 'eventsource'
export type TransportDirection = 'outbound' | 'inbound'
export type TransportPhase = 'request' | 'response' | 'message' | 'open' | 'close' | 'error'

export interface TransportObserverConfig {
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

function emit(detail: TransportEventDetail) {
  if (!observerTarget) return
  observerTarget.postMessage(
    {
      channel: TRANSPORT_CHANNEL,
      type: TRANSPORT_EVENT,
      detail,
    },
    '*',
  )
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

  if (
    !archivePolicy.manualConversationId &&
    (!archivePolicy.enabled ||
      (!archivePolicy.defaultEnabled &&
        !Object.values(archivePolicy.projects).some(Boolean) &&
        !Object.values(archivePolicy.conversations).some(Boolean)))
  )
    return
  const contentType = response.headers.get('content-type') ?? ''
  if (!/json/i.test(contentType)) return

  const declaredSize = Number(response.headers.get('content-length')) || 0
  if (declaredSize > 32 * 1024 * 1024) return

  void response
    .clone()
    .json()
    .then((payload: unknown) => {
      if (!observerTarget || !isConversationHistoryPayload(payload)) return
      const incomingProject =
        typeof payload.gizmo_id === 'string' && payload.gizmo_id.startsWith('g-p-')
          ? payload.gizmo_id
          : null
      const projectId =
        'gizmo_id' in payload ? incomingProject : (archiveProjects.get(conversationId) ?? null)
      if (!captureAllowed(conversationId, projectId)) return
      archiveProjects.set(conversationId, projectId)
      observerTarget.postMessage(
        {
          channel: TRANSPORT_CHANNEL,
          type: ARCHIVE_EVENT,
          detail: {
            kind: 'conversation-page',
            ...read,
            timestamp: Date.now(),
            sourceUrl,
            conversationId,
            payload,
          } satisfies ConversationArchiveEventDetail,
        },
        '*',
      )
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
    archivePolicy = { ...DENY_ARCHIVE, ...data.detail }
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
      captureBodies: detail?.captureBodies ?? config.captureBodies,
      maxBodyChars: Math.min(Math.max(detail?.maxBodyChars ?? config.maxBodyChars, 128), 16384),
    }
  }
  target.addEventListener('message', onConfig)

  const originalFetch = target.fetch.bind(target)
  target.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const id = nextId('fetch')
    const started = performance.now()
    const request = input instanceof Request ? input : undefined
    const method = init?.method ?? request?.method ?? 'GET'
    const rawUrl = request?.url ?? String(input)
    const url = sanitizeTransportUrl(rawUrl)
    const body = config.captureBodies
      ? sanitizeBodyPreview(init?.body, config.maxBodyChars)
      : undefined

    emit({
      id,
      kind: 'fetch',
      direction: 'outbound',
      phase: 'request',
      timestamp: Date.now(),
      method,
      url,
      ...(body ? { bodyPreview: body } : {}),
    })

    const historyRead = beginArchiveRequest(rawUrl, id)
    archiveNetwork(id, rawUrl, 'request')
    try {
      const response = await originalFetch(input, init)
      archiveNetwork(id, rawUrl, response.ok ? 'response' : 'error', response.status)
      observeConversationArchiveResponse(response, rawUrl, historyRead)
      observeArchiveAssetResponse(response, rawUrl)
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
      return response
    } catch (error) {
      archiveNetwork(id, rawUrl, 'error', 0)
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
      throw error
    }
  }

  const OriginalXHR = target.XMLHttpRequest
  const originalOpen = OriginalXHR.prototype.open
  const originalSend = OriginalXHR.prototype.send
  const xhrMeta = new WeakMap<
    XMLHttpRequest,
    { id: string; method: string; url: string; rawUrl: string; started: number }
  >()

  OriginalXHR.prototype.open = function (
    method: string,
    url: string | URL,
    asyncFlag: boolean = true,
    user?: string | null,
    password?: string | null,
  ) {
    xhrMeta.set(this, {
      id: nextId('xhr'),
      method,
      url: sanitizeTransportUrl(String(url)),
      rawUrl: String(url),
      started: 0,
    })
    return originalOpen.call(this, method, url, asyncFlag, user ?? null, password ?? null)
  }

  OriginalXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = xhrMeta.get(this)
    if (meta) {
      meta.started = performance.now()
      emit({
        id: meta.id,
        kind: 'xhr',
        direction: 'outbound',
        phase: 'request',
        timestamp: Date.now(),
        method: meta.method,
        url: meta.url,
        ...(config.captureBodies
          ? { bodyPreview: sanitizeBodyPreview(body, config.maxBodyChars) }
          : {}),
      })
      this.addEventListener(
        'loadend',
        () => {
          emit({
            id: meta.id,
            kind: 'xhr',
            direction: 'inbound',
            phase: 'response',
            timestamp: Date.now(),
            method: meta.method,
            url: meta.url,
            status: this.status,
            durationMs: Math.round((performance.now() - meta.started) * 100) / 100,
            contentType: this.getResponseHeader('content-type') ?? undefined,
          })
          if (this.status >= 200 && this.status < 300 && archiveFileResolverId(meta.rawUrl)) {
            try {
              const value =
                this.responseType === 'json' ? this.response : JSON.parse(this.responseText)
              publishAssetResolution(value, meta.rawUrl)
            } catch {
              // Resolver response was unavailable or not JSON.
            }
          }
          if (config.captureBodies) {
            try {
              const value = this.responseType === 'json' ? this.response : this.responseText
              const bodyPreview = sanitizeBodyPreview(value, config.maxBodyChars)
              if (bodyPreview) {
                emit({
                  id: meta.id,
                  kind: 'xhr',
                  direction: 'inbound',
                  phase: 'message',
                  timestamp: Date.now(),
                  method: meta.method,
                  url: meta.url,
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
    }
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
    const id = nextId('websocket')
    const safe = sanitizeTransportUrl(String(url))
    const originalSendWs = ws.send.bind(ws)

    ws.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      emit({
        id,
        kind: 'websocket',
        direction: 'outbound',
        phase: 'message',
        timestamp: Date.now(),
        url: safe,
        size: typeof data === 'string' ? data.length : undefined,
        ...(config.captureBodies
          ? { bodyPreview: sanitizeBodyPreview(data, config.maxBodyChars) }
          : {}),
      })
      return originalSendWs(data)
    }
    ws.addEventListener('open', () =>
      emit({
        id,
        kind: 'websocket',
        direction: 'outbound',
        phase: 'open',
        timestamp: Date.now(),
        url: safe,
      }),
    )
    ws.addEventListener('message', (event: MessageEvent) =>
      emit({
        id,
        kind: 'websocket',
        direction: 'inbound',
        phase: 'message',
        timestamp: Date.now(),
        url: safe,
        size: typeof event.data === 'string' ? event.data.length : undefined,
        ...(config.captureBodies
          ? { bodyPreview: sanitizeBodyPreview(event.data, config.maxBodyChars) }
          : {}),
      }),
    )
    ws.addEventListener('close', () =>
      emit({
        id,
        kind: 'websocket',
        direction: 'inbound',
        phase: 'close',
        timestamp: Date.now(),
        url: safe,
      }),
    )
    ws.addEventListener('error', () =>
      emit({
        id,
        kind: 'websocket',
        direction: 'inbound',
        phase: 'error',
        timestamp: Date.now(),
        url: safe,
        errorClass: 'socket',
      }),
    )
    return ws
  } as unknown as typeof WebSocket
  Object.setPrototypeOf(WrappedWebSocket, OriginalWebSocket)
  WrappedWebSocket.prototype = OriginalWebSocket.prototype
  target.WebSocket = WrappedWebSocket

  const OriginalEventSource = target.EventSource
  const WrappedEventSource = function (
    this: EventSource,
    url: string | URL,
    eventSourceInitDict?: EventSourceInit,
  ): EventSource {
    const source = new OriginalEventSource(url, eventSourceInitDict)
    const id = nextId('eventsource')
    const safe = sanitizeTransportUrl(String(url))
    source.addEventListener('open', () =>
      emit({
        id,
        kind: 'eventsource',
        direction: 'inbound',
        phase: 'open',
        timestamp: Date.now(),
        url: safe,
      }),
    )
    source.addEventListener('message', (event: MessageEvent) =>
      emit({
        id,
        kind: 'eventsource',
        direction: 'inbound',
        phase: 'message',
        timestamp: Date.now(),
        url: safe,
        size: (event as MessageEvent).data?.length,
        ...(config.captureBodies
          ? { bodyPreview: sanitizeBodyPreview((event as MessageEvent).data, config.maxBodyChars) }
          : {}),
      }),
    )
    source.addEventListener('error', () =>
      emit({
        id,
        kind: 'eventsource',
        direction: 'inbound',
        phase: 'error',
        timestamp: Date.now(),
        url: safe,
        errorClass: 'stream',
      }),
    )
    return source
  } as unknown as typeof EventSource
  Object.setPrototypeOf(WrappedEventSource, OriginalEventSource)
  WrappedEventSource.prototype = OriginalEventSource.prototype
  target.EventSource = WrappedEventSource

  return () => {
    target.removeEventListener('message', onConfig)
    target.removeEventListener('message', onArchivePolicy)
    target.fetch = originalFetch
    OriginalXHR.prototype.open = originalOpen
    OriginalXHR.prototype.send = originalSend
    target.WebSocket = OriginalWebSocket
    target.EventSource = OriginalEventSource
    delete tagged[marker]
  }
}
