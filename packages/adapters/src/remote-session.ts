import {
  DEFAULT_REMOTE_SESSION_CONFIG,
  normalizeRemoteSessionConfig,
  type RemoteCommandKind,
  type RemoteCommandPayloadMap,
  type RemoteSessionConfig,
  type RemoteSessionStatus,
  validateRemoteCommandPayload,
} from '@kobaproduction/browser-core'

export type { RemoteSessionStatus } from '@kobaproduction/browser-core'

import {
  assertMatchingScope,
  assertServiceScope,
  createRemoteOutbox,
  createVolatileRemoteOutbox,
  type RemoteOutbox,
  type RemoteOutboxRecord,
  remoteEventRequiresRaw,
  type ServiceScope,
} from '@kobaproduction/browser-storage'
import { REMOTE_RESULT_CACHE_BYTES, remoteCommandResultFrames } from './remote-command-result'
import { REMOTE_JSON_MAX_DEPTH } from './remote-limits'

export interface RemoteCommandContext {
  readonly signal: AbortSignal
  readonly commandId: string
  readonly scope: ServiceScope
}
export type RemoteCommandHandlers = {
  [K in RemoteCommandKind]?: (
    payload: RemoteCommandPayloadMap[K],
    context: RemoteCommandContext,
  ) => unknown | Promise<unknown>
}
export interface RemotePublishReceipt {
  readonly accepted: boolean
  readonly durable: boolean
  readonly id?: string
  readonly reason?: string
}
export interface RemotePublishOptions {
  readonly sourceMode?: 'normalized' | 'raw'
}
export interface RemoteSessionOptions {
  readonly scope: ServiceScope
  readonly sessionId: string
  readonly getToken: () => Promise<string | undefined>
  readonly config?: RemoteSessionConfig
  readonly handlers?: RemoteCommandHandlers
  /** Custom durable outboxes must declare the same canonical destination. */
  readonly outbox?: RemoteOutbox
}
export interface RemoteSession {
  configure(config: RemoteSessionConfig): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  /** Transport restart; pending remote-only events remain in memory. */
  reconnect(): Promise<void>
  retryDeadLetters(): Promise<void>
  publish(kind: string, payload: unknown, options?: RemotePublishOptions): Promise<RemotePublishReceipt>
  status(): RemoteSessionStatus
  subscribe(listener: (status: RemoteSessionStatus) => void): () => void
}
const FRAME_BYTES = 48 * 1024
const MAX_BUFFERED = 256 * 1024
const ACK_TIMEOUT = 15000
const COMMAND_LIMIT = 128
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(id)
function endpointOf(endpoint: string, scope: ServiceScope): string {
  const url = new URL(endpoint)
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(url.protocol === 'wss:' || (url.protocol === 'ws:' && scope.channel === 'dev' && loopback))
  )
    throw Error('Invalid remote endpoint')
  return url.href
}
/** Strict JSON only: no implicit Blob/Map conversion or executable toJSON. */
function jsonValue(value: unknown, depth = 0): unknown {
  if (depth > REMOTE_JSON_MAX_DEPTH) throw Error('Remote payload is too deep')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, depth + 1))
  if (
    !object(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw Error('Remote payload requires an explicit source codec')
  const result: Record<string, unknown> = Object.create(null)
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:access_?token|token|authorization|password|secret|credentials)$/i.test(key))
      throw Error('Credentials are not remote event data')
    if (item === undefined) throw Error('Remote payload is not JSON-safe')
    result[key] = jsonValue(item, depth + 1)
  }
  return result
}
async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('')
}
function base64(bytes: Uint8Array): string {
  let text = ''
  for (let start = 0; start < bytes.length; start += 4096)
    text += String.fromCharCode(...bytes.subarray(start, start + 4096))
  return btoa(text)
}
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      cleanup()
      reject(signal.reason)
    }
    const cleanup = () => signal.removeEventListener('abort', aborted)
    signal.addEventListener('abort', aborted, { once: true })
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

