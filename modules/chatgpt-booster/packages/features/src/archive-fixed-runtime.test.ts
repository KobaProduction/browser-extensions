import { expect, test } from 'bun:test'
import { DEFAULT_CAPTURE_RULE, normalizeSettings, type SettingsAdapter } from '@chatgpt-booster/core'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import { decodeArchiveClone } from '@kobaproduction/browser-archive'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { ArchiveCollectionSession } from './archive-collection-session'
import { FixedChatGptCapture } from './archive-fixed-runtime'
import { ArchiveSourceGate } from './archive-source-contract'
import { ConversationObservationGateway } from './conversation-observation-gateway'
import { ConversationStateStore } from './conversation-state'

test('native page -> consented fixed Dexie v1 -> saved Reader -> explicit gzip, no legacy migration', async () => {
  const previousLocation = globalThis.location
  const previousWindow = globalThis.window
  Object.assign(globalThis, {
    location: new URL('https://chatgpt.com/c/fixed-chat-1'),
    window: new EventTarget(),
  })
  const observations = new ConversationObservationGateway()
  observations.reset('synthetic-owner', 0)
  const listener = (detail: ConversationArchiveEventDetail) => {
    const sequence = observations.receive(detail.conversationId, { kind: 'page', detail })
    observations.admit(sequence, { kind: 'page', detail })
  }
  let account = 'synthetic-owner'
  let epoch = 0
  const state = {
    observations,
    sourceGate: new ArchiveSourceGate(),
    verifiedAccountId: () => account,
    listSnapshots: () => [],
    listProjects: () => [],
    project: () => undefined,
    subscribeCatalog: () => () => undefined,
    accountEpoch: () => epoch,
    subscribeStreamMessages: () => () => undefined,
    subscribeRejectedSource: () => () => undefined,
    header: (id: string) =>
      id === 'fixed-chat-1'
        ? { conversationId: id, projectId: null, title: 'Synthetic chat' }
        : undefined,
  } as unknown as ConversationStateStore
  let consent = false
  const settings = {
    get: async () =>
      normalizeSettings({
        enabled: true,
        archive: {
          defaultRule: { ...DEFAULT_CAPTURE_RULE, enabled: consent },
          projects: {},
          conversations: {},
        },
      }),
    subscribe: () => () => undefined,
  } as unknown as SettingsAdapter
  const service = new FixedChatGptCapture(
    state,
    settings,
    'Tampermonkey',
    new ArchiveCollectionSession(),
    { indexedDB, IDBKeyRange },
  )
  const message = {
    id: 'msg-1',
    author: { role: 'assistant' },
    channel: 'final',
    content: { content_type: 'multimodal_text', parts: ['Synthetic fixed source'] },
    extraFutureField: { leftOpaque: true },
  }
  const page: ConversationArchiveEventDetail = {
    kind: 'conversation-page',
    accountId: account,
    conversationId: 'fixed-chat-1',
    timestamp: 1790000000000,
    sourceUrl: 'https://chatgpt.com/backend-api/conversation/fixed-chat-1',
    payload: { conversation_id: 'fixed-chat-1', messages: [message] },
  }
  try {
    service.start()
    listener?.(page)
    expect(await service.savedCurrent()).toBe(0)
    consent = true
    listener?.(page)
    expect(await service.savedCurrent()).toBe(1)
    const preview = await service.listCurrent()
    expect(preview).toEqual([{ id: 'msg-1', text: 'Synthetic fixed source', coverage: 'typed' }])
    listener?.(page)
    expect(await service.savedCurrent()).toBe(1)
    // Changed source must not silently overwrite immutable original snapshots.
    listener?.({
      ...page,
      payload: {
        ...page.payload,
        messages: [
          { ...message, content: { content_type: 'multimodal_text', parts: ['Edited source'] } },
        ],
      },
    })
    expect(await service.savedCurrent()).toBe(1)
    expect(service.captureFailed()).toBe(false)
    expect(await service.messageVersions('fixed-chat-1', 'msg-1')).toHaveLength(2)
    const exportBlob = await service.exportCurrent()
    const data = await new Response(
      exportBlob.stream().pipeThrough(new DecompressionStream('gzip')),
    ).text()
    const rows = data
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(rows[0]).toMatchObject({
      kind: 'header',
      schema: 'koba-fixed-chatgpt-v1',
      completeness: 'unknown',
    })
    expect(rows[1]).toMatchObject({ kind: 'message' })
    const snapshot = decodeArchiveClone(rows[1]?.snapshot) as { raw: unknown; versions: unknown[] }
    expect(snapshot.raw).toEqual(message)
    expect(snapshot.versions).toHaveLength(2)
    expect(rows.at(-1)).toMatchObject({ kind: 'footer', count: 1 })
    account = 'another-owner'
    epoch++
    await expect(service.listCurrent()).resolves.toHaveLength(0)
    listener?.({ ...page, accountId: 'synthetic-owner' })
    expect(await service.savedCurrent()).toBe(0)
  } finally {
    await service.stop()
    Object.assign(globalThis, { location: previousLocation, window: previousWindow })
  }
})

