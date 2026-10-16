import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { DEFAULT_CAPTURE_RULE, normalizeSettings, type SettingsAdapter } from '@chatgpt-booster/core'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { Window } from 'happy-dom'
import { ArchiveCollectionSession } from './archive-collection-session'
import { FixedCanonicalDexieRepository } from './archive-fixed-dexie'
import { FixedChatGptCapture } from './archive-fixed-runtime'
import { createFixedArchiveUiAdapter } from './archive-fixed-ui-adapter'
import { ArchiveSourceGate } from './archive-source-contract'
import { ConversationObservationGateway } from './conversation-observation-gateway'
import { ConversationStateStore } from './conversation-state'

test('active ChatGPT composition no longer constructs native v4 writer, reader or migration engine', () => {
  const source = readFileSync(new URL('./page-runtime.ts', import.meta.url), 'utf8')
  expect(source).toContain('createFixedArchiveUiAdapter')
  expect(source).toContain('FixedChatGptCapture')
  for (const old of [
    'new ArchiveV4Store(',
    'new ArchiveV4CaptureModule(',
    'new ArchiveV4Reader(',
    'createArchiveV4UiAdapter(',
    'archiveWarmup',
    'archiveStore.warmup()',
  ])
    expect(source).not.toContain(old)
})

test('fixed saved Reader facade reads, windows, counts and exports without accessing an older archive', async () => {
  const previousLocation = globalThis.location
  const previousWindow = globalThis.window
  Object.assign(globalThis, {
    location: new URL('https://chatgpt.com/c/fixed-reader'),
    window: new EventTarget(),
  })
  const observations = new ConversationObservationGateway()
  observations.reset('owner-fixed', 1)
  const listener = (detail: ConversationArchiveEventDetail) => {
    const sequence = observations.receive(detail.conversationId, { kind: 'page', detail })
    observations.admit(sequence, { kind: 'page', detail })
  }
  const memory = {
    observations,
    sourceGate: new ArchiveSourceGate(),
    verifiedAccountId: () => 'owner-fixed',
    accountEpoch: () => 1,
    subscribeStreamMessages: () => () => undefined,
    subscribeRejectedSource: () => () => undefined,
    subscribeCatalog: () => () => undefined,
    header: () => undefined,
    listMessages: () => [],
    getMessage: () => undefined,
    nativeHistoryCoverage: () => ({ startReached: false }),
    listSnapshots: () => [],
    listProjects: () => [],
    project: () => undefined,
    subscribe: () => () => undefined,
  } as unknown as ConversationStateStore
  const settings = {
    get: async () =>
      normalizeSettings({
        archive: {
          defaultRule: { ...DEFAULT_CAPTURE_RULE, enabled: true },
          projects: {},
          conversations: {},
        },
      }),
    subscribe: () => () => undefined,
  } as unknown as SettingsAdapter
  const service = new FixedChatGptCapture(memory, settings, 'Chromium', new ArchiveCollectionSession(), {
    indexedDB,
    IDBKeyRange,
  })
  try {
    service.start()
    listener?.({
      kind: 'conversation-page',
      accountId: 'owner-fixed',
      conversationId: 'fixed-reader',
      timestamp: 1800000000000,
      sourceUrl: 'https://chatgpt.com/backend-api/conversation/fixed-reader',
      payload: {
        conversation_id: 'fixed-reader',
        messages: [
          {
            id: 'm-1',
            author: { role: 'user' },
            metadata: {
              branching_from_conversation_id: 'stored-parent-not-loaded',
              branching_from_conversation_title: 'Known source title',
            },
            content: { content_type: 'text', parts: ['Synthetic input'] },
          },
        ],
      },
    })
    expect(await service.savedCurrent()).toBe(1)
    const adapter = createFixedArchiveUiAdapter(service, memory)
    expect(adapter.currentAccountId?.()).toBe('owner-fixed')
    expect((await adapter.listConversations()).map((x) => x.conversationId)).toEqual(['fixed-reader'])
    expect(await adapter.getConversation('fixed-reader')).toMatchObject({
      branchSourceConversationId: 'stored-parent-not-loaded',
      branchSourceTitle: 'Known source title',
    })
    expect((await adapter.listConversations())[0]).toMatchObject({
      branchSourceConversationId: 'stored-parent-not-loaded',
    })
    expect((await adapter.getCoverage('fixed-reader'))?.knownMessageCount).toBe(1)
    const window = await adapter.getThreadWindow?.('fixed-reader', null, 'older', { source: 'saved' })
    expect(window?.totalKnownRecordCount).toBe(1)
    expect(window?.accountId).toBe('owner-fixed')
    expect(window?.hasOlderStored).toBe(false)
    expect(window?.hasNewerStored).toBe(false)
    expect(window?.sourceInstanceId).toMatch(/^[0-9a-f-]{36}$/)
    const packed = await adapter.exportConversation('fixed-reader', {
      format: 'fixed-json-gzip',
      packaging: 'gzip',
      level: 'conversation',
      reasoning: true,
      tools: true,
      internal: false,
      images: false,
      files: false,
    })
    expect(packed.complete).toBe(false)
    expect(packed.blob.size).toBeGreaterThan(0)
    const scope = service.currentScope()
    if (!scope) throw Error('Missing synthetic current scope')
    const peer = new FixedCanonicalDexieRepository(scope, { indexedDB, IDBKeyRange })
    try {
      await peer.backupPort().restoreAtomically([])
      await peer.addObservation({
        accountId: 'owner-fixed',
        conversationId: 'fixed-reader',
        sourceKind: 'synthetic',
        sourceVersion: 'v1',
        observedAtMs: 1800000000001,
        raw: {
          id: 'm-1',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['new source'] },
        },
      })
      await expect(
        adapter.getThreadWindow?.('fixed-reader', null, 'older', {
          source: 'saved',
          expectedRevision: window?.sourceRevision,
          expectedInstanceId: window?.sourceInstanceId,
        }),
      ).rejects.toThrow('sourceChanged')
    } finally {
      peer.close()
    }
  } finally {
    await service.stop()
    Object.assign(globalThis, { location: previousLocation, window: previousWindow })
  }
})
test('a large catalog uses only known cached branch context and never scans per-conversation originals', async () => {
  let sourceReads = 0,
    cacheReads = 0
  const capture = {
    async listSavedConversations() {
      return Array.from({ length: 1000 }, (_, index) => ({
        conversationId: `catalog-${index}`,
        projectId: null,
        title: `Synthetic ${index}`,
      }))
    },
    async savedBranchOrigin() {
      sourceReads++
      throw Error('Catalog must not scan source payloads')
    },
    cachedSavedBranchOrigin(id: string) {
      cacheReads++
      return id === 'catalog-1'
        ? { conversationId: 'known-parent', title: 'Known cached title' }
        : { conversationId: null, title: null }
    },
  } as unknown as FixedChatGptCapture
  const memory = {
    verifiedAccountId: () => 'synthetic-catalog-owner',
    accountEpoch: () => 1,
    listSnapshots: () => [],
  } as unknown as ConversationStateStore
  const rows = await createFixedArchiveUiAdapter(capture, memory).listConversations()
  expect(rows).toHaveLength(1000)
  expect(sourceReads).toBe(0)
  expect(cacheReads).toBe(1000)
  expect(rows[1]).toMatchObject({
    branchSourceConversationId: 'known-parent',
    branchSourceTitle: 'Known cached title',
  })
  expect(rows[999]?.branchSourceConversationId).toBeNull()
})

