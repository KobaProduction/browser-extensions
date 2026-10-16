import 'fake-indexeddb/auto'
import { afterEach, expect, test } from 'bun:test'
import Dexie from 'dexie'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import {
  createWsFixtureServer,
  SYNTHETIC_WS_TOKEN,
} from '../../../apps/ui-lab/scripts/ws-fixture-server.mjs'
import { createRemoteSession } from '../../adapters/src/remote-session'
import { probeRemoteSession } from '../../adapters/src/remote-session-probe'
import {
  DEFAULT_REMOTE_SESSION_CONFIG,
  REMOTE_COMMAND_KINDS,
  type RemoteSessionConfig,
} from '../../core/src/automation'
import { createRemoteOutbox } from './remote-outbox'

const scope = {
  productId: 'chatgpt-booster',
  channel: 'dev' as const,
  installationId: 'synthetic-ws',
  ownerId: 'synthetic-owner',
}
Dexie.dependencies.indexedDB = indexedDB
Dexie.dependencies.IDBKeyRange = IDBKeyRange
const resources: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close()
})
async function until(condition: () => boolean, timeout = 5000) {
  const end = Date.now() + timeout
  while (!condition()) {
    if (Date.now() > end) throw Error('Synthetic wait timed out')
    await Bun.sleep(10)
  }
}
function fixture() {
  const server = createWsFixtureServer({ port: 0 })
  resources.push(() => server.stop())
  return server
}
function session(
  endpoint: string,
  patch: Partial<RemoteSessionConfig> = {},
  handlers: Parameters<typeof createRemoteSession>[0]['handlers'] = {},
) {
  const client = createRemoteSession({
    scope,
    sessionId: crypto.randomUUID(),
    getToken: async () => SYNTHETIC_WS_TOKEN,
    config: {
      ...DEFAULT_REMOTE_SESSION_CONFIG,
      enabled: true,
      mode: 'remote-only',
      endpoint,
      allowedCommands: REMOTE_COMMAND_KINDS,
      ...patch,
    },
    handlers,
  })
  resources.push(() => client.stop())
  return client
}
test('isolated candidate probe proves auth/ready without events, and rejects wrong token and PROD plaintext', async () => {
  const server = fixture()
  expect(
    (await probeRemoteSession({ scope, endpoint: server.endpoint, token: SYNTHETIC_WS_TOKEN })).ok,
  ).toBe(true)
  expect(server.events).toHaveLength(0)
  expect(
    (await probeRemoteSession({ scope, endpoint: server.endpoint, token: 'synthetic-wrong' })).errorCode,
  ).toBe('authentication-failed')
  expect(
    (
      await probeRemoteSession({
        scope: { ...scope, channel: 'prod' },
        endpoint: server.endpoint,
        token: SYNTHETIC_WS_TOKEN,
      })
    ).errorCode,
  ).toBe('invalid-configuration')
})
test('save/configure an enabled endpoint connects automatically and reconnects with logical ACK delivery', async () => {
  const server = fixture(),
    client = session('', { enabled: false, mode: 'local-only' })
  const outbox = createRemoteOutbox(scope, server.endpoint)
  resources.push(async () => outbox.close())
  await outbox.enqueue(
    {
      id: 'synthetic-direct',
      kind: 'synthetic.direct',
      createdAt: Date.now(),
      sha256: '0'.repeat(64),
      parts: 1,
      byteLength: 2,
    },
    ['e30='],
    100,
  )
  await outbox.acknowledge('synthetic-direct')
  await client.configure({
    ...DEFAULT_REMOTE_SESSION_CONFIG,
    enabled: true,
    mode: 'local-and-remote',
    endpoint: server.endpoint,
    allowedCommands: REMOTE_COMMAND_KINDS,
  })
  await until(() => client.status().state === 'online')
  const receipt = await client.publish('synthetic.message', { text: 'synthetic-content' })
  expect(receipt).toMatchObject({ accepted: true, durable: true })
  await until(() => server.events.length === 1 && client.status().queued === 0)
  const before = server.status().connections
  server.disconnectAll()
  await until(() => server.status().connections > before && client.status().state === 'online')
  await client.reconnect()
  await until(() => client.status().state === 'online')
})
test('raw mode requires both local opt-in and explicit negotiated capability on every connection', async () => {
  const server = fixture(),
    client = session(server.endpoint)
  await client.start()
  await until(() => client.status().state === 'online')
  server.requestMode('raw')
  await until(() => server.modes.length === 1)
  expect(client.status().eventMode).toBe('normalized')
  expect(server.modes[0]).toMatchObject({ accepted: false })
  await client.configure({
    ...DEFAULT_REMOTE_SESSION_CONFIG,
    enabled: true,
    mode: 'remote-only',
    endpoint: server.endpoint,
    rawEvents: true,
  })
  await until(() => client.status().state === 'online')
  expect(client.status().eventMode).toBe('normalized')
  server.requestMode('raw')
  await until(() => client.status().eventMode === 'raw')
  const before = server.status().connections
  server.disconnectAll()
  await until(() => server.status().connections > before && client.status().state === 'online')
  expect(client.status().eventMode).toBe('normalized')
})
test('full trigger configs use bounded result fragments with verified reassembly; denied commands do not execute', async () => {
  const server = fixture(),
    payload = {
      savedRules: Array.from({ length: 64 }, (_, id) => ({
        id,
        label: 'synthetic',
        text: 'x'.repeat(8192),
      })),
    }
  let called = 0
  const client = session(
    server.endpoint,
    { allowedCommands: ['triggers-get-config'] },
    {
      'triggers-get-config': async () => {
        called++
        return payload
      },
    },
  )
  await client.start()
  await until(() => client.status().state === 'online')
  const result = await server.command('triggers-get-config', {}, { ttl: 10000 })
  expect(result.ok).toBe(true)
  expect(result.result).toEqual(payload)
  expect(result.resultTransfer?.count).toBeGreaterThan(1)
  const denied = await server.command('stop')
  expect(denied).toMatchObject({ ok: false, errorCode: 'capability-denied' })
  expect(called).toBe(1)
})

