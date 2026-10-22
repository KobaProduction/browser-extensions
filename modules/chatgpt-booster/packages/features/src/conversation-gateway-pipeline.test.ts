import { afterEach, expect, test } from 'bun:test'
import {
  type BoosterSettings,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import { conversationRequestTimingFromBody } from '@chatgpt-booster/observer'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { Window } from 'happy-dom'
import { ArchiveCollectionSession } from './archive-collection-session'
import { FixedChatGptCapture } from './archive-fixed-runtime'
import { createFixedArchiveUiAdapter } from './archive-fixed-ui-adapter'
import { ArchiveSourceGate } from './archive-source-contract'
import { ConversationArchiveWorkspace } from './archive-workspace'
import { ConversationStateStore } from './conversation-state'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
function record(id: string, parent: string | null = null, text = id) {
  return {
    id,
    author: { role: 'assistant', metadata: {} },
    create_time: 1800000000,
    update_time: null,
    weight: 1,
    recipient: 'all',
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true,
    content: { content_type: 'text', parts: [text] },
    metadata: { parent_id: parent },
  }
}
function fixture(id: string) {
  const dom = new Window({ url: `https://chatgpt.com/c/${id}` })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    CustomEvent: globalThis.CustomEvent,
  }
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    location: dom.location,
    CustomEvent: dom.CustomEvent,
  })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  const state = new ConversationStateStore(
    dom as unknown as globalThis.Window,
    new ArchiveSourceGate(true),
  )
  state.start()
  state.ingestAccount({ accountId: 'synthetic-owner', observedAt: 1 })
  let value = normalizeSettings({ archive: { defaultRule: { enabled: false } } })
  const listeners = new Set<(settings: BoosterSettings) => void>()
  const settings: SettingsAdapter = {
    get: async () => value,
    set: async (next) => {
      value = next
      for (const listener of listeners) listener(value)
    },
    update: async (patch) => {
      value = mergeSettings(value, patch)
      for (const listener of listeners) listener(value)
      return value
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const capture = new FixedChatGptCapture(state, settings, 'Chromium', new ArchiveCollectionSession(), {
    indexedDB: new IDBFactory(),
    IDBKeyRange,
  })
  const workspace = new ConversationArchiveWorkspace(state, capture)
  capture.start()
  cleanup.push(async () => {
    workspace.stop()
    await capture.stop()
    state.stop()
  })
  const page = (
    records: Record<string, unknown>[],
    before: string | null = null,
  ): ConversationArchiveEventDetail => ({
    kind: 'conversation-page',
    accountId: 'synthetic-owner',
    conversationId: id,
    timestamp: 1800000000000,
    sourceUrl: 'fixture://gateway',
    readId: 'synthetic-read',
    readStartedAt: 1800000000000,
    isInitial: before === null,
    requestedBefore: before,
    payload: { conversation_id: id, current_node: records.at(-1)?.id ?? null, messages: records },
  })
  return {
    state,
    capture,
    workspace,
    settings,
    page,
    adapter: createFixedArchiveUiAdapter(capture, state, workspace),
  }
}

test('native creation saves its first submitted original and start marker only after server ID acknowledgement', async () => {
  const f = fixture('gateway-birth')
  await f.settings.update({ archive: { defaultRule: { enabled: true } } })
  const original = {
    id: 'first-user',
    author: { role: 'user' },
    create_time: 1800000000,
    content: { content_type: 'text', parts: ['Synthetic first submission'] },
    metadata: {},
  }
  const request = conversationRequestTimingFromBody(
    'https://chatgpt.com/backend-api/f/conversation',
    'POST',
    {
      action: 'next',
      turn_attribution: { turn_trigger: 'composer' },
      parent_message_id: 'native-hidden-parent',
      messages: [original],
    },
    1800000000000,
  )
  expect(request?.creation?.message).toEqual(original)
  if (!request) throw Error('Synthetic creation request unavailable')
  f.state.ingestRequest({ ...request, accountId: 'synthetic-owner', requestId: 'birth-run' })
  await f.capture.waitForDistribution()
  expect(await f.capture.savedCurrent()).toBe(0)
  f.state.ingestStreamEvent({
    kind: 'handoff',
    accountId: 'synthetic-owner',
    conversationId: 'gateway-birth',
    requestId: 'birth-run',
    observedAt: 1800000000001,
  })
  await f.capture.waitForDistribution()
  expect(await f.capture.savedCurrent()).toBe(1)
  expect((await f.capture.workspaceChunk('gateway-birth')).header?.startEvidence?.firstMessageId).toBe(
    'first-user',
  )
  expect(f.state.lifecycle('gateway-birth').state).toBe('in_progress')
  f.state.ingestStreamEvent({
    kind: 'message',
    accountId: 'synthetic-owner',
    conversationId: 'gateway-birth',
    requestId: 'birth-run',
    observedAt: 1800000000001,
    record: record('reply', 'first-user'),
  })
  await f.capture.waitForDistribution()
  expect(await f.capture.savedCurrent()).toBe(2)
  expect(f.state.observations.receivedCount('gateway-birth')).toBe(2)
  const rows = await f.capture.readConversation('gateway-birth')
  expect(rows.find((row) => row.id === 'first-user')?.raw).toEqual(original)
  expect((await f.capture.workspaceChunk('gateway-birth')).header?.startEvidence).toEqual({
    kind: 'native-create',
    firstMessageId: 'first-user',
    sourceId: 'birth-run',
    observedAt: 1800000000000,
  })
  const integrity = await f.capture.integrity('gateway-birth')
  expect(integrity.start).toBe('verified')
  expect(integrity.firstMessageId).toBe('first-user')
  // The marker is chronological evidence; it must not forge native parent_id.
  expect(integrity.chain).toBe('verified')
  expect(rows.find((row) => row.id === 'first-user')?.raw.metadata).toEqual({})
  const timeline = await f.adapter.getTimeline?.('gateway-birth')
  expect(timeline?.find((node) => node.id === 'first-user')).toMatchObject({
    timestampMs: 1800000000000,
    parentId: null,
    uncertain: false,
  })
  const run = f.capture.collectionSession.begin({
    accountId: 'synthetic-owner',
    conversationId: 'gateway-birth',
    selectedTipId: 'reply',
  })
  expect(await f.capture.completeSavedCollection(run)).toBe(true)
  expect(f.capture.collectionSession.snapshot().phase).toBe('complete')
  const stale = f.capture.collectionSession.begin({
    accountId: 'synthetic-owner',
    conversationId: 'gateway-birth',
    selectedTipId: 'first-user',
  })
  expect(await f.capture.completeSavedCollection(stale)).toBe(false)
  f.capture.collectionSession.pause('user')
  // Reopening observes a native service prefix first; it cannot replace the
  // durable first-user boundary used by the Reader's integrity projection.
  f.state.ingestAccount({ accountId: null, observedAt: 1800000000010 })
  f.state.ingestAccount({ accountId: 'synthetic-owner', observedAt: 1800000000011 })
  const prefix = { ...record('service-prefix'), author: { role: 'system' }, metadata: {} }
  const reopened = f.page([prefix, original, record('reply', 'first-user')])
  reopened.payload.page_info = {
    start_cursor: 'service-prefix',
    end_cursor: 'reply',
    has_previous_page: false,
    has_next_page: false,
  }
  f.state.ingestPage(reopened)
  await f.capture.waitForDistribution()
  await f.workspace.open('gateway-birth')
  for (let attempt = 0; attempt < 100 && f.workspace.status('gateway-birth').loading; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1))
  expect(f.state.header('gateway-birth')?.startEvidence?.firstMessageId).toBe('service-prefix')
  expect(f.workspace.integrity('gateway-birth')).toMatchObject({
    firstMessageId: 'first-user',
    chain: 'verified',
  })
})