test('verified RAM projects override saved names and remain available with no saved archive', async () => {
  const projectA = `g-p-${'a'.repeat(32)}`,
    projectB = `g-p-${'b'.repeat(32)}`,
    projectC = `g-p-${'c'.repeat(32)}`
  const dom = new Window({ url: `https://chatgpt.com/g/${projectA}/project` })
  const previousLocation = globalThis.location
  Object.assign(globalThis, { location: dom.location })
  const memory = new ConversationStateStore({} as globalThis.Window)
  memory.ingestAccount({ accountId: 'synthetic-project-owner', observedAt: 1 })
  memory.ingestCatalog({
    accountId: 'synthetic-project-owner',
    requestStartedAt: 10,
    observedAt: 20,
    items: [],
    projects: [
      { projectId: projectA, title: 'Latest native project' },
      { projectId: projectC, title: 'RAM-only project' },
    ],
  })
  let saved = [
    { projectId: projectA, title: 'Older saved project' },
    { projectId: projectB, title: 'Saved-only project' },
  ]
  const capture = {
    listSavedConversations: async () => [],
    listSavedProjects: async () => saved,
  } as unknown as FixedChatGptCapture
  const adapter = createFixedArchiveUiAdapter(capture, memory)
  try {
    expect(await adapter.listProjects()).toEqual([
      { projectId: projectA, title: 'Latest native project' },
      { projectId: projectB, title: 'Saved-only project' },
      { projectId: projectC, title: 'RAM-only project' },
    ])
    expect(await adapter.getCurrentContext()).toMatchObject({
      projectId: projectA,
      projectTitle: 'Latest native project',
    })
    saved = []
    expect(await adapter.listProjects()).toEqual([
      { projectId: projectA, title: 'Latest native project' },
      { projectId: projectC, title: 'RAM-only project' },
    ])
  } finally {
    Object.assign(globalThis, { location: previousLocation })
    await dom.happyDOM.close()
  }
})

test.each(['listProjects', 'getCurrentContext'] as const)(
  '%s rejects a saved-project response across an account A to B to A transition',
  async (method) => {
    const previousLocation = globalThis.location
    Object.assign(globalThis, { location: new URL('https://chatgpt.com/') })
    const memory = new ConversationStateStore({} as globalThis.Window)
    memory.ingestAccount({ accountId: 'owner-A', observedAt: 1 })
    let resolve!: (value: { projectId: string; title: string }[]) => void
    const capture = {
      listSavedConversations: async () => [],
      listSavedProjects: () =>
        new Promise<{ projectId: string; title: string }[]>((done) => {
          resolve = done
        }),
    } as unknown as FixedChatGptCapture
    const adapter = createFixedArchiveUiAdapter(capture, memory)
    try {
      const pending = adapter[method]()
      memory.ingestAccount({ accountId: 'owner-B', observedAt: 2 })
      memory.ingestAccount({ accountId: 'owner-A', observedAt: 3 })
      resolve([{ projectId: `g-p-${'a'.repeat(32)}`, title: 'Stale saved title' }])
      await expect(pending).rejects.toThrow('Owner changed during saved archive read')
    } finally {
      Object.assign(globalThis, { location: previousLocation })
    }
  },
)