async function nativeCollectionFixture(
  name: string,
  action: (fixture: {
    state: ConversationStateStore
    capture: FixedChatGptCapture
    sessions: ArchiveCollectionSession
    page(
      index: number,
      last: boolean,
      messages?: Record<string, unknown>[],
    ): ConversationArchiveEventDetail
  }) => Promise<void>,
) {
  const previous = {
    location: globalThis.location,
    window: globalThis.window,
    document: globalThis.document,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  }
  Object.assign(globalThis, {
    location: new URL(`https://chatgpt.com/c/${name}`),
    window: new EventTarget(),
    document: { hidden: false, querySelector: () => null },
    HTMLTextAreaElement: class {},
  })
  const owner = `synthetic-${name}`,
    state = new ConversationStateStore(window)
  state.ingestAccount({ accountId: owner, observedAt: 1 })
  const sessions = new ArchiveCollectionSession(() => 1000)
  const settings = {
    get: async () => normalizeSettings({ enabled: true, archive: { defaultRule: { enabled: false } } }),
    subscribe: () => () => undefined,
  } as unknown as SettingsAdapter
  const capture = new FixedChatGptCapture(state, settings, 'Tampermonkey', sessions, {
    indexedDB,
    IDBKeyRange,
  })
  const page = (
    index: number,
    last: boolean,
    messages?: Record<string, unknown>[],
  ): ConversationArchiveEventDetail => ({
    kind: 'conversation-page',
    accountId: owner,
    conversationId: name,
    readId: `read-${name}`,
    readStartedAt: 10,
    isInitial: index === 0,
    requestedBefore: index === 0 ? null : `cursor-${index - 1}`,
    timestamp: 10 + index,
    sourceUrl: `https://chatgpt.com/backend-api/conversations/${name}${index === 0 ? '' : `/messages?before=cursor-${index - 1}`}`,
    payload: {
      ...(index === 0 ? { conversation_id: name, current_node: 'message-179' } : {}),
      messages: messages ?? [
        {
          id: `message-${179 - index}`,
          author: { role: index === 179 ? 'user' : 'assistant', metadata: {} },
          create_time: 1800000000 + 179 - index,
          update_time: null,
          weight: 1,
          recipient: 'all',
          channel: 'final',
          status: 'finished_successfully',
          end_turn: index !== 179,
          metadata: { parent_id: index === 179 ? null : `message-${178 - index}` },
          content: { content_type: 'text', parts: [`Synthetic source ${index}`] },
        },
      ],
      page_info: {
        start_cursor: `cursor-${index}`,
        end_cursor: `end-${index}`,
        has_previous_page: !last,
        has_next_page: index !== 0,
      },
    },
  })
  try {
    await action({ state, capture, sessions, page })
  } finally {
    await capture.stop()
    Object.assign(globalThis, previous)
  }
}

test('capture reassociates only a fresh correlated initial native page and ignores stale project replay', async () => {
  await nativeCollectionFixture('verified-project-move', async ({ state, capture, page }) => {
    const first = page(0, true)
    first.payload.gizmo_id = 'g-p-one'
    first.payload.gizmo_type = 'snorlax'
    state.ingestPage(first)
    capture.start()
    await capture.collectCurrent()
    expect(await capture.savedCurrent()).toBe(1)
    expect(await capture.readSavedProjectId('verified-project-move')).toBe('g-p-one')
    const moved = structuredClone(first)
    moved.readId = 'verified-project-move-read-two'
    moved.readStartedAt = 20
    moved.timestamp = 21
    moved.payload.gizmo_id = 'g-p-two'
    state.ingestPage(moved)
    expect(await capture.savedCurrent()).toBe(1)
    expect(await capture.readSavedProjectId('verified-project-move')).toBe('g-p-two')
    expect(
      (await capture.readConversation('verified-project-move'))[0]?.normalized?.context.projectId,
    ).toBe('g-p-one')
    state.ingestPage(first)
    expect(await capture.savedCurrent()).toBe(1)
    expect(await capture.readSavedProjectId('verified-project-move')).toBe('g-p-two')
    const detached = structuredClone(moved)
    detached.readId = 'verified-project-move-read-three'
    detached.readStartedAt = 30
    detached.timestamp = 31
    detached.payload.gizmo_id = null
    state.ingestPage(detached)
    expect(await capture.savedCurrent()).toBe(1)
    expect(await capture.readSavedProjectId('verified-project-move')).toBeNull()
    expect(capture.captureFailed()).toBe(false)
  })
})