test('timeline represents readable messages, excluding hidden user/model context and reasoning records', async () => {
  const f = fixture('gateway-visible-timeline')
  const first = { ...record('user'), author: { role: 'user' } }
  const userContext = {
    ...record('user-context', 'user'),
    author: { role: 'user' },
    content: { content_type: 'user_editable_context', user_profile: '', user_instructions: 'Synthetic' },
  }
  const modelContext = {
    ...record('model-context', 'user-context'),
    content: {
      content_type: 'model_editable_context',
      model_set_context: 'Synthetic',
      repository: null,
      repo_summary: null,
      structured_context: null,
    },
  }
  const recap = {
    ...record('recap', 'model-context'),
    content: { content_type: 'reasoning_recap', content: 'Synthetic recap' },
  }
  f.state.ingestPage(f.page([first, userContext, modelContext, recap, record('answer', 'recap')]))
  expect(
    (await f.adapter.getTimeline?.('gateway-visible-timeline'))?.map((node) => node.id).sort(),
  ).toEqual(['answer', 'user'])
  expect(f.state.observations.receivedCount('gateway-visible-timeline')).toBe(5)
})

test('an existing conversation submit or an unacknowledged create cannot invent a start marker', async () => {
  const f = fixture('gateway-existing')
  const original = {
    id: 'later-user',
    author: { role: 'user' },
    content: { content_type: 'text', parts: ['Synthetic'] },
  }
  const body = {
    action: 'next',
    turn_attribution: { turn_trigger: 'composer' },
    parent_message_id: 'prior',
    messages: [original],
  }
  const existing = conversationRequestTimingFromBody(
    'https://chatgpt.com/backend-api/f/conversation',
    'POST',
    { ...body, conversation_id: 'gateway-existing' },
    1800000000000,
  )
  expect(existing?.creation).toBeUndefined()
  const pending = conversationRequestTimingFromBody(
    'https://chatgpt.com/backend-api/f/conversation',
    'POST',
    body,
    1800000000000,
  )
  if (!pending) throw Error('Synthetic creation request unavailable')
  f.state.ingestRequest({ ...pending, accountId: 'synthetic-owner', requestId: 'rejected-run' })
  f.state.ingestStreamEvent({
    kind: 'error',
    accountId: 'synthetic-owner',
    conversationId: 'gateway-existing',
    requestId: 'rejected-run',
    observedAt: 1800000000001,
    errorCode: 'request_rejected',
    errorReason: null,
    canRetry: false,
  })
  expect(f.state.header('gateway-existing')?.startEvidence).toBeUndefined()
  await f.capture.waitForDistribution()
  expect(await f.capture.savedCurrent()).toBe(0)
})

