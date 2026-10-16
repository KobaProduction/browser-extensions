import { createHash, randomUUID } from 'node:crypto'

export const SYNTHETIC_WS_TOKEN = 'ui-lab-synthetic-ws-token'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const syntheticScope = (scope) =>
  scope?.channel === 'dev' &&
  ['chatgpt-booster', 'all-in-one', 'vk-booster'].includes(scope.productId) &&
  /^(ui-lab|synthetic)(?:[-_a-z0-9]*)$/.test(scope.installationId ?? '') &&
  scope.ownerId === 'synthetic-owner'
/** Loopback-only, memory-only protocol fixture. Never accepts a real account scope. */
export function createWsFixtureServer({ port = 8787, token = SYNTHETIC_WS_TOKEN } = {}) {
  const clients = new Set(),
    results = new Map(),
    events = [],
    modes = [],
    pending = new Map()
  let authenticated = 0,
    connections = 0
  const envelope = (client) => ({
    version: 1,
    scope: client.data.scope,
    sessionId: client.data.sessionId,
  })
  const send = (client, frame) => client.send(JSON.stringify({ ...frame, ...envelope(client) }))
  const transfer = (map, frame) => {
    if (
      !Number.isSafeInteger(frame.index) ||
      !Number.isSafeInteger(frame.count) ||
      frame.count < 1 ||
      frame.count > 1024 ||
      frame.index < 0 ||
      frame.index >= frame.count ||
      typeof frame.data !== 'string' ||
      frame.data.length > 65536 ||
      !Number.isSafeInteger(frame.byteLength) ||
      frame.byteLength > 32 * 1024 * 1024
    )
      throw Error('Invalid synthetic fragment')
    let group = map.get(frame.id)
    if (!group) {
      group = {
        count: frame.count,
        sha256: frame.sha256,
        byteLength: frame.byteLength,
        kind: frame.kind,
        sourceMode: frame.sourceMode,
        parts: new Map(),
      }
      map.set(frame.id, group)
    }
    if (
      group.count !== frame.count ||
      group.sha256 !== frame.sha256 ||
      group.byteLength !== frame.byteLength ||
      group.kind !== frame.kind ||
      group.sourceMode !== frame.sourceMode
    )
      throw Error('Conflicting synthetic fragment')
    const part = Buffer.from(frame.data, 'base64'),
      prior = group.parts.get(frame.index)
    if (prior && !prior.equals(part)) throw Error('Conflicting synthetic duplicate')
    group.parts.set(frame.index, part)
    if (group.parts.size !== group.count) return
    const bytes = Buffer.concat(
      Array.from({ length: group.count }, (_, index) => group.parts.get(index)),
    )
    if (bytes.byteLength !== group.byteLength || hash(bytes) !== group.sha256)
      throw Error('Synthetic transfer integrity failed')
    return JSON.parse(bytes.toString('utf8'))
  }
  const message = async (client, data) => {
    if (data.byteLength > 256 * 1024 || data.length > 256 * 1024) throw Error('Fixture frame too large')
    const frame = JSON.parse(String(data))
    if (!client.data.authenticated) {
      if (
        frame.type !== 'auth' ||
        frame.version !== 1 ||
        frame.token !== token ||
        !syntheticScope(frame.scope) ||
        typeof frame.sessionId !== 'string'
      ) {
        client.send(
          JSON.stringify({
            type: 'auth-error',
            version: 1,
            scope: frame.scope,
            sessionId: frame.sessionId,
          }),
        )
        client.close(1008, 'synthetic-auth-required')
        return
      }
      client.data.scope = frame.scope
      client.data.sessionId = frame.sessionId
      client.data.authenticated = true
      authenticated++
      return
    }
    if (
      frame.version !== 1 ||
      frame.sessionId !== client.data.sessionId ||
      JSON.stringify(frame.scope) !== JSON.stringify(client.data.scope)
    )
      return
    if (frame.type === 'hello') {
      client.data.ready = true
      client.data.capabilities = frame.capabilities ?? []
      client.data.requestedMode = 'normalized'
      client.data.eventMode = 'normalized'
      send(client, { type: 'ready' })
      return
    }
    if (!client.data.ready) return
    if (frame.type === 'event-part') {
      const raw =
        frame.sourceMode === 'raw' ||
        frame.kind === 'archive.source-raw' ||
        (frame.sourceMode !== 'normalized' &&
          (frame.kind?.startsWith('sync-') ||
            frame.kind?.startsWith('archive.source-') ||
            frame.kind === 'archive.page-observed'))
      if (
        raw &&
        (client.data.eventMode !== 'raw' ||
          client.data.requestedMode !== 'raw' ||
          !client.data.capabilities.includes('source-raw-v1'))
      )
        throw Error('Raw mode is not negotiated')
      const payload = transfer(client.data.events, frame)
      if (payload !== undefined) {
        if (events.length >= 1000) throw Error('Synthetic fixture event limit')
        events.push({
          id: frame.id,
          kind: frame.kind,
          sha256: frame.sha256,
          payload,
          version: frame.version,
          scope: frame.scope,
          sessionId: frame.sessionId,
          ...(frame.sourceMode ? { sourceMode: frame.sourceMode } : {}),
        })
        client.data.events.delete(frame.id)
        send(client, { type: 'event-ack', id: frame.id, sha256: frame.sha256 })
      }
      return
    }
    if (frame.type === 'command-result-part') {
      transfer(client.data.results, frame)
      return
    }
    if (frame.type === 'event-mode-ack') {
      modes.push({ accepted: frame.accepted, mode: frame.mode })
      if (frame.accepted && frame.mode === client.data.requestedMode) client.data.eventMode = frame.mode
      return
    }
    if (frame.type === 'command-result') {
      let value = frame.result
      if (frame.resultTransfer) {
        const group = client.data.results.get(frame.id)
        if (
          !group ||
          group.parts.size !== group.count ||
          group.sha256 !== frame.resultTransfer.sha256 ||
          group.byteLength !== frame.resultTransfer.byteLength
        )
          return
        const bytes = Buffer.concat(
          Array.from({ length: group.count }, (_, index) => group.parts.get(index)),
        )
        if (hash(bytes) !== group.sha256) throw Error('Synthetic result integrity failed')
        value = JSON.parse(bytes.toString('utf8'))
        client.data.results.delete(frame.id)
      }
      const result = { ...frame, ...(value !== undefined ? { result: value } : {}) }
      results.set(frame.id, result)
      send(client, { type: 'result-ack', id: frame.id })
      const waiter = pending.get(frame.id)
      if (waiter) {
        clearTimeout(waiter.timer)
        pending.delete(frame.id)
        waiter.resolve(result)
      }
    }
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(request, server) {
      const url = new URL(request.url)
      if (
        url.pathname === '/ws' &&
        server.upgrade(request, {
          data: { authenticated: false, ready: false, events: new Map(), results: new Map() },
        })
      )
        return
      if (url.pathname === '/status')
        return Response.json({
          connections,
          authenticated,
          online: [...clients].filter((client) => client.data.ready).length,
          events: events.length,
          results: results.size,
        })
      return new Response('Synthetic WS fixture: /ws and /status', { status: 404 })
    },
    websocket: {
      open(client) {
        connections++
        clients.add(client)
      },
      message(client, data) {
        void message(client, data).catch(() => client.close(1008, 'invalid-fixture-frame'))
      },
      close(client) {
        clients.delete(client)
      },
    },
  })
  return {
    endpoint: `ws://127.0.0.1:${server.port}/ws`,
    port: server.port,
    events,
    results,
    modes,
    status: () => ({
      connections,
      authenticated,
      online: [...clients].filter((client) => client.data.ready).length,
      events: events.length,
      results: results.size,
    }),
    command(capability, payload = {}, options = {}) {
      const client = [...clients].find((client) => client.data.ready && !client.data.probe)
      if (!client) return Promise.reject(Error('No synthetic session is online'))
      const id = options.id ?? randomUUID(),
        issuedAt = Date.now(),
        ttl = options.ttl ?? 5000
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(Error('Synthetic command result timed out'))
        }, ttl + 1000)
        pending.set(id, { resolve, reject, timer })
      })
      send(client, { type: 'command', id, capability, payload, issuedAt, expiresAt: issuedAt + ttl })
      return promise
    },
    requestMode(mode) {
      for (const client of clients)
        if (client.data.ready) {
          client.data.requestedMode = mode
          send(client, {
            type: 'event-mode',
            mode,
            capability: mode === 'raw' ? 'source-raw-v1' : 'source-normalized-v1',
          })
        }
    },
    disconnectAll() {
      for (const client of clients) client.close(1012, 'synthetic-reconnect')
    },
    async stop() {
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(Error('Fixture stopped'))
      }
      pending.clear()
      for (const client of clients) client.close(1000, 'fixture-stopped')
      await server.stop(true)
    },
  }
}
if (import.meta.main) {
  const fixture = createWsFixtureServer({ port: Number(process.env.KOBA_WS_FIXTURE_PORT ?? 8787) })
  console.log(
    `Synthetic loopback fixture ${fixture.endpoint}; token ${SYNTHETIC_WS_TOKEN}; scope installationId ui-lab, ownerId synthetic-owner`,
  )
}