test('persisted raw and legacy source queues pause without negotiation and cannot starve normalized delivery', async () => {
  const server = fixture()
  const scoped = { ...scope, installationId: `synthetic-queue-${crypto.randomUUID()}` }
  const first = createRemoteOutbox(scoped, server.endpoint)
  const bytes = new TextEncoder().encode('{}')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const base = { createdAt: Date.now(), sha256: hash, parts: 1, byteLength: bytes.length }
  for (const event of [
    { id: 'synthetic-raw', kind: 'archive.source-raw', sourceMode: 'raw' as const },
    { id: 'synthetic-legacy-source', kind: 'archive.source-committed' },
    { id: 'synthetic-legacy-sync', kind: 'sync-row' },
    { id: 'synthetic-legacy-page', kind: 'archive.page-observed' },
  ])
    expect(await first.enqueue({ ...base, ...event }, ['e30='], 100)).toBe(true)
  expect(
    await first.enqueue(
      {
        ...base,
        id: 'synthetic-normalized',
        kind: 'archive.source-committed',
        sourceMode: 'normalized',
      },
      ['e30='],
      100,
    ),
  ).toBe(true)
  first.close()
  const reopened = createRemoteOutbox(scoped, server.endpoint)
  resources.push(async () => reopened.close())
  expect((await reopened.ready(Date.now(), 1, false)).map((event) => event.id)).toEqual([
    'synthetic-normalized',
  ])
  const config = {
    ...DEFAULT_REMOTE_SESSION_CONFIG,
    enabled: true,
    mode: 'local-and-remote' as const,
    endpoint: server.endpoint,
    rawEvents: true,
    inFlightLimit: 1,
  }
  const client = createRemoteSession({
    scope: scoped,
    sessionId: crypto.randomUUID(),
    getToken: async () => SYNTHETIC_WS_TOKEN,
    config,
    outbox: reopened,
  })
  resources.push(() => client.stop())
  await client.start()
  await until(() => server.events.length === 1 && client.status().queued === 4)
  expect(server.events[0]).toMatchObject({ id: 'synthetic-normalized', sourceMode: 'normalized' })
  await client.configure({ ...config, rawEvents: false })
  await until(() => client.status().state === 'online')
  server.requestMode('raw')
  await until(() => server.modes.some((mode) => !mode.accepted))
  expect(server.events).toHaveLength(1)
  await client.configure(config)
  await until(() => client.status().state === 'online')
  expect(client.status().eventMode).toBe('normalized')
  expect(server.events).toHaveLength(1)
  server.requestMode('raw')
  await until(() => server.events.length === 5 && client.status().queued === 0)
  expect(new Set(server.events.map((event) => event.id))).toEqual(
    new Set([
      'synthetic-normalized',
      'synthetic-raw',
      'synthetic-legacy-source',
      'synthetic-legacy-sync',
      'synthetic-legacy-page',
    ]),
  )
}, 15000)