test('a native project create respects its disabled capture policy for the first message', async () => {
  const f = fixture('gateway-birth-project')
  await f.settings.update({
    archive: {
      defaultRule: { enabled: true },
      projects: { 'g-p-disabled': { enabled: false, reasoning: true, tools: true, internal: true } },
    },
  })
  const request = conversationRequestTimingFromBody(
    'https://chatgpt.com/backend-api/f/conversation',
    'POST',
    {
      action: 'next',
      turn_attribution: { turn_trigger: 'composer' },
      gizmo_id: 'g-p-disabled',
      parent_message_id: 'native-parent',
      messages: [
        {
          id: 'project-first',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Synthetic private project'] },
        },
      ],
    },
    1800000000000,
  )
  if (!request) throw Error('Synthetic project creation request unavailable')
  f.state.ingestRequest({ ...request, accountId: 'synthetic-owner', requestId: 'project-create' })
  f.state.ingestStreamEvent({
    kind: 'message',
    accountId: 'synthetic-owner',
    conversationId: 'gateway-birth-project',
    requestId: 'project-create',
    observedAt: 1800000000001,
    record: record('project-reply', 'project-first'),
  })
  await f.capture.waitForDistribution()
  expect(f.state.header('gateway-birth-project')?.startEvidence?.firstMessageId).toBe('project-first')
  expect(await f.capture.savedCurrent()).toBe(0)
})

