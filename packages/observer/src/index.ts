export const TRANSPORT_EVENT = 'chatgpt-booster:transport-event'
export const TRANSPORT_CONFIG_EVENT = 'chatgpt-booster:transport-config'
export const TRANSPORT_CHANNEL = 'chatgpt-booster:transport'

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
}

const DEFAULT_CONFIG: TransportObserverConfig = {
  enabled: true,
  captureBodies: false,
  maxBodyChars: 2048,
}

const SECRET_KEY =
  /(authorization|cookie|token|secret|password|passwd|api[-_]?key|session|credential)/i
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

  const redacted = text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
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
      emit({
        id: context.id,
        kind: 'fetch',
        direction: 'inbound',
        phase: 'error',
        timestamp: Date.now(),
        method: context.method,
        url: context.url,
        error: error instanceof Error ? error.message.slice(0, 300) : 'response stream read failed',
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

  let config = { ...DEFAULT_CONFIG }
  const onConfig = (event: MessageEvent) => {
    if (event.source !== target) return
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
  }
  target.addEventListener('message', onConfig)

  const originalFetch = target.fetch.bind(target)
  target.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!config.enabled) return originalFetch(input, init)

    const id = nextId('fetch')
    const started = performance.now()
    const request = input instanceof Request ? input : undefined
    const method = init?.method ?? request?.method ?? 'GET'
    const url = sanitizeTransportUrl(request?.url ?? String(input))
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

    try {
      const response = await originalFetch(input, init)
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
      emit({
        id,
        kind: 'fetch',
        direction: 'inbound',
        phase: 'error',
        timestamp: Date.now(),
        method,
        url,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        error: error instanceof Error ? error.message.slice(0, 300) : 'fetch failed',
      })
      throw error
    }
  }

  const OriginalXHR = target.XMLHttpRequest
  const originalOpen = OriginalXHR.prototype.open
  const originalSend = OriginalXHR.prototype.send
  const xhrMeta = new WeakMap<
    XMLHttpRequest,
    { id: string; method: string; url: string; started: number }
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
      started: 0,
    })
    return originalOpen.call(this, method, url, asyncFlag, user ?? null, password ?? null)
  }

  OriginalXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    if (!config.enabled) return originalSend.call(this, body)

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
    if (!config.enabled) return ws

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
    if (!config.enabled) return source

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
      }),
    )
    return source
  } as unknown as typeof EventSource
  Object.setPrototypeOf(WrappedEventSource, OriginalEventSource)
  WrappedEventSource.prototype = OriginalEventSource.prototype
  target.EventSource = WrappedEventSource

  return () => {
    target.removeEventListener('message', onConfig)
    target.fetch = originalFetch
    OriginalXHR.prototype.open = originalOpen
    OriginalXHR.prototype.send = originalSend
    target.WebSocket = OriginalWebSocket
    target.EventSource = OriginalEventSource
    delete tagged[marker]
  }
}