test('manual capture pins the already loaded native read and persists every message including sibling IDs', async () => {
  await nativeCollectionFixture('manual-preloaded-fork', async ({ state, capture, sessions, page }) => {
    const messages = Array.from({ length: 205 }, (_, index) => ({
      id: `source-${index}`,
      author: { role: index === 0 ? 'user' : 'assistant', metadata: {} },
      create_time: 1800000000 + index,
      update_time: null,
      weight: 1,
      recipient: 'all',
      channel: 'final',
      status: 'finished_successfully',
      end_turn: index !== 0,
      metadata: {
        parent_id: index === 0 ? null : index === 2 ? 'source-0' : `source-${index - 1}`,
        has_versions: index === 1,
      },
      content: { content_type: 'text', parts: [`Synthetic message ${index}`] },
    }))
    const loaded = page(0, true, messages)
    loaded.payload.current_node = 'source-204'
    state.ingestPage(loaded)
    capture.start()
    await capture.collectCurrent()
    const run = sessions.current()
    if (!run) throw Error('Expected manual source run')
    expect(run.sourceReadId).toBe('read-manual-preloaded-fork')
    expect(run.sourceReadStartedAt).toBe(10)
    await capture.completeCollection(run)
    expect(await capture.savedCurrent()).toBe(205)
    expect((await capture.integrity('manual-preloaded-fork')).branches).toEqual([
      { parentId: 'source-0', messageIds: ['source-1', 'source-2'] },
    ])
    expect(
      (await capture.readConversation('manual-preloaded-fork', 500)).find((row) => row.id === 'source-1')
        ?.raw.metadata,
    ).toEqual({ parent_id: 'source-0', has_versions: true })
    expect(sessions.snapshot().phase).toBe('complete')
  })
})

test('manual history recovery remains available during a source-confirmed active generation', async () => {
  await nativeCollectionFixture(
    'collect-active-generation',
    async ({ state, capture, sessions, page }) => {
      const incoming = page(0, true)
      incoming.payload.async_status = 3
      incoming.payload.messages[0] = {
        ...incoming.payload.messages[0],
        status: 'in_progress',
        end_turn: false,
      }
      state.ingestPage(incoming)
      capture.start()
      expect(state.lifecycle('collect-active-generation')?.state).toBe('in_progress')
      await capture.collectCurrent()
      expect(sessions.current()).toBeDefined()
      expect(await capture.savedCurrent()).toBe(1)
      expect(state.lifecycle('collect-active-generation')?.state).toBe('in_progress')
      expect((await capture.readConversation('collect-active-generation'))[0]?.raw).toEqual(
        incoming.payload.messages[0],
      )
    },
  )
})

test('manual streaming saves and proves more than 96 native pages without expanding the raw page buffer', async () => {
  await nativeCollectionFixture('manual-long-pages', async ({ state, capture, sessions, page }) => {
    state.ingestPage(page(0, false))
    capture.start()
    await capture.collectCurrent()
    const run = sessions.current()
    if (!run) throw Error('Expected manual source run')
    for (let index = 1; index < 180; index++) state.ingestPage(page(index, index === 179))
    expect(state.pages('manual-long-pages')).toHaveLength(96)
    expect(state.nativeHistoryCoverage('manual-long-pages')).toMatchObject({
      verified: true,
      pageCount: 180,
      replayComplete: false,
    })
    await capture.completeCollection(run)
    expect(await capture.savedCurrent()).toBe(180)
    expect((await capture.integrity('manual-long-pages')).chain).toBe('verified')
    expect(sessions.snapshot().phase).toBe('complete')
  })
})

test('manual capture replays all gateway pages even after the projection page cache reaches its bound', async () => {
  await nativeCollectionFixture(
    'manual-truncated-replay',
    async ({ state, capture, sessions, page }) => {
      for (let index = 0; index < 180; index++) state.ingestPage(page(index, index === 179))
      capture.start()
      await capture.collectCurrent()
      const run = sessions.current()
      if (!run) throw Error('Expected full gateway collection')
      await capture.completeCollection(run)
      expect(await capture.savedCurrent()).toBe(180)
      expect(sessions.snapshot().phase).toBe('complete')
    },
  )
}, 15000)