test('a confirmed history start remains durable when a later latest-window read has older pages', async () => {
  const f = fixture('gateway-boundary')
  await f.settings.update({ archive: { defaultRule: { enabled: true } } })
  const first = f.page([record('oldest'), record('head', 'oldest')])
  first.payload.page_info = {
    start_cursor: 'oldest',
    end_cursor: 'head',
    has_previous_page: false,
    has_next_page: false,
  }
  f.state.ingestPage(first)
  await f.capture.waitForDistribution()
  const later = f.page([record('new-head', 'head')])
  later.readId = 'later-read'
  later.readStartedAt = later.timestamp = first.timestamp + 1000
  later.payload.page_info = {
    start_cursor: 'new-head',
    end_cursor: 'new-head',
    has_previous_page: true,
    has_next_page: false,
  }
  f.state.ingestPage(later)
  await f.capture.waitForDistribution()
  expect(
    (await f.capture.workspaceChunk('gateway-boundary')).header?.startEvidence?.firstMessageId,
  ).toBe('oldest')
  expect(await f.capture.integrity('gateway-boundary')).toMatchObject({
    start: 'verified',
    firstMessageId: 'oldest',
  })
})

test('archive off retains pages, stream variants and terminal events; enable replays to DB without replaying lifecycle', async () => {
  const f = fixture('gateway-replay')
  let receivedChanges = 0,
    savedChanges = 0
  f.state.observations.subscribeCounts(() => receivedChanges++)
  f.capture.subscribeCounts(() => savedChanges++)
  f.state.ingestPage(f.page([record('root')]))
  f.state.ingestRequest({
    accountId: 'synthetic-owner',
    conversationId: 'gateway-replay',
    requestId: 'run',
    userMessageId: 'user',
    startedAt: 1800000000001,
    observedAt: 1800000000001,
    source: 'transport_request',
  })
  f.state.ingestStreamEvent({
    kind: 'message',
    accountId: 'synthetic-owner',
    conversationId: 'gateway-replay',
    requestId: 'run',
    observedAt: 1800000000002,
    record: record('reply', 'root', 'A'),
  })
  f.state.ingestStreamEvent({
    kind: 'message',
    accountId: 'synthetic-owner',
    conversationId: 'gateway-replay',
    requestId: 'run',
    observedAt: 1800000000003,
    record: record('reply', 'root', 'AB'),
  })
  f.state.ingestStreamEvent({
    kind: 'complete',
    phase: 'main',
    accountId: 'synthetic-owner',
    conversationId: 'gateway-replay',
    requestId: 'run',
    observedAt: 1800000000004,
  })
  await f.capture.waitForDistribution()
  expect(f.state.observations.receivedCount('gateway-replay')).toBe(2)
  expect(f.state.observations.messageObservations('gateway-replay', 'reply')).toHaveLength(2)
  expect(f.state.observations.observations('gateway-replay')).toHaveLength(5)
  expect(await f.capture.savedCurrent()).toBe(0)
  expect(receivedChanges).toBe(2)
  expect(savedChanges).toBe(0)
  const revision = f.state.revision('gateway-replay')
  const live = await f.adapter.getThreadWindow?.('gateway-replay')
  expect(live?.totalKnownRecordCount).toBe(2)
  expect(live?.source).toBe('live')
  await f.settings.update({ archive: { defaultRule: { enabled: true } } })
  await f.capture.waitForDistribution()
  expect(await f.capture.savedCurrent()).toBe(2)
  expect(savedChanges).toBe(2)
  expect(f.state.revision('gateway-replay')).toBe(revision)
  expect(await f.capture.messageVersions('gateway-replay', 'reply')).toHaveLength(2)
  await f.settings.update({ archive: { defaultRule: { enabled: false } } })
  await f.settings.update({ archive: { defaultRule: { enabled: true } } })
  await f.capture.waitForDistribution()
  expect(await f.capture.messageVersions('gateway-replay', 'reply')).toHaveLength(2)
})