/** WS-only protocol. Nothing opens a socket/database until explicitly started. */
export function createRemoteSession(options: RemoteSessionOptions): RemoteSession {
  assertServiceScope(options.scope)
  if (!validId(options.sessionId)) throw Error('Invalid remote session identity')
  const scope = Object.freeze({ ...options.scope })
  let config = normalizeRemoteSessionConfig(options.config ?? DEFAULT_REMOTE_SESSION_CONFIG)
  const destination = (value: RemoteSessionConfig) =>
    value.endpoint ? new URL(value.endpoint).href : ''
  const configKey = (value: RemoteSessionConfig) =>
    JSON.stringify({
      ...value,
      endpoint: destination(value),
      allowedCommands: [...value.allowedCommands].sort(),
    })
  let durable = options.outbox ?? createRemoteOutbox(scope, destination(config))
  const volatile = createVolatileRemoteOutbox()
  let running = false,
    generation = 0,
    socket: WebSocket | undefined,
    reconnects = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let pumpTimer: ReturnType<typeof setTimeout> | undefined
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined
  let pumping = false
  const listeners = new Set<(status: RemoteSessionStatus) => void>()
  const inflight = new Map<string, { record: RemoteOutboxRecord; index: number; deadline: number }>()
  const activeCommands = new Map<string, AbortController>()
  const results = new Map<
    string,
    {
      frames: Record<string, unknown>[]
      index: number
      bytes: number
      expiresAt: number
      lastSent: number
    }
  >()
  let snapshot: RemoteSessionStatus = {
    eventMode: 'normalized',
    state: 'disabled',
    mode: config.mode,
    queued: 0,
    deadLetter: 0,
    inFlight: 0,
    durable: config.mode === 'local-and-remote',
  }
  const queue = () => (config.mode === 'remote-only' ? volatile : durable)
  const enabled = () => config.enabled && config.mode !== 'local-only'
  const rawEnabled = () => enabled() && config.rawEvents && snapshot.eventMode === 'raw'
  const deliveryAllowed = (record: Pick<RemoteOutboxRecord, 'kind' | 'sourceMode'>) =>
    !remoteEventRequiresRaw(record) || rawEnabled()
  function change(patch: Partial<RemoteSessionStatus>) {
    snapshot = {
      ...snapshot,
      ...patch,
      mode: config.mode,
      inFlight: inflight.size,
      durable: config.mode === 'local-and-remote' && durable.durable,
    }
    for (const listener of [...listeners])
      try {
        listener({ ...snapshot })
      } catch {
        /* Presentation is not delivery authority. */
      }
  }
  async function counts() {
    const current = generation,
      store = queue()
    try {
      const next = await store.counts()
      if (current === generation) change(next)
    } catch {
      if (current === generation) change({ errorCode: 'outbox-unavailable' })
    }
  }
  function send(frame: Record<string, unknown>): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED)
      return false
    try {
      socket.send(JSON.stringify({ ...frame, version: 1, scope, sessionId: options.sessionId }))
      return true
    } catch {
      return false
    }
  }
  function schedulePump(delay = 50) {
    if (!running || snapshot.state !== 'online' || pumpTimer) return
    pumpTimer = setTimeout(() => {
      pumpTimer = undefined
      void pump()
    }, delay)
  }
  const retryDelay = (attempt: number) => Math.min(30000, 500 * 2 ** Math.min(6, attempt))
  async function failFlights(code: string, current: number) {
    const store = queue(),
      pending = [...inflight.values()]
    inflight.clear()
    for (const item of pending) {
      if (current !== generation) return
      await store
        .fail(item.record.id, Date.now() + retryDelay(item.record.attempts), config.maxAttempts, code)
        .catch(() => {
          if (current === generation) change({ errorCode: 'outbox-unavailable' })
        })
    }
    if (current === generation) await counts()
  }
  function scheduleReconnect(code: string) {
    if (!running || !enabled() || reconnectTimer) return
    reconnects++
    if (reconnects > config.maxAttempts) {
      change({ state: 'offline', errorCode: 'reconnect-limit', nextReconnectAt: undefined })
      return
    }
    const delay = retryDelay(reconnects - 1)
    change({ state: 'backoff', errorCode: code, nextReconnectAt: Date.now() + delay })
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect()
    }, delay)
  }
  async function pump() {
    if (pumping || !running || snapshot.state !== 'online') return
    pumping = true
    const current = generation,
      store = queue()
    try {
      const now = Date.now()
      for (const [id, result] of results) {
        if (result.expiresAt <= now) {
          results.delete(id)
          continue
        }
        if (result.index === result.frames.length && now - result.lastSent >= 5000) {
          result.index = 0
          result.lastSent = 0
        }
        while (result.index < result.frames.length) {
          const frame = result.frames[result.index]
          if (!frame) throw Error('Remote result frame is missing')
          if (!send(frame)) break
          result.index++
        }
        if (result.index === result.frames.length && !result.lastSent) result.lastSent = now
      }
      for (const [id, item] of inflight)
        if (item.deadline && item.deadline <= now) {
          inflight.delete(id)
          await store.fail(id, now + retryDelay(item.record.attempts), config.maxAttempts, 'ack-timeout')
        }
      const ready = await store.ready(
        now,
        Math.min(256, config.inFlightLimit + inflight.size),
        rawEnabled(),
      )
      if (current !== generation || !running || snapshot.state !== 'online') return
      for (const record of ready) {
        if (!deliveryAllowed(record)) continue
        if (inflight.size >= config.inFlightLimit) break
        if (!inflight.has(record.id)) inflight.set(record.id, { record, index: 0, deadline: 0 })
      }
      for (const [id, item] of inflight) {
        if (!deliveryAllowed(item.record)) continue
        while (item.index < item.record.parts) {
          if (current !== generation || !running || snapshot.state !== 'online' || !inflight.has(id))
            return
          if (!deliveryAllowed(item.record)) break
          if (!socket || socket.bufferedAmount > MAX_BUFFERED) {
            schedulePump()
            return
          }
          const index = item.index,
            data = await store.part(id, index)
          if (current !== generation || !inflight.has(id) || !deliveryAllowed(item.record)) break
          if (data === undefined) {
            inflight.delete(id)
            await store.fail(id, now, 1, 'missing-fragment')
            break
          }
          if (
            !send({
              type: 'event-part',
              id,
              groupId: id,
              partId: `${id}:${index}`,
              index,
              count: item.record.parts,
              sha256: item.record.sha256,
              byteLength: item.record.byteLength,
              kind: item.record.kind,
              createdAt: item.record.createdAt,
              ...(item.record.sourceMode ? { sourceMode: item.record.sourceMode } : {}),
              data,
            })
          )
            break
          item.index++
        }
        if (item.index === item.record.parts && !item.deadline) item.deadline = Date.now() + ACK_TIMEOUT
      }
      await counts()
    } catch {
      if (current === generation) change({ errorCode: 'outbox-unavailable' })
    } finally {
      pumping = false
      schedulePump(250)
    }
  }
  async function result(
    id: string,
    capability: string,
    ok: boolean,
    value?: unknown,
    errorCode?: string,
    expiresAt = Date.now() + config.commandTtlMs,
  ) {
    let payload: unknown
    try {
      if (value !== undefined) payload = jsonValue(value)
    } catch {
      ok = false
      errorCode = 'invalid-result'
      payload = undefined
    }
    const frame: Record<string, unknown> = {
      type: 'command-result',
      id,
      capability,
      ok,
      ...(errorCode ? { errorCode } : {}),
    }
    if (results.size >= COMMAND_LIMIT && !results.has(id)) return
    let transfer: { frames: Record<string, unknown>[]; bytes: number }
    try {
      transfer = await remoteCommandResultFrames(frame, payload)
    } catch {
      transfer = await remoteCommandResultFrames(
        { ...frame, ok: false, errorCode: 'result-too-large' },
        undefined,
      )
    }
    const cached = [...results.entries()].reduce(
      (total, [key, result]) => total + (key === id ? 0 : result.bytes),
      0,
    )
    if (cached + transfer.bytes > REMOTE_RESULT_CACHE_BYTES)
      transfer = await remoteCommandResultFrames(
        { ...frame, ok: false, errorCode: 'result-capacity' },
        undefined,
      )
    let index = 0
    while (index < transfer.frames.length) {
      const nextFrame = transfer.frames[index]
      if (!nextFrame) throw Error('Remote result frame is missing')
      if (!send(nextFrame)) break
      index++
    }
    const lastSent = index === transfer.frames.length ? Date.now() : 0
    // Result delivery has its own ACK window after command execution expires.
    results.set(id, {
      ...transfer,
      index,
      expiresAt: Math.max(expiresAt, Date.now() + config.commandTtlMs),
      lastSent,
    })
    schedulePump()
  }
  async function command(frame: Record<string, unknown>, current: number) {
    const { id, capability, issuedAt, expiresAt } = frame
    if (!validId(id) || typeof capability !== 'string') return
    const now = Date.now()
    if (
      !Number.isSafeInteger(issuedAt) ||
      !Number.isSafeInteger(expiresAt) ||
      (issuedAt as number) > now + 5000 ||
      (expiresAt as number) <= now ||
      (expiresAt as number) - (issuedAt as number) < 1 ||
      (expiresAt as number) - (issuedAt as number) > config.commandTtlMs
    ) {
      await result(id, capability, false, undefined, 'expired')
      return
    }
    if (!(config.allowedCommands as readonly string[]).includes(capability)) {
      await result(id, capability, false, undefined, 'capability-denied')
      return
    }
    const kind = capability as RemoteCommandKind,
      handler = options.handlers?.[kind]
    if (!handler) {
      await result(id, capability, false, undefined, 'capability-unavailable')
      return
    }
    if (activeCommands.has(id)) {
      send({ type: 'command-ack', id, status: 'running' })
      return
    }
    if (activeCommands.size >= config.inFlightLimit || results.size >= COMMAND_LIMIT) {
      await result(id, capability, false, undefined, 'command-capacity')
      return
    }
    let payload: RemoteCommandPayloadMap[RemoteCommandKind]
    try {
      payload = validateRemoteCommandPayload(kind, frame.payload)
    } catch {
      await result(id, capability, false, undefined, 'invalid-command')
      return
    }
    const controller = new AbortController()
    activeCommands.set(id, controller)
    const store = queue()
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Expired', 'AbortError')),
      (expiresAt as number) - Date.now(),
    )
    try {
      const fingerprint = await abortable(
        sha256(new TextEncoder().encode(JSON.stringify([kind, payload, issuedAt, expiresAt]))),
        controller.signal,
      )
      const claimed = await abortable(
        store.claimCommand(
          { id, fingerprint, expiresAt: expiresAt as number, state: 'running' },
          COMMAND_LIMIT,
        ),
        controller.signal,
      )
      if (current !== generation || !running || snapshot.state !== 'online') return
      if (claimed !== 'new') {
        const previous = claimed === 'duplicate' ? await store.command(id) : undefined
        await result(
          id,
          capability,
          previous?.state === 'done' && previous.ok === true,
          { deduplicated: true },
          claimed === 'conflict'
            ? 'duplicate-conflict'
            : claimed === 'full'
              ? 'command-capacity'
              : previous?.state === 'running'
                ? 'interrupted'
                : previous?.errorCode,
          expiresAt as number,
        )
        return
      }
      if (Date.now() >= (expiresAt as number) || controller.signal.aborted)
        throw new DOMException('Expired', 'AbortError')
      const invoke = handler as (
        payload: RemoteCommandPayloadMap[RemoteCommandKind],
        context: RemoteCommandContext,
      ) => unknown | Promise<unknown>
      // TTL bounds the transport even if a provider forgets to honor the signal.
      // Native handlers must still check it before their own irreversible action.
      const value = await abortable(
        Promise.resolve().then(() =>
          invoke(payload, { signal: controller.signal, commandId: id, scope }),
        ),
        controller.signal,
      )
      controller.signal.throwIfAborted()
      if (current !== generation || !running) return
      await store.finishCommand(id, true)
      if (current === generation && running)
        await result(id, capability, true, value, undefined, expiresAt as number)
    } catch {
      const code = controller.signal.aborted ? 'command-expired' : 'command-failed'
      if (current === generation && running)
        await store.finishCommand(id, false, code).catch(() => undefined)
      if (current === generation && running)
        await result(id, capability, false, undefined, code, expiresAt as number)
    } finally {
      clearTimeout(timeout)
      if (activeCommands.get(id) === controller) activeCommands.delete(id)
    }
  }
  async function incoming(event: MessageEvent, current: number) {
    if (
      current !== generation ||
      !running ||
      typeof event.data !== 'string' ||
      event.data.length > 256 * 1024
    )
      return
    let frame: Record<string, unknown>
    try {
      const value: unknown = JSON.parse(event.data)
      if (
        !object(value) ||
        value.version !== 1 ||
        value.sessionId !== options.sessionId ||
        !object(value.scope)
      )
        return
      assertMatchingScope(scope, value.scope as unknown as ServiceScope)
      frame = value
    } catch {
      return
    }
    if (frame.type === 'ready' && snapshot.state === 'authenticating') {
      if (handshakeTimer) clearTimeout(handshakeTimer)
      handshakeTimer = undefined
      reconnects = 0
      change({ state: 'online', errorCode: undefined, nextReconnectAt: undefined })
      schedulePump(0)
      return
    }
    if (snapshot.state !== 'online') return
    if (frame.type === 'event-mode') {
      const accepted =
        (frame.mode === 'normalized' && frame.capability === 'source-normalized-v1') ||
        (frame.mode === 'raw' && frame.capability === 'source-raw-v1' && config.rawEvents)
      if (accepted) {
        change({ eventMode: frame.mode as 'normalized' | 'raw' })
        if (!rawEnabled())
          for (const [id, item] of inflight) if (remoteEventRequiresRaw(item.record)) inflight.delete(id)
        schedulePump(0)
      }
      send({ type: 'event-mode-ack', accepted, mode: snapshot.eventMode })
      return
    }
    if (frame.type === 'event-ack' && validId(frame.id)) {
      const item = inflight.get(frame.id)
      if (!item || item.index !== item.record.parts || frame.sha256 !== item.record.sha256) return
      inflight.delete(frame.id)
      try {
        await queue().acknowledge(frame.id)
        await counts()
      } catch {
        change({ errorCode: 'outbox-unavailable' })
      }
      schedulePump(0)
    } else if (frame.type === 'result-ack' && validId(frame.id)) results.delete(frame.id)
    else if (frame.type === 'command') await command(frame, current)
    // Individual event-part ACKs never delete durable data. Only event-ack,
    // issued after server reassembly/hash/persistence, confirms logical delivery.
  }
  async function connect() {
    if (
      !running ||
      !enabled() ||
      snapshot.state === 'connecting' ||
      snapshot.state === 'authenticating' ||
      socket
    )
      return
    const current = generation
    change({ state: 'connecting', errorCode: undefined, nextReconnectAt: undefined })
    let endpoint: string, token: string | undefined
    try {
      endpoint = endpointOf(config.endpoint, scope)
      token = await options.getToken()
    } catch {
      if (current === generation) change({ state: 'offline', errorCode: 'configuration-unavailable' })
      return
    }
    if (current !== generation || !running) return
    if (!token || token.length > 16384) {
      change({ state: 'offline', errorCode: 'authentication-required' })
      return
    }
    try {
      const connection = new WebSocket(endpoint)
      socket = connection
      connection.onopen = () => {
        if (current !== generation || !running) {
          connection.close()
          return
        }
        change({ state: 'authenticating' })
        // The credential is the first frame, never a URL/header/log/outbox field.
        try {
          connection.send(
            JSON.stringify({ type: 'auth', version: 1, token, scope, sessionId: options.sessionId }),
          )
          token = undefined
          if (
            !send({
              type: 'hello',
              capabilities: ['source-normalized-v1', ...(config.rawEvents ? ['source-raw-v1'] : [])],
            })
          ) {
            connection.close(1011, 'handshake-failed')
            return
          }
          handshakeTimer = setTimeout(() => connection.close(1008, 'handshake-timeout'), ACK_TIMEOUT)
        } catch {
          token = undefined
          connection.close(1011, 'handshake-failed')
        }
      }
      connection.onmessage = (event) => {
        void incoming(event, current).catch(() => change({ errorCode: 'protocol-error' }))
      }
      connection.onerror = () => {
        if (current === generation) change({ errorCode: 'connection-failed' })
      }
      connection.onclose = () => {
        if (current !== generation || !running) return
        socket = undefined
        if (handshakeTimer) clearTimeout(handshakeTimer)
        handshakeTimer = undefined
        change({ eventMode: 'normalized', state: 'offline', errorCode: 'connection-closed' })
        void failFlights('connection-closed', current).finally(() => {
          if (current === generation) scheduleReconnect('connection-closed')
        })
      }
    } catch {
      scheduleReconnect('connection-failed')
    }
  }
  async function disconnect(clearVolatile: boolean) {
    running = false
    generation++
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (pumpTimer) clearTimeout(pumpTimer)
    if (handshakeTimer) clearTimeout(handshakeTimer)
    reconnectTimer = undefined
    pumpTimer = undefined
    handshakeTimer = undefined
    for (const controller of activeCommands.values())
      controller.abort(new DOMException('Stopped', 'AbortError'))
    activeCommands.clear()
    results.clear()
    inflight.clear()
    const previous = socket
    socket = undefined
    previous?.close(1000, 'stopped')
    if (clearVolatile) volatile.close()
    durable.close()
    change({
      eventMode: 'normalized',
      state: enabled() ? 'offline' : 'disabled',
      queued: clearVolatile && config.mode === 'remote-only' ? 0 : snapshot.queued,
      deadLetter: clearVolatile && config.mode === 'remote-only' ? 0 : snapshot.deadLetter,
      nextReconnectAt: undefined,
    })
  }
  const stop = () => disconnect(true)
  async function start() {
    if (running) return
    if (!enabled()) {
      change({ state: 'disabled' })
      return
    }
    if (
      config.mode === 'local-and-remote' &&
      (!durable.durable || durable.destination !== destination(config))
    ) {
      change({ state: 'offline', errorCode: 'durable-outbox-required' })
      return
    }
    running = true
    reconnects = 0
    const current = generation
    await counts()
    if (current !== generation || !running) return
    await connect()
  }
  return {
    start,
    stop,
    async reconnect() {
      const current = generation + 1
      await disconnect(false)
      if (current === generation) await start()
    },
    async retryDeadLetters() {
      if (!enabled()) return
      const current = generation
      try {
        await queue().retryDeadLetters()
      } catch {
        if (current === generation) change({ errorCode: 'outbox-unavailable' })
        return
      }
      if (current !== generation) return
      reconnects = 0
      await counts()
      if (current !== generation) return
      if (!running) await start()
      else if (snapshot.state === 'online') schedulePump(0)
      else if (snapshot.state !== 'connecting' && snapshot.state !== 'authenticating') {
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = undefined
        await connect()
      }
    },
    async configure(next) {
      const normalized = normalizeRemoteSessionConfig(next)
      if (configKey(normalized) === configKey(config)) return
      const current = generation + 1
      const clearVolatile =
        !normalized.enabled ||
        normalized.mode === 'local-only' ||
        destination(normalized) !== destination(config)
      await disconnect(clearVolatile)
      if (current !== generation) return
      config = normalized
      if (!options.outbox) durable = createRemoteOutbox(scope, destination(config))
      change({ state: 'disabled', queued: 0, deadLetter: 0, errorCode: undefined })
      await start()
    },
    async publish(kind, payload, publication = {}) {
      if (!running || !enabled())
        return { accepted: false, durable: false, reason: enabled() ? 'stopped' : 'disabled' }
      if (!/^[a-z][a-z0-9.-]{0,63}$/.test(kind))
        return { accepted: false, durable: false, reason: 'invalid-kind' }
      if (
        publication.sourceMode !== undefined &&
        !['normalized', 'raw'].includes(publication.sourceMode)
      )
        return { accepted: false, durable: false, reason: 'invalid-source-mode' }
      const sourceMode = kind === 'archive.source-raw' ? 'raw' : publication.sourceMode
      if (remoteEventRequiresRaw({ kind, sourceMode }) && !rawEnabled())
        return { accepted: false, durable: false, reason: 'raw-not-negotiated' }
      const store = queue(),
        current = generation,
        limit = config.queueLimit
      try {
        const bytes = new TextEncoder().encode(JSON.stringify(jsonValue(payload)))
        const id = crypto.randomUUID(),
          chunks: string[] = []
        for (let start = 0; start < bytes.length; start += FRAME_BYTES)
          chunks.push(base64(bytes.subarray(start, start + FRAME_BYTES)))
        if (!chunks.length) chunks.push('')
        const digest = await sha256(bytes)
        if (current !== generation || !running)
          return { accepted: false, durable: false, reason: 'stopped' }
        if (remoteEventRequiresRaw({ kind, sourceMode }) && !rawEnabled())
          return { accepted: false, durable: false, reason: 'raw-not-negotiated' }
        const accepted = await store.enqueue(
          {
            id,
            kind,
            createdAt: Date.now(),
            sha256: digest,
            parts: chunks.length,
            byteLength: bytes.length,
            ...(sourceMode ? { sourceMode } : {}),
          },
          chunks,
          limit,
        )
        if (!accepted) {
          change({ errorCode: 'queue-full' })
          return { accepted: false, durable: false, reason: 'queue-full' }
        }
        if (current === generation) {
          await counts()
          schedulePump(0)
        }
        return { accepted: true, durable: store.durable, id }
      } catch {
        change({ errorCode: 'enqueue-failed' })
        return { accepted: false, durable: false, reason: 'enqueue-failed' }
      }
    },
    status() {
      return { ...snapshot }
    },
    subscribe(listener) {
      listeners.add(listener)
      try {
        listener({ ...snapshot })
      } catch {}
      return () => listeners.delete(listener)
    },
  }
}
