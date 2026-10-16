import { afterEach, expect, test } from 'bun:test'
import {
  type BoosterSettings,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import {
  type ArchiveCloneNode,
  type ArchiveMessageV1,
  decodeArchiveClone,
  encodeArchiveClone,
  validateArchiveMessage,
} from '@kobaproduction/browser-archive'
import type { ApplicationTelemetryController, RemoteSessionConfig } from '@kobaproduction/browser-core'
import type { PortableBackupRow } from '@kobaproduction/browser-storage'
import Dexie from 'dexie'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { Window } from 'happy-dom'
import {
  createWsFixtureServer,
  SYNTHETIC_WS_TOKEN,
} from '../../../../../apps/ui-lab/scripts/ws-fixture-server.mjs'
import { FixedCanonicalDexieRepository, type SourceObservation } from './archive-fixed-dexie'
import type {
  ChatGptCommittedSource,
  ChatGptRejectedSource,
  ChatGptRemoteSource,
  FixedChatGptCapture,
} from './archive-fixed-runtime'
import { ChatGptConversationAutomation } from './conversation-automation'
import type { ConversationStateStore } from './conversation-state'

const resources: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close()
})
async function until(condition: () => boolean) {
  const end = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > end) throw Error('Synthetic remote message wait timed out')
    await Bun.sleep(10)
  }
}
function observation(text = 'synthetic final', final = true): SourceObservation {
  return {
    accountId: 'synthetic-owner',
    conversationId: 'synthetic-conversation',
    sourceKind: 'native-stream',
    sourceVersion: 'synthetic-v1',
    observedAtMs: final ? 200 : 100,
    projectId: null,
    raw: {
      id: 'synthetic-message',
      author: { role: 'assistant', name: 'assistant' },
      content: { content_type: 'text', parts: [text] },
      parent_id: null,
      status: final ? 'finished_successfully' : 'in_progress',
      end_turn: final,
      recipient: 'all',
      channel: 'final',
      create_time: 1,
      update_time: final ? 2 : 1,
      metadata: { request_id: 'synthetic-request', model_slug: 'synthetic-model' },
      future_source_only: 'synthetic-opaque-companion',
    },
  }
}
async function setup(
  options: {
    mode?: RemoteSessionConfig['mode']
    rawEvents?: boolean
    token?: string
    allowedCommands?: RemoteSessionConfig['allowedCommands']
  } = {},
) {
  const server = createWsFixtureServer({ port: 0 })
  resources.push(() => server.stop())
  const dom = new Window({ url: 'https://chatgpt.com/c/synthetic-conversation' }),
    factory = new IDBFactory()
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    indexedDB: Dexie.dependencies.indexedDB,
    range: Dexie.dependencies.IDBKeyRange,
  }
  Object.assign(globalThis, { window: dom, document: dom.document, location: dom.location })
  Dexie.dependencies.indexedDB = factory
  Dexie.dependencies.IDBKeyRange = IDBKeyRange
  resources.push(async () => {
    Object.assign(globalThis, {
      window: prior.window,
      document: prior.document,
      location: prior.location,
    })
    Dexie.dependencies.indexedDB = prior.indexedDB
    Dexie.dependencies.IDBKeyRange = prior.range
    await dom.happyDOM.close()
  })
  const scope = {
    productId: 'chatgpt-booster' as const,
    channel: 'dev' as const,
    installationId: `synthetic-model-${crypto.randomUUID()}`,
    ownerId: 'synthetic-owner',
  }
  const repository = new FixedCanonicalDexieRepository(scope, { indexedDB: factory, IDBKeyRange })
  resources.push(async () => repository.close())
  let owner = scope.ownerId,
    epoch = 1
  const noop = () => () => undefined
  const state = {
    verifiedAccountId: () => owner,
    accountEpoch: () => epoch,
    header: () => undefined,
    subscribeAccount: noop,
    subscribe: noop,
    subscribeStreamMessages: noop,
    lifecycle: () => undefined,
  } as unknown as ConversationStateStore
  const committed = new Set<(source: ChatGptCommittedSource) => void | Promise<void>>(),
    observed = new Set<(source: ChatGptRemoteSource) => Promise<{ accepted: boolean }>>(),
    rejected = new Set<(source: ChatGptRejectedSource) => Promise<{ accepted: boolean }>>()
  const archive = {
    currentScope: () => scope,
    backupPort: () => repository.backupPort(),
    subscribeSaved: noop,
    readSavedProjectId: async (conversationId: string) =>
      (await repository.getConversation(conversationId))?.projectId ?? null,
    subscribeCommitted(listener: (source: ChatGptCommittedSource) => void | Promise<void>) {
      committed.add(listener)
      return () => committed.delete(listener)
    },
    subscribeRemoteSource(listener: (source: ChatGptRemoteSource) => Promise<{ accepted: boolean }>) {
      observed.add(listener)
      return () => observed.delete(listener)
    },
    subscribeRejectedSource(
      listener: (source: ChatGptRejectedSource) => Promise<{ accepted: boolean }>,
    ) {
      rejected.add(listener)
      return () => rejected.delete(listener)
    },
  } as unknown as FixedChatGptCapture
  let stored = normalizeSettings({
    enabled: true,
    features: { requestTimer: false } as BoosterSettings['features'],
    automation: {
      enabled: false,
      domEvents: false,
      rules: [],
      remote: {
        enabled: true,
        mode: options.mode ?? 'remote-only',
        endpoint: server.endpoint,
        rawEvents: options.rawEvents ?? false,
        allowedCommands: options.allowedCommands ?? [],
        queueLimit: 10000,
        inFlightLimit: 8,
        maxAttempts: 1,
        commandTtlMs: 60000,
      },
    },
  })
  const listeners = new Set<(settings: BoosterSettings) => void>()
  const settings: SettingsAdapter = {
    get: async () => structuredClone(stored),
    async set(next) {
      stored = normalizeSettings(next)
      for (const listener of listeners) listener(structuredClone(stored))
      return structuredClone(stored)
    },
    async update(patch) {
      stored = mergeSettings(stored, patch)
      for (const listener of listeners) listener(structuredClone(stored))
      return structuredClone(stored)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const calls: string[] = [],
    telemetryCalls: unknown[][] = []
  const native = {
    send: async () => {
      calls.push('send')
      return { observed: 'request' }
    },
    stop: async () => {
      calls.push('stop')
      return { observed: 'stop' }
    },
    continue: async () => ({ observed: 'request' }),
    newChat: async () => ({ observed: 'route' }),
  }
  const automation = new ChatGptConversationAutomation(
    state,
    settings,
    archive,
    { getRemoteToken: async () => options.token ?? SYNTHETIC_WS_TOKEN } as never,
    native as never,
    {
      record: async (...args: unknown[]) => {
        telemetryCalls.push(args)
      },
    } as unknown as ApplicationTelemetryController,
  )
  resources.push(() => automation.stop())
  await automation.start()
  return {
    server,
    scope,
    repository,
    automation,
    settings,
    calls,
    telemetryCalls,
    async commit(source: SourceObservation) {
      const result = await repository.addObservationResult(source)
      if (!result.normalized) throw Error('Expected persisted normalized source')
      for (const listener of committed)
        await listener({ scope, observation: source, normalized: result.normalized })
      return result.normalized
    },
    async observe(source: SourceObservation, sourceScope = scope) {
      for (const listener of observed) await listener({ scope: sourceScope, observation: source })
    },
    async reject(raw: Record<string, unknown>, sourceScope = scope) {
      for (const listener of rejected)
        await listener({
          scope: sourceScope,
          source: {
            accountId: sourceScope.ownerId,
            conversationId: 'synthetic-conversation',
            observedAt: Date.now(),
            sourceKind: 'stream',
            raw,
          },
          reason: 'validation',
        })
    },
    silentlyChangeOwner() {
      owner = 'synthetic-foreign'
      epoch++
    },
  }
}

test('stored normalized authority reaches the actual wire and canonical sync preserves preferred plus every variant', async () => {
  const run = await setup({ mode: 'local-and-remote', rawEvents: true })
  await until(() => run.automation.status().remote?.state === 'online')
  const initial = await run.commit(observation('synthetic', false)),
    final = await run.commit(observation('synthetic final'))
  await until(() => run.server.events.length === 2)
  for (const event of run.server.events) {
    expect(event.version).toBe(1)
    expect(event.scope).toEqual(run.scope)
    expect(event.sourceMode).toBe('normalized')
    const payload = event.payload as { message: ArchiveMessageV1 }
    validateArchiveMessage(payload.message)
    expect(payload.message.schema).toBe('koba.message')
    expect(JSON.stringify(payload)).not.toContain('synthetic-opaque-companion')
    expect(payload.message.context.requestId).toBe('synthetic-request')
  }
  expect(
    run.server.events.map((event) => (event.payload as { message: ArchiveMessageV1 }).message),
  ).toEqual(expect.arrayContaining([initial, final]))
  const result = await run.automation.syncArchive()
  expect(result.queuedRows).toBe(3)
  await until(
    () =>
      run.server.events.some((event) => event.kind === 'sync-end') &&
      run.automation.status().remote?.queued === 0,
  )
  const rows = run.server.events
    .filter((event) => event.kind === 'sync-row')
    .map(
      (event) =>
        event.payload as { sequence: number; store: string; key: string; value: ArchiveMessageV1 },
    )
    .sort((left, right) => left.sequence - right.sequence)
  expect(rows.filter((row) => row.store === 'messages')).toHaveLength(1)
  expect(rows.filter((row) => row.store === 'message-variants')).toHaveLength(2)
  for (const row of rows) {
    validateArchiveMessage(row.value)
    expect(row.value.identity.ownerId).toBe('synthetic-owner')
    expect(row.value.source.snapshotKey).toBe(
      JSON.stringify(['synthetic-owner', 'synthetic-conversation', 'synthetic-message']),
    )
  }
  expect(
    rows.filter((row) => row.store === 'message-variants').map((row) => row.value.source.variantIndex),
  ).toEqual([0, 1])
  expect(rows.find((row) => row.store === 'messages')?.value.source.variantIndex).toBeNull()
  expect(JSON.stringify(rows)).not.toContain('synthetic-opaque-companion')
  const beforeRaw = run.server.events.length
  run.server.requestMode('raw')
  await until(() => run.automation.status().remote?.eventMode === 'raw')
  const counts = await run.repository.backupPort().countRows()
  const rawResult = await run.automation.syncArchive()
  expect(rawResult.queuedRows).toBe(3 + Object.values(counts).reduce((sum, count) => sum + count, 0))
  await until(
    () =>
      run.server.events.slice(beforeRaw).some((event) => event.kind === 'sync-end') &&
      run.automation.status().remote?.queued === 0,
  )
  const rawEvents = run.server.events.slice(beforeRaw)
  expect(rawEvents.every((event) => event.sourceMode === 'raw')).toBe(true)
  const rawRows = rawEvents
    .filter((event) => event.kind === 'sync-row')
    .map((event) => event.payload as { store: string; value: unknown })
  const rawSnapshot = rawRows.find((row) => row.store === 'source-snapshots')
  if (!rawSnapshot) throw Error('Expected lossless source companion')
  expect(decodeArchiveClone(rawSnapshot.value as ArchiveCloneNode)).toMatchObject({
    raw: { future_source_only: 'synthetic-opaque-companion' },
  })
  for (const row of rawRows.filter(
    (row) => row.store === 'messages' || row.store === 'message-variants',
  ))
    validateArchiveMessage(row.value)
}, 15000)

test('raw fallback requires upload, local consent, server negotiation, category consent, and matching complete scope', async () => {
  const run = await setup({ rawEvents: true })
  await until(() => run.automation.status().remote?.state === 'online')
  const unknown = { future: 'synthetic-private-unknown' }
  await run.reject(unknown)
  expect(run.server.events).toHaveLength(0)
  run.server.requestMode('raw')
  await until(() => run.automation.status().remote?.eventMode === 'raw')
  await run.reject(unknown, { ...run.scope, channel: 'prod' })
  expect(run.server.events).toHaveLength(0)
  await run.settings.update({ archive: { defaultRule: { internal: false } } })
  await run.reject(unknown)
  expect(run.server.events).toHaveLength(0)
  await run.settings.update({ archive: { defaultRule: { internal: true } } })
  await run.reject(unknown)
  await until(() => run.server.events.length === 1)
  const event = run.server.events[0]
  if (!event) throw Error('Expected a raw source event')
  expect(event.sourceMode).toBe('raw')
  const payload = event.payload as { rejected: ArchiveCloneNode }
  expect(decodeArchiveClone(payload.rejected)).toMatchObject({ raw: unknown })
  expect(JSON.stringify(run.telemetryCalls)).not.toContain('synthetic-private-unknown')
  await run.settings.update({ enabled: false })
  await run.reject(unknown)
  expect(run.server.events).toHaveLength(1)
}, 15000)

test('legacy canonical sync resolves project context from saved headers without rewriting source records', async () => {
  const run = await setup({ mode: 'local-and-remote' })
  await until(() => run.automation.status().remote?.state === 'online')
  await run.commit({ ...observation('synthetic', false), projectId: 'synthetic-project' })
  await run.commit({ ...observation(), projectId: 'synthetic-project' })
  const port = run.repository.backupPort(),
    rows: PortableBackupRow[] = []
  for await (const row of port.readRows(128)) {
    if (row.store !== 'snapshots') {
      rows.push(row)
      continue
    }
    const legacy = decodeArchiveClone(row.value as ArchiveCloneNode) as {
      normalized?: ArchiveMessageV1
      projectId?: string | null
      versions: { normalized?: ArchiveMessageV1 }[]
    }
    delete legacy.normalized
    delete legacy.projectId
    for (const version of legacy.versions) delete version.normalized
    rows.push({ ...row, value: await encodeArchiveClone(legacy) })
  }
  await port.restoreAtomically(rows)
  const local = await run.repository.getSourceSnapshot('synthetic-conversation', 'synthetic-message')
  expect(local?.normalized?.context.projectId).toBe('synthetic-project')
  expect((await run.automation.syncArchive()).queuedRows).toBe(3)
  await until(
    () =>
      run.server.events.some((event) => event.kind === 'sync-end') &&
      run.automation.status().remote?.queued === 0,
  )
  const remote = run.server.events
    .filter((event) => event.kind === 'sync-row')
    .map((event) => event.payload as { store: string; value: ArchiveMessageV1 })
  expect(remote.find((row) => row.store === 'messages')?.value).toEqual(local?.normalized)
  expect(remote.every((row) => row.value.context.projectId === 'synthetic-project')).toBe(true)
  for await (const row of run.repository.backupPort().readRows(128))
    if (row.store === 'snapshots') {
      const stored = decodeArchiveClone(row.value as ArchiveCloneNode) as {
        normalized?: unknown
        projectId?: unknown
      }
      expect(stored.normalized).toBeUndefined()
      expect(stored.projectId).toBeUndefined()
    }
}, 15000)

test('wrong authentication and non-allowlisted commands cannot execute native controls; allowed stop works with rules disabled', async () => {
  const wrong = await setup({ token: 'synthetic-wrong' })
  await until(() => wrong.server.status().connections > 0)
  await Bun.sleep(30)
  expect(wrong.automation.status().remote?.state).not.toBe('online')
  expect(wrong.server.events).toHaveLength(0)
  expect(wrong.calls).toEqual([])
  const run = await setup()
  await until(() => run.automation.status().remote?.state === 'online')
  expect(await run.server.command('stop')).toMatchObject({ ok: false, errorCode: 'capability-denied' })
  expect(run.calls).toEqual([])
  const before = run.server.status().connections
  await run.settings.update({ automation: { remote: { allowedCommands: ['stop'] } } })
  await until(
    () => run.server.status().connections > before && run.automation.status().remote?.state === 'online',
  )
  expect(await run.server.command('stop')).toMatchObject({ ok: true })
  expect(run.calls).toEqual(['stop'])
  expect(run.automation.status().enabled).toBe(false)
}, 15000)

test('an owner change while encoding a raw source cannot publish it through the new context', async () => {
  const run = await setup({ rawEvents: true })
  await until(() => run.automation.status().remote?.state === 'online')
  run.server.requestMode('raw')
  await until(() => run.automation.status().remote?.eventMode === 'raw')
  let entered = false,
    release: (bytes: ArrayBuffer) => void = () => {
      throw Error('Encoding was not started')
    }
  const blob = new Blob(['synthetic-private-blob'])
  blob.arrayBuffer = () => {
    entered = true
    return new Promise<ArrayBuffer>((resolve) => {
      release = resolve
    })
  }
  const pending = run.reject({ blob })
  await until(() => entered)
  run.silentlyChangeOwner()
  release(new ArrayBuffer(0))
  await pending
  expect(run.server.events).toHaveLength(0)
  expect(JSON.stringify(run.telemetryCalls)).not.toContain('synthetic-private-blob')
}, 15000)