test('failed DB hydration keeps RAM usable and retries only on an explicit request', async () => {
  const f = fixture('gateway-read-failure')
  f.state.ingestPage(f.page([record('live')]))
  let reads = 0
  f.capture.workspaceChunk = async () => {
    reads++
    throw Error('Synthetic unavailable DB')
  }
  await f.workspace.open('gateway-read-failure')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(f.workspace.status('gateway-read-failure')).toMatchObject({
    failed: true,
    loading: false,
    loaded: 1,
  })
  await f.adapter.getThreadWindow?.('gateway-read-failure')
  await f.adapter.getThreadWindow?.('gateway-read-failure')
  expect(reads).toBe(1)
  f.capture.workspaceChunk = async () => ({
    header: undefined,
    rows: [],
    cursor: undefined,
    hasMore: false,
  })
  f.workspace.retry('gateway-read-failure')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(f.workspace.status('gateway-read-failure')).toMatchObject({
    failed: false,
    loading: false,
    loaded: 1,
  })
})

test('a new DB incarnation replaces hydrated rows while retaining independent native RAM', async () => {
  const f = fixture('gateway-incarnation')
  f.state.ingestPage(f.page([record('live', 'old-parent')]))
  let incarnation = 'A'
  f.capture.workspaceChunk = async () => ({
    header: {
      key: 'synthetic',
      accountId: 'synthetic-owner',
      conversationId: 'gateway-incarnation',
      projectId: null,
      title: null,
      instanceId: incarnation,
    },
    rows: [
      {
        id: incarnation === 'A' ? 'old-parent' : 'new-parent',
        raw: record(incarnation === 'A' ? 'old-parent' : 'new-parent'),
        normalized: undefined,
        observedAtMs: 1800000000000,
      },
    ],
    cursor: undefined,
    hasMore: false,
  })
  await f.workspace.open('gateway-incarnation')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(f.workspace.status('gateway-incarnation').missingParents).toBe(0)
  incarnation = 'B'
  f.workspace.retry('gateway-incarnation')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(f.workspace.getMessage('gateway-incarnation', 'old-parent')).toBeUndefined()
  expect(f.workspace.getMessage('gateway-incarnation', 'live')).toBeDefined()
  expect(f.workspace.getMessage('gateway-incarnation', 'new-parent')).toBeDefined()
  expect(f.workspace.status('gateway-incarnation').missingParents).toBe(1)
  expect(f.state.observations.receivedCount('gateway-incarnation')).toBe(1)
})

test('unknown source is retained and counted in RAM, quarantined from canonical persistence', async () => {
  const f = fixture('gateway-unknown')
  const strict = new ConversationStateStore(window)
  strict.ingestAccount({ accountId: 'synthetic-owner', observedAt: 1 })
  expect(() =>
    strict.ingestStreamEvent({
      kind: 'message',
      conversationId: 'gateway-unknown',
      accountId: 'synthetic-owner',
      observedAt: 2,
      record: { ...record('opaque'), future_field: 'retained' },
    }),
  ).toThrow()
  expect(strict.observations.receivedCount('gateway-unknown')).toBe(1)
  expect(strict.observations.sources('gateway-unknown')).toHaveLength(0)
  expect(strict.observations.messageObservations('gateway-unknown', 'opaque')[0]?.observation.kind).toBe(
    'stream',
  )
  expect(await f.capture.savedCurrent()).toBe(0)
})

test('replay reaches a newly enabled remote sink once, including already identical local records', async () => {
  const f = fixture('gateway-remote')
  let receipts = 0,
    accepted = false
  f.capture.subscribeCommitted(() => {
    if (!accepted) return { accepted: false }
    receipts++
    return { accepted: true }
  })
  await f.settings.update({ archive: { defaultRule: { enabled: true } } })
  f.state.ingestPage(f.page([record('root')]))
  await f.capture.waitForDistribution()
  accepted = true
  await f.settings.update({
    automation: { remote: { enabled: true, mode: 'local-and-remote', endpoint: 'ws://127.0.0.1:9123' } },
  })
  await f.capture.waitForDistribution()
  expect(receipts).toBe(1)
  f.capture.replayBuffered()
  await f.capture.waitForDistribution()
  expect(receipts).toBe(1)
  expect(await f.capture.savedCurrent()).toBe(1)
})