test('a source contract rejection after collection begins cannot publish completed capture', async () => {
  await nativeCollectionFixture('manual-gate-fence', async ({ state, capture, sessions, page }) => {
    state.ingestPage(page(0, true))
    capture.start()
    await capture.collectCurrent()
    const run = sessions.current()
    if (!run) throw Error('Expected manual source run')
    state.sourceGate.reject({
      conversationId: 'manual-gate-fence',
      version: state.sourceGate.version,
      path: 'payload',
      reason: 'unsupported',
    })
    await expect(capture.completeCollection(run)).rejects.toThrow('archive.error.incompatibleSource')
    expect(sessions.snapshot().phase).not.toBe('complete')
  })
})
test('source-confirmed exhaustion persists once after the submitted original and survives later pages', async () => {
  await nativeCollectionFixture('saved-exhaustion', async ({ state, capture, page }) => {
    const first = page(0, true)
    state.ingestPage(first)
    capture.start()
    await capture.collectCurrent()
    const original = {
      ...(first.payload.messages[0] as Record<string, unknown>),
      id: 'rejected-user',
      author: { role: 'user', metadata: {} },
      metadata: { parent_id: 'message-179' },
      end_turn: false,
    }
    state.ingestRequest({
      conversationId: 'saved-exhaustion',
      requestId: 'synthetic-exhaustion-request',
      accountId: 'synthetic-saved-exhaustion',
      userMessageId: 'rejected-user',
      startedAt: 1100,
      observedAt: 1101,
      source: 'transport_request',
      submission: { message: original, parentMessageId: 'message-179' },
    })
    state.ingestStreamEvent({
      conversationId: 'saved-exhaustion',
      requestId: 'synthetic-exhaustion-request',
      kind: 'error',
      errorCode: 'conversation_too_large',
      errorReason: null,
      canRetry: false,
      observedAt: 1200,
    })
    await capture.waitForDistribution()
    const proof = await capture.savedExhaustion('saved-exhaustion')
    expect(proof).toEqual({
      kind: 'conversation_too_large',
      requestId: 'synthetic-exhaustion-request',
      userMessageId: 'rejected-user',
      savedHeadId: 'message-179',
      observedAt: 1200,
    })
    state.ingestPage({ ...first, timestamp: 1300 })
    await capture.waitForDistribution()
    expect(await capture.savedExhaustion('saved-exhaustion')).toEqual(proof)
    expect(await capture.savedCurrent()).toBe(2)
    expect(capture.captureFailed()).toBe(false)
  })
})

test('native retry exhaustion keeps an unknown user ID and anchors the last durable head', async () => {
  await nativeCollectionFixture('exhausted-native-retry', async ({ state, capture, page }) => {
    const first = page(0, true)
    state.ingestPage(first)
    capture.start()
    await capture.collectCurrent()
    state.ingestRequest({
      conversationId: 'exhausted-native-retry',
      requestId: 'native-retry',
      accountId: 'synthetic-exhausted-native-retry',
      userMessageId: null,
      startedAt: 1100,
      observedAt: 1101,
      source: 'transport_request',
    })
    state.ingestStreamEvent({
      conversationId: 'exhausted-native-retry',
      requestId: 'native-retry',
      kind: 'error',
      errorCode: 'conversation_too_large',
      errorReason: null,
      canRetry: false,
      observedAt: 1200,
    })
    await capture.waitForDistribution()
    expect(await capture.savedExhaustion('exhausted-native-retry')).toEqual({
      kind: 'conversation_too_large',
      requestId: 'native-retry',
      userMessageId: null,
      savedHeadId: 'message-179',
      observedAt: 1200,
    })
    expect(await capture.savedCurrent()).toBe(1)
    expect(capture.captureFailed()).toBe(false)
  })
})

test('a valid empty native history still persists its acknowledged page proof and completes collection', async () => {
  await nativeCollectionFixture('manual-empty-history', async ({ state, capture, sessions, page }) => {
    const empty = page(0, true, [])
    empty.payload.current_node = null
    state.ingestPage(empty)
    capture.start()
    await capture.collectCurrent()
    const run = sessions.current()
    if (!run) throw Error('Expected manual source run')
    await capture.completeCollection(run)
    expect(await capture.savedCurrent()).toBe(0)
    expect(sessions.snapshot().phase).toBe('complete')
    expect(await capture.listSavedConversations()).toHaveLength(1)
  })
})
test('reaching native page boundaries cannot complete a saved graph with a known missing parent', async () => {
  await nativeCollectionFixture('manual-missing-parent', async ({ state, capture, sessions, page }) => {
    state.ingestPage(page(0, true))
    capture.start()
    await capture.collectCurrent()
    const run = sessions.current()
    if (!run) throw Error('Expected manual source run')
    await expect(capture.completeCollection(run)).rejects.toThrow('archive.error.incompleteSource')
    expect(await capture.savedCurrent()).toBe(1)
    expect(sessions.snapshot().phase).not.toBe('complete')
  })
})