test('RAM workspace is usable while DB hydration is blocked, fills chunks and resolves missing UUID parents', async () => {
  const f = fixture('gateway-workspace')
  f.state.ingestPage(f.page([record('child-uuid', 'parent-uuid')]))
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = f.capture.workspaceChunk.bind(f.capture)
  let chunks = 0
  f.capture.workspaceChunk = async () => {
    chunks++
    if (chunks === 1) await blocked
    return {
      header: undefined,
      rows: [
        {
          id: 'parent-uuid',
          raw: record('parent-uuid'),
          normalized: undefined,
          observedAtMs: 1800000000000,
        },
      ],
      cursor: 'parent-uuid',
      hasMore: false,
    }
  }
  try {
    const initial = await f.adapter.getThreadWindow?.('gateway-workspace')
    expect(initial?.totalKnownRecordCount).toBe(1)
    expect(f.workspace.status('gateway-workspace')).toMatchObject({
      loading: true,
      loaded: 1,
      missingParents: 1,
    })
    expect(f.workspace.getMessage('gateway-workspace', 'child-uuid')?.parentId).toBe('parent-uuid')
    release()
    for (let attempt = 0; f.workspace.status('gateway-workspace').loading && attempt < 50; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 1))
    expect(f.workspace.status('gateway-workspace')).toMatchObject({
      loading: false,
      loaded: 2,
      missingParents: 0,
    })
    expect(f.workspace.branchPath('gateway-workspace', 'child-uuid')).toEqual([
      'parent-uuid',
      'child-uuid',
    ])
    expect(await f.capture.savedCurrent()).toBe(0)
  } finally {
    release()
    f.capture.workspaceChunk = original
  }
})

test('a stalled remote-only consumer cannot block local capture after a policy switch', async () => {
  const f = fixture('gateway-independent-queues')
  let release!: () => void, started!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  f.capture.subscribeRemoteSource(async () => {
    started()
    await blocked
    return { accepted: true }
  })
  await f.settings.update({
    automation: { remote: { enabled: true, mode: 'remote-only', endpoint: 'ws://127.0.0.1:9123' } },
  })
  f.state.ingestPage(f.page([record('independent')]))
  await entered
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    await f.settings.update({
      archive: { defaultRule: { enabled: true } },
      automation: { remote: { enabled: false, mode: 'local-only' } },
    })
    const count = await Promise.race([
      f.capture.savedCurrent(),
      new Promise<number>((resolve) => {
        deadline = setTimeout(() => resolve(-1), 2000)
      }),
    ])
    expect(count).toBe(1)
  } finally {
    if (deadline) clearTimeout(deadline)
    release()
    await f.capture.waitForDistribution()
  }
})

test('owner switch clears RAM and fences delayed workspace chunks and replay', async () => {
  const f = fixture('gateway-owner')
  f.state.ingestPage(f.page([record('private-A')]))
  await f.workspace.open('gateway-owner')
  f.state.ingestAccount({ accountId: 'synthetic-B', observedAt: 5 })
  expect(f.state.observations.receivedCount('gateway-owner')).toBe(0)
  expect(f.workspace.status('gateway-owner').loaded).toBe(0)
  await f.settings.update({ archive: { defaultRule: { enabled: true } } })
  await f.capture.waitForDistribution()
  expect(await f.capture.savedCurrent()).toBe(0)
})

test('workspace indexes 3000 UUID records, fills 19 bounded chunks and follows ancestry without UUID ordering', async () => {
  const f = fixture('gateway-large-workspace')
  const ids = Array.from({ length: 3000 }, () => crypto.randomUUID())
  const rows = ids
    .map((id, index) => ({
      id,
      raw: { ...record(id, ids[index - 1] ?? null), create_time: 1800000000 + index },
      normalized: undefined,
      observedAtMs: 1800000000000 + index,
    }))
    .reverse()
  const positions = new Map(rows.map((row, index) => [row.id, index]))
  let chunks = 0,
    largest = 0
  f.capture.workspaceChunk = async (_id, after) => {
    const start = after ? (positions.get(after) ?? -1) + 1 : 0
    const chunk = rows.slice(start, start + 160)
    chunks++
    largest = Math.max(largest, chunk.length)
    return {
      header: undefined,
      rows: chunk,
      cursor: chunk.at(-1)?.id,
      hasMore: start + chunk.length < rows.length,
    }
  }
  await f.workspace.open('gateway-large-workspace')
  expect(f.workspace.status('gateway-large-workspace')).toMatchObject({
    loading: true,
    loaded: 160,
    missingParents: 1,
  })
  for (
    let attempt = 0;
    f.workspace.status('gateway-large-workspace').loading && attempt < 100;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 2))
  expect(f.workspace.status('gateway-large-workspace')).toMatchObject({
    loading: false,
    loaded: 3000,
    missingParents: 0,
    failed: false,
  })
  expect(chunks).toBe(19)
  expect(largest).toBe(160)
  const target = ids[2000]
  if (!target) throw Error('Synthetic UUID missing')
  expect(f.workspace.getMessage('gateway-large-workspace', target)?.parentId).toBe(ids[1999])
  expect(f.workspace.integrity('gateway-large-workspace')).toMatchObject({
    start: 'verified',
    end: 'unknown',
    chain: 'unknown',
    issues: [],
  })
  expect(
    f.workspace.window('gateway-large-workspace', 'first').records.map((row) => row.messageId),
  ).toEqual(ids.slice(0, 160))
  expect(f.workspace.range('gateway-large-workspace', ids[1999] ?? '', ids[2001] ?? '')).toEqual(
    ids.slice(1999, 2002),
  )
  expect(f.state.observations.receivedCount('gateway-large-workspace')).toBe(0)
  expect(await f.capture.savedCurrent()).toBe(0)
})

test('existing-chat composer submit commits and notifies counters before any assistant stream', async () => {
  const f = fixture('gateway-immediate-submit')
  await f.settings.update({ archive: { defaultRule: { enabled: true } } })
  const original = {
    id: 'second-user',
    author: { role: 'user' },
    create_time: 1800000000,
    content: { content_type: 'text', parts: ['Synthetic subsequent submission'] },
    metadata: {},
  }
  const request = conversationRequestTimingFromBody(
    'https://chatgpt.com/backend-api/f/conversation',
    'POST',
    {
      action: 'next',
      conversation_id: 'gateway-immediate-submit',
      turn_attribution: { turn_trigger: 'composer' },
      parent_message_id: 'previous-assistant',
      messages: [original],
    },
    1800000000000,
  )
  if (!request) throw Error('Synthetic request missing')
  expect(request.creation).toBeUndefined()
  let received = 0,
    saved = 0
  const stopReceived = f.state.observations.subscribeCounts(() => {
    received++
  })
  const stopSaved = f.capture.subscribeCounts(() => {
    saved++
  })
  try {
    f.state.ingestRequest({ ...request, accountId: 'synthetic-owner', requestId: 'second-submit' })
    expect(f.state.observations.receivedCount('gateway-immediate-submit')).toBe(1)
    expect(received).toBe(1)
    await f.capture.waitForDistribution()
    expect(await f.capture.savedCount('gateway-immediate-submit')).toBe(1)
    expect(saved).toBe(1)
    expect((await f.capture.readConversation('gateway-immediate-submit'))[0]?.raw).toEqual(original)
    expect(
      (await f.capture.workspaceChunk('gateway-immediate-submit')).header?.startEvidence,
    ).toBeUndefined()
    f.state.ingestRequest({ ...request, accountId: 'synthetic-owner', requestId: 'second-submit' })
    await f.capture.waitForDistribution()
    expect(received).toBe(1)
    expect(saved).toBe(1)
  } finally {
    stopReceived()
    stopSaved()
  }
})
