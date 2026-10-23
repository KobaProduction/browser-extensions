import { afterEach, expect, test } from 'bun:test'
import { readConversationActivity } from '@chatgpt-booster/chatgpt'
import { normalizeSettings } from '@chatgpt-booster/core'
import {
  ARCHIVE_NETWORK_EVENT,
  conversationRequestTimingFromBody,
  conversationStopTargetFromBody,
  TRANSPORT_CHANNEL,
} from '@chatgpt-booster/observer'
import { Window } from 'happy-dom'
import { ArchiveSourceGate } from './archive-source-contract'
import {
  type ChatGptNativeMethodAdapter,
  createChatGptNativeCommandPort,
  decorateChatGptNativeMethod,
} from './conversation-command-port'
import { ConversationStateStore } from './conversation-state'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function setup() {
  const dom = new Window({ url: 'https://chatgpt.com/c/visible-but-unrelated' })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    Element: globalThis.Element,
    CustomEvent: globalThis.CustomEvent,
  }
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    location: dom.location,
    Element: dom.Element,
    CustomEvent: dom.CustomEvent,
  })
  cleanups.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  const state = new ConversationStateStore(
    dom as unknown as globalThis.Window,
    new ArchiveSourceGate(true),
  )
  state.ingestAccount({ accountId: 'owner-A', observedAt: 1 })
  return { dom, state }
}
function request(
  state: ConversationStateStore,
  requestId: string,
  conversationId: string | null,
  at = 1000,
) {
  state.ingestRequest({
    requestId,
    conversationId,
    accountId: 'owner-A',
    userMessageId: `${requestId}-user`,
    startedAt: at,
    observedAt: at + 1,
    source: 'transport_request',
  })
}
const message = (id: string) => ({
  id,
  author: { role: 'assistant', metadata: {} },
  create_time: 2,
  update_time: 3,
  content: { content_type: 'text', parts: ['synthetic answer'] },
  status: 'finished_successfully',
  end_turn: true,
  recipient: 'all',
  channel: 'final',
  metadata: {},
})

test('stop and restart revoke owner proof and RAM before an account may change while observation is detached', () => {
  const { state } = setup()
  state.start()
  request(state, 'old-owner-run', 'old-owner-chat')
  expect(state.lifecycle('old-owner-chat')?.requestId).toBe('old-owner-run')
  const epoch = state.accountEpoch()
  state.stop()
  state.start()
  expect(state.accountEpoch()).toBeGreaterThan(epoch)
  expect(state.verifiedAccountId()).toBeNull()
  expect(state.lifecycle('old-owner-chat')).toBeUndefined()
  // Native account B may have been selected while no observer was installed. Old-owner
  // source packets cannot restore A, and fresh B proof cannot inherit A's observed run.
  request(state, 'late-old-owner-run', 'old-owner-chat', 2000)
  expect(state.lifecycle('old-owner-chat')).toBeUndefined()
  state.ingestAccount({ accountId: 'owner-B', observedAt: 3000 })
  expect(state.verifiedAccountId()).toBe('owner-B')
  expect(state.lifecycle('old-owner-chat')).toBeUndefined()
  state.stop()
})

test('network bodies without conversation identity never inherit the visible route', () => {
  const { state } = setup()
  expect(
    conversationRequestTimingFromBody(
      'https://chatgpt.com/backend-api/conversation',
      'POST',
      { messages: [] },
      1,
    )?.conversationId,
  ).toBeNull()
  expect(
    conversationStopTargetFromBody('https://chatgpt.com/backend-api/stop_conversation', 'POST', {}),
  ).toBeNull()
  request(state, 'pending-run', null)
  state.ingestStreamEvent({
    conversationId: null,
    requestId: 'pending-run',
    kind: 'complete',
    phase: 'main',
    observedAt: 2000,
  })
  state.ingestStop({
    conversationId: null,
    requestId: 'pending-run',
    phase: 'confirmed',
    timestamp: 2001,
    status: 200,
  })
  expect(state.listSnapshots()).toEqual([])
  state.ingestStreamEvent({
    conversationId: 'actual-conversation',
    requestId: 'pending-run',
    accountId: 'owner-A',
    kind: 'message',
    record: message('answer'),
    observedAt: 2002,
  })
  expect(state.lifecycle('actual-conversation')).toMatchObject({
    requestId: 'pending-run',
    state: 'complete',
  })
  expect(state.lifecycle('visible-but-unrelated')).toBeUndefined()
})

test('concurrent unknown conversations resolve independently and stale packets cannot finish a newer run', () => {
  const { state } = setup()
  request(state, 'A', null, 1000)
  request(state, 'B', null, 1100)
  state.ingestStreamEvent({
    conversationId: 'chat-B',
    requestId: 'B',
    kind: 'async-status',
    asyncStatus: 1,
    observedAt: 1200,
  })
  state.ingestStreamEvent({
    conversationId: 'chat-A',
    requestId: 'A',
    kind: 'async-status',
    asyncStatus: 1,
    observedAt: 1250,
  })
  expect(state.lifecycle('chat-A')?.requestId).toBe('A')
  expect(state.lifecycle('chat-B')?.requestId).toBe('B')
  request(state, 'A-new', 'chat-A', 1300)
  state.ingestStreamEvent({
    conversationId: 'chat-A',
    requestId: 'A',
    kind: 'complete',
    phase: 'main',
    observedAt: 1400,
  })
  state.ingestStreamEvent({
    conversationId: 'chat-A',
    requestId: 'A',
    kind: 'safety-review',
    active: true,
    protectionType: 'cyber',
    message: 'stale',
    observedAt: 1401,
  })
  state.ingestStreamStatus({
    conversationId: 'chat-A',
    requestId: 'A',
    status: 'COMPLETE',
    observedAt: 1402,
    httpStatus: 200,
  })
  state.ingestStop({
    conversationId: 'chat-A',
    requestId: 'A',
    phase: 'confirmed',
    timestamp: 1403,
    status: 200,
  })
  expect(state.lifecycle('chat-A')).toMatchObject({ requestId: 'A-new', state: 'in_progress' })
  expect(state.safetyReview('chat-A')).toBeUndefined()
  state.ingestStreamEvent({
    conversationId: null,
    requestId: 'A-new',
    kind: 'safety-review',
    active: true,
    protectionType: 'cyber',
    message: 'actual',
    observedAt: 1404,
  })
  expect(state.safetyReview('chat-A')).toMatchObject({ active: true, message: 'actual' })
  state.ingestStreamEvent({
    conversationId: null,
    requestId: 'A-new',
    kind: 'complete',
    phase: 'message',
    observedAt: 1405,
  })
  expect(state.lifecycle('chat-A')?.state).toBe('in_progress')
  state.ingestStreamEvent({
    conversationId: null,
    requestId: 'A-new',
    kind: 'error',
    errorCode: 'stream_interrupted',
    errorReason: null,
    canRetry: true,
    observedAt: 1406,
  })
  expect(state.lifecycle('chat-A')).toMatchObject({
    state: 'in_progress',
    transportHealth: 'interrupted',
  })
  state.ingestStreamEvent({
    conversationId: null,
    requestId: 'A-new',
    kind: 'complete',
    phase: 'main',
    observedAt: 1407,
  })
  expect(state.lifecycle('chat-A')?.state).toBe('complete')
})

test('owner transitions clear pending network run correlation and orphan statuses remain unknown', () => {
  const { state } = setup()
  request(state, 'old-owner-run', null)
  state.ingestAccount({ accountId: 'owner-B', observedAt: 1200 })
  state.ingestStreamEvent({
    conversationId: 'old-chat',
    requestId: 'old-owner-run',
    accountId: 'owner-A',
    kind: 'message',
    record: message('old'),
    observedAt: 1300,
  })
  state.ingestStreamEvent({
    conversationId: null,
    requestId: 'old-owner-run',
    kind: 'complete',
    phase: 'main',
    observedAt: 1301,
  })
  state.ingestStreamStatus({
    conversationId: 'orphan',
    status: 'COMPLETE',
    observedAt: 1400,
    httpStatus: 200,
  })
  state.ingestStreamEvent({
    conversationId: 'orphan',
    requestId: 'unbound',
    kind: 'message',
    record: message('orphan-message'),
    observedAt: 1401,
  })
  expect(state.lifecycle('old-chat')).toBeUndefined()
  expect(state.lifecycle('orphan')?.state).toBe('unknown')
})

test('DOM controls, renderer changes, routes and arbitrary internal activity do not change native state', () => {
  const { state, dom } = setup()
  dom.document.body.innerHTML =
    '<main><button data-testid="stop-button"></button><button data-testid="send-button"></button><section data-talvt-turn-state="in_progress"><div data-message-author-role="assistant">Finished</div></section></main>'
  request(state, 'native-run', 'native-chat')
  const before = state.lifecycle('native-chat')
  dom.document.querySelector('button')?.remove()
  dom.history.pushState({}, '', '/c/other-route')
  dom.dispatchEvent(
    new dom.CustomEvent('chatgpt-booster:agent-activity', {
      detail: { active: false, phase: 'complete', conversationId: 'native-chat' },
    }),
  )
  state.observeRendererState('native-chat', 'complete', 'native-run-user')
  state.ingestDomSnapshot({} as never)
  expect(readConversationActivity()).toMatchObject({ active: false, phase: 'idle', turnState: null })
  expect(state.lifecycle('native-chat')).toEqual(before)
})

test('legacy ChatGPT DOM rules stay inspectable but disabled', () => {
  const settings = normalizeSettings({
    automation: {
      enabled: true,
      domEvents: true,
      rules: [
        {
          id: 'legacy',
          label: 'legacy',
          enabled: true,
          trigger: { type: 'dom', name: 'request-done' },
          actions: [{ type: 'stop' }],
          cooldownMs: 0,
        },
      ],
    } as never,
  })
  expect(settings.automation.domEvents).toBe(false)
  expect(settings.automation.rules[0]).toMatchObject({
    id: 'legacy',
    enabled: false,
    trigger: { type: 'dom' },
  })
})

test('unavailable native commands do not touch composer, controls or navigation', async () => {
  const { state, dom } = setup()
  dom.document.body.innerHTML =
    '<textarea id="prompt-textarea">existing</textarea><button data-testid="send-button"></button><button data-testid="stop-button"></button>'
  let interacted = 0
  for (const type of ['click', 'input', 'focus'])
    dom.document.addEventListener(type, () => interacted++, true)
  const before = dom.document.body.innerHTML,
    href = dom.location.href
  const port = createChatGptNativeCommandPort(state)
  for (const command of [
    () => port.send('synthetic'),
    () => port.stop(),
    () => port.continue(),
    () => port.newChat(),
  ])
    await expect(command()).rejects.toThrow('automation.nativeMethodUnavailable')
  expect(interacted).toBe(0)
  expect(dom.document.body.innerHTML).toBe(before)
  expect(dom.location.href).toBe(href)
})

test('explicit native method receipt confirms only its correlated network run, including synchronous fetch evidence', async () => {
  const { state } = setup()
  const bound: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: 'bound-chat' }),
    async invoke(action, { operationId }) {
      expect(action).toEqual({ type: 'send-message', text: 'synthetic' })
      request(state, 'unrelated-run', 'unrelated-chat', 1500)
      request(state, 'bound-run', 'bound-chat', 1600)
      return { operationId, source: 'native-method', conversationId: 'bound-chat', runId: 'bound-run' }
    },
  }
  const runs: string[] = []
  const port = createChatGptNativeCommandPort(state, bound, 100)
  expect(await port.send('synthetic', { correlateRun: (run) => runs.push(run) })).toEqual({
    observed: 'request',
    conversationId: 'bound-chat',
    runId: 'bound-run',
  })
  expect(runs).toEqual(['bound-run'])
})

test('a native invocation or route transition alone does not acknowledge send', async () => {
  const { state, dom } = setup()
  const bound: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: 'requested-route' }),
    async invoke(_action, { operationId }) {
      dom.history.pushState({}, '', '/c/requested-route')
      request(state, 'unrelated-run', 'unrelated-chat')
      return {
        operationId,
        source: 'native-method',
        conversationId: 'requested-route',
        runId: 'missing-run',
      }
    },
  }
  await expect(createChatGptNativeCommandPort(state, bound, 10).send('synthetic')).rejects.toThrow(
    'automation.commandUnconfirmed',
  )
})

test('owner change and abort fence native commands even if binding ignores cancellation', async () => {
  const { state } = setup()
  const bound: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: 'bound-chat' }),
    invoke: async () => await new Promise(() => {}),
  }
  const port = createChatGptNativeCommandPort(state, bound, 100)
  const ownerPending = port.send('synthetic')
  state.ingestAccount({ accountId: 'owner-B', observedAt: 2000 })
  await expect(ownerPending).rejects.toThrow('automation.ownerChanged')
  const controller = new AbortController()
  const abortPending = port.send('synthetic', { signal: controller.signal })
  controller.abort()
  await expect(abortPending).rejects.toThrow('automation.commandCancelled')
})

test('native binding rejections remain failures and empty new chat requires explicit native method confirmation', async () => {
  const { state } = setup()
  const rejected: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: 'bound-chat' }),
    async invoke() {
      throw Error('native rejection')
    },
  }
  await expect(createChatGptNativeCommandPort(state, rejected, 10).send('synthetic')).rejects.toThrow(
    'native rejection',
  )
  const bound: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: null }),
    async invoke(_action, { operationId }) {
      return { operationId, source: 'native-method', conversationId: null, newChat: true }
    },
  }
  expect(await createChatGptNativeCommandPort(state, bound, 10).newChat()).toEqual({
    observed: 'native-method',
    conversationId: null,
  })
})

test('native decoration preserves receiver, exact return/error and coexistence cleanup', async () => {
  const observations: unknown[] = []
  const receiver = {
    count: 1,
    method(value: number) {
      this.count += value
      return this.count
    },
  }
  const original = receiver.method
  const undoFirst = decorateChatGptNativeMethod(receiver, 'method', (value) => observations.push(value))
  const first = receiver.method
  const undoSecond = decorateChatGptNativeMethod(receiver, 'method', () => {
    throw Error('observer failure')
  })
  expect(receiver.method(2)).toBe(3)
  expect(observations).toMatchObject([{ args: [2], result: 3, receiver }])
  undoFirst()
  const second = receiver.method
  expect(second).not.toBe(first)
  expect(receiver.method(1)).toBe(4)
  expect(observations).toHaveLength(1)
  undoSecond()
  expect(receiver.method).toBe(first)
  expect(receiver.method(1)).toBe(5)
  undoFirst()
  expect(receiver.method).toBe(original)
  const thrown = Error('native failure')
  const throwing = {
    method() {
      throw thrown
    },
  }
  const undo = decorateChatGptNativeMethod(throwing, 'method', () => observations.push('incorrect'))
  expect(() => throwing.method()).toThrow(thrown)
  undo()
})

test('native decoration observes foreign promises and thenables without replacing their exact return', async () => {
  const { dom } = setup()
  const seen: unknown[] = []
  const promise = dom.Promise.resolve(42)
  const thenable = {
    // biome-ignore lint/suspicious/noThenProperty: Deliberate native thenable compatibility fixture.
    then(resolve: (value: number) => void) {
      resolve(7)
    },
  }
  const receiver = {
    method(value: unknown) {
      return value
    },
  }
  const undo = decorateChatGptNativeMethod(receiver, 'method', ({ result }) => seen.push(result))
  expect(receiver.method(promise)).toBe(promise)
  expect(receiver.method(thenable)).toBe(thenable)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(seen.sort()).toEqual([42, 7])
  const hostile = {
    // biome-ignore lint/suspicious/noThenProperty: A hostile native then accessor must remain isolated.
    get then() {
      throw Error('hostile getter')
    },
  }
  expect(receiver.method(hostile)).toBe(hostile)
  undo()
})

import type { SettingsAdapter } from '@chatgpt-booster/core'
import { ArchiveCollectionSession } from './archive-collection-session'
import type { FixedChatGptCapture } from './archive-fixed-runtime'
import { ChatGptConversationAutomation } from './conversation-automation'
import { HistoryLoaderModule } from './history-loader'

const noSubscribe = () => () => undefined
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))
test('ChatGPT automation and timer react to correlated network state only; DOM rules cannot be edited back in', async () => {
  const { state, dom } = setup()
  let saved = normalizeSettings({
    enabled: true,
    features: { requestTimer: true } as never,
    automation: {
      enabled: true,
      domEvents: true,
      rules: [
        {
          id: 'api-start',
          label: 'api',
          enabled: true,
          trigger: { type: 'api', name: 'request-start' },
          actions: [{ type: 'stop' }],
          cooldownMs: 0,
        },
      ],
    } as never,
  })
  const settings: SettingsAdapter = {
    get: async () => saved,
    set: async (value) => {
      saved = value
      return value
    },
    update: async () => saved,
    subscribe: noSubscribe,
  }
  const archive = {
    currentScope: () => null,
    subscribeCommitted: noSubscribe,
    subscribeRemoteSource: noSubscribe,
    subscribeRejectedSource: noSubscribe,
  } as unknown as FixedChatGptCapture
  let stops = 0
  const native = {
    send: async () => ({ observed: 'request' as const, conversationId: 'chat', runId: 'run' }),
    stop: async () => {
      stops++
      return { observed: 'stop' as const, conversationId: 'chat', runId: 'run' }
    },
    continue: async () => undefined,
    newChat: async () => undefined,
  }
  const automation = new ChatGptConversationAutomation(state, settings, archive, undefined, native)
  cleanups.push(() => automation.stop())
  await automation.start()
  dom.document.body.innerHTML =
    '<main><button data-testid="stop-button"></button><button data-testid="send-button"></button></main>'
  dom.document.querySelector('button')?.remove()
  dom.history.pushState({}, '', '/c/chat')
  dom.dispatchEvent(
    new dom.CustomEvent('chatgpt-booster:agent-activity', {
      detail: { active: true, conversationId: 'chat' },
    }),
  )
  await settled()
  expect(stops).toBe(0)
  expect(automation.timing.current('chat')).toBeNull()
  await expect(
    automation.dispatch('triggers-draft-upsert', {
      rule: {
        id: 'forbidden',
        label: 'forbidden',
        enabled: true,
        trigger: { type: 'dom', name: 'request-done' },
        actions: [{ type: 'stop' }],
        cooldownMs: 0,
      },
    }),
  ).rejects.toThrow('automation.domTriggerUnsupported')
  request(state, 'run', 'chat')
  await settled()
  expect(stops).toBe(1)
  expect(automation.timing.current('chat')).toMatchObject({
    runId: 'run',
    active: true,
    startedAt: 1000,
    completedAt: null,
  })
  state.ingestStreamEvent({
    conversationId: 'chat',
    requestId: 'run',
    kind: 'error',
    errorCode: 'stream_interrupted',
    errorReason: null,
    canRetry: true,
    observedAt: 2000,
  })
  await settled()
  expect(stops).toBe(1)
  expect(automation.timing.current('chat')?.active).toBe(true)
  state.ingestStreamEvent({
    conversationId: 'chat',
    requestId: 'run',
    kind: 'complete',
    phase: 'main',
    observedAt: 3000,
  })
  await settled()
  expect(automation.timing.current('chat')).toMatchObject({ active: false, completedAt: 3000 })
})

test('collection completes from source coverage and commit ACK with no rendered messages or scroll controls', async () => {
  const { state, dom } = setup()
  const id = 'source-only-history',
    readId = 'native-read'
  state.ingestPage({
    kind: 'conversation-page',
    conversationId: id,
    accountId: 'owner-A',
    timestamp: 3000,
    sourceUrl: 'fixture://native-history',
    readId,
    readStartedAt: 2000,
    isInitial: true,
    requestedBefore: null,
    payload: {
      conversation_id: id,
      messages: [
        {
          ...message('history-user'),
          author: { role: 'user', metadata: {} },
          recipient: null,
          channel: null,
          end_turn: false,
        },
      ],
      page_info: {
        start_cursor: 'start',
        end_cursor: 'end',
        has_previous_page: false,
        has_next_page: false,
      },
    },
  })
  dom.document.body.innerHTML =
    '<main><section data-talvt-turn-state="in_progress">Unrelated renderer state</section></main>'
  let acknowledged = false
  const sessions = new ArchiveCollectionSession()
  const driver = new HistoryLoaderModule(
    state,
    {
      collectionSession: sessions,
      async completeCollection(run) {
        sessions.update(run, { phase: 'saving' })
        acknowledged = true
        sessions.complete(run)
      },
    },
    dom as unknown as globalThis.Window,
    undefined,
    false,
  )
  cleanups.push(() => driver.stop())
  driver.start()
  sessions.begin({
    accountId: 'owner-A',
    conversationId: id,
    projectId: null,
    selectedTipId: null,
    sourceReadId: readId,
    sourceReadStartedAt: 2000,
  })
  await settled()
  expect(acknowledged).toBe(true)
  expect(sessions.snapshot().phase).toBe('complete')
})

test('incomplete collection without a verified native history method fails closed without scrolling', async () => {
  const { state, dom } = setup()
  const sessions = new ArchiveCollectionSession()
  let acknowledged = false
  const driver = new HistoryLoaderModule(
    state,
    {
      collectionSession: sessions,
      async completeCollection() {
        acknowledged = true
      },
    },
    dom as unknown as globalThis.Window,
    undefined,
    false,
  )
  cleanups.push(() => driver.stop())
  driver.start()
  sessions.begin({
    accountId: 'owner-A',
    conversationId: 'incomplete-chat',
    projectId: null,
    selectedTipId: null,
  })
  await settled()
  expect(acknowledged).toBe(false)
  expect(sessions.snapshot()).toMatchObject({
    phase: 'error',
    message: 'archive.error.nativeHistoryUnavailable',
  })
  expect(dom.scrollY).toBe(0)
})

test('collection stops after one native read when its source signature is rejected', async () => {
  const { state, dom } = setup()
  const sessions = new ArchiveCollectionSession()
  let reads = 0
  const driver = new HistoryLoaderModule(
    state,
    {
      collectionSession: sessions,
      async completeCollection() {
        throw Error('Rejected source cannot complete')
      },
    },
    dom as unknown as globalThis.Window,
    undefined,
    false,
    {
      async readOlder() {
        reads++
        state.sourceGate.reject({
          conversationId: 'rejected-native-read',
          version: state.sourceGate.version,
          path: 'nativeGraph',
          reason: 'unsupported',
        })
      },
    },
  )
  cleanups.push(() => driver.stop())
  driver.start()
  sessions.begin({
    accountId: 'owner-A',
    conversationId: 'rejected-native-read',
    projectId: null,
    selectedTipId: null,
  })
  await settled()
  expect(reads).toBe(1)
  expect(sessions.snapshot()).toMatchObject({
    phase: 'error',
    message: 'archive.error.incompatibleSource',
  })
})

test('late native receipts after abort cannot attribute unrelated observations to the cancelled command', async () => {
  const { state } = setup()
  let deliver:
    | ((value: {
        operationId: string
        source: 'native-method'
        conversationId: string
        runId: string
      }) => void)
    | undefined
  let operation = ''
  const bound: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: 'chat' }),
    invoke: async (_action, { operationId }) => {
      operation = operationId
      return await new Promise((resolve) => {
        deliver = resolve
      })
    },
  }
  const correlations: string[] = []
  const controller = new AbortController()
  const pending = createChatGptNativeCommandPort(state, bound, 100).send('synthetic', {
    signal: controller.signal,
    correlateRun: (run) => correlations.push(run),
  })
  controller.abort()
  await expect(pending).rejects.toThrow('automation.commandCancelled')
  deliver?.({
    operationId: operation,
    source: 'native-method',
    conversationId: 'chat',
    runId: 'late-run',
  })
  await settled()
  expect(correlations).toEqual([])
})

test('native stop waits for the exact active run confirmation and cannot reuse a previous terminal state', async () => {
  const { state } = setup()
  request(state, 'stop-run', 'stop-chat')
  const bound: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: 'stop-chat' }),
    async invoke(_action, { operationId }) {
      state.ingestStop({
        conversationId: 'stop-chat',
        requestId: 'old-run',
        phase: 'confirmed',
        timestamp: 1900,
        status: 200,
      })
      expect(state.lifecycle('stop-chat')?.state).toBe('in_progress')
      state.ingestStop({
        conversationId: 'stop-chat',
        requestId: 'stop-run',
        phase: 'requested',
        timestamp: 2000,
        status: null,
      })
      state.ingestStop({
        conversationId: 'stop-chat',
        requestId: 'stop-run',
        phase: 'confirmed',
        timestamp: 2100,
        status: 200,
      })
      return { operationId, source: 'native-method', conversationId: 'stop-chat', runId: 'stop-run' }
    },
  }
  const port = createChatGptNativeCommandPort(state, bound, 10)
  expect(await port.stop({ conversationId: 'stop-chat' })).toEqual({
    observed: 'stop',
    conversationId: 'stop-chat',
    runId: 'stop-run',
  })
  await expect(port.stop({ conversationId: 'stop-chat' })).rejects.toThrow('automation.stopUnavailable')
})

test('native decoration restores inherited methods without leaving an own shadow property', () => {
  const prototype = {
    method() {
      return 3
    },
  }
  const receiver = Object.create(prototype) as typeof prototype
  const undo = decorateChatGptNativeMethod(receiver, 'method', () => undefined)
  expect(Object.hasOwn(receiver, 'method')).toBe(true)
  expect(receiver.method()).toBe(3)
  undo()
  expect(Object.hasOwn(receiver, 'method')).toBe(false)
  expect(receiver.method).toBe(prototype.method)
})

test('native command refuses a different or unverified preflight target before invoking any side effect', async () => {
  const { state } = setup()
  let invoked = 0
  const bound: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: 'B' }),
    async invoke(_action, { operationId }) {
      invoked++
      request(state, 'run-B', 'B')
      return { operationId, source: 'native-method', conversationId: 'B', runId: 'run-B' }
    },
  }
  await expect(
    createChatGptNativeCommandPort(state, bound, 10).send('synthetic', { conversationId: 'A' }),
  ).rejects.toThrow('automation.conversationChanged')
  expect(invoked).toBe(0)
  expect(state.lifecycle('B')).toBeUndefined()
  await expect(
    createChatGptNativeCommandPort(state, { ...bound, preflight: () => null }, 10).send('synthetic'),
  ).rejects.toThrow('automation.nativeMethodUnavailable')
  expect(invoked).toBe(0)
})

test('native command revalidates after beforeAction and supplies a pinned target before native execution', async () => {
  const { state } = setup()
  let active = 'A',
    invoked = 0
  const bound: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: active }),
    async invoke(_action, { operationId, expectedConversationId, expectedProjectId }) {
      invoked++
      expect(expectedConversationId).toBe('A')
      expect(expectedProjectId).toBeNull()
      request(state, 'run-A', expectedConversationId)
      return {
        operationId,
        source: 'native-method',
        conversationId: expectedConversationId,
        runId: 'run-A',
      }
    },
  }
  const port = createChatGptNativeCommandPort(state, bound, 10)
  await expect(
    port.send('synthetic', {
      conversationId: 'A',
      beforeAction: () => {
        active = 'B'
      },
    }),
  ).rejects.toThrow('automation.conversationChanged')
  expect(invoked).toBe(0)
  active = 'A'
  expect(await port.send('synthetic', { conversationId: 'A' })).toMatchObject({
    conversationId: 'A',
    runId: 'run-A',
  })
  expect(invoked).toBe(1)
})

test('new chat preflight verifies the requested project before invoking the native method', async () => {
  const { state } = setup()
  let invoked = 0
  const bound: ChatGptNativeMethodAdapter = {
    preflight: () => ({ source: 'native-method', conversationId: null, projectId: 'project-B' }),
    async invoke(_action, { operationId }) {
      invoked++
      return { operationId, source: 'native-method', conversationId: null, newChat: true }
    },
  }
  await expect(
    createChatGptNativeCommandPort(state, bound, 10).newChat({ projectId: 'project-A' }),
  ).rejects.toThrow('automation.conversationChanged')
  expect(invoked).toBe(0)
})

async function retryHistoryAfterFirstAttempt(mode: 'network-error' | 'no-progress') {
  const { state, dom } = setup()
  const originalSetTimeout = globalThis.setTimeout,
    originalNow = Date.now
  let now = 10_000
  globalThis.setTimeout = ((handler: TimerHandler, _ms?: number, ...args: unknown[]) =>
    originalSetTimeout(handler as never, 1, ...args)) as typeof globalThis.setTimeout
  Date.now = () => now
  cleanups.push(() => {
    globalThis.setTimeout = originalSetTimeout
    Date.now = originalNow
  })
  const id = `retry-${mode}`,
    readId = `read-${mode}`
  state.ingestPage({
    kind: 'conversation-page',
    conversationId: id,
    accountId: 'owner-A',
    timestamp: 3000,
    sourceUrl: 'fixture://native-history',
    readId,
    readStartedAt: 2000,
    isInitial: true,
    requestedBefore: null,
    payload: {
      conversation_id: id,
      messages: [],
      page_info: {
        start_cursor: 'new',
        end_cursor: 'new',
        has_previous_page: true,
        has_next_page: false,
      },
    },
  })
  const initialRevision = state.revision(id),
    sessions = new ArchiveCollectionSession(() => now)
  let reads = 0,
    acknowledged = false
  const driver = new HistoryLoaderModule(
    state,
    {
      collectionSession: sessions,
      async completeCollection(run) {
        sessions.update(run, { phase: 'saving' })
        acknowledged = true
        sessions.complete(run)
      },
    },
    dom as unknown as globalThis.Window,
    undefined,
    false,
    {
      async readOlder() {
        reads++
        if (reads === 1) {
          expect(state.revision(id)).toBe(initialRevision)
          if (mode === 'network-error')
            dom.dispatchEvent(
              new dom.MessageEvent('message', {
                origin: dom.location.origin,
                source: dom as never,
                data: {
                  channel: TRANSPORT_CHANNEL,
                  type: ARCHIVE_NETWORK_EVENT,
                  detail: { conversationId: id, phase: 'error', status: 429 },
                },
              }),
            )
          else now += 12_001
          return
        }
        expect(state.revision(id)).toBe(initialRevision)
        state.ingestPage({
          kind: 'conversation-page',
          conversationId: id,
          accountId: 'owner-A',
          timestamp: 4000,
          sourceUrl: 'fixture://native-history',
          readId,
          readStartedAt: 2000,
          isInitial: false,
          requestedBefore: 'new',
          payload: {
            messages: [],
            page_info: {
              start_cursor: 'old',
              end_cursor: 'old',
              has_previous_page: false,
              has_next_page: true,
            },
          },
        })
      },
    },
  )
  cleanups.push(() => driver.stop())
  driver.start()
  sessions.begin({
    accountId: 'owner-A',
    conversationId: id,
    projectId: null,
    selectedTipId: null,
    sourceReadId: readId,
    sourceReadStartedAt: 2000,
  })
  for (let attempt = 0; attempt < 30 && sessions.snapshot().phase !== 'complete'; attempt++)
    await new Promise((resolve) => originalSetTimeout(resolve, 2))
  expect(reads).toBe(2)
  expect(acknowledged).toBe(true)
  expect(sessions.snapshot().phase).toBe('complete')
}

test('native history retries an errored attempt at the same revision and completes only after network page progress', async () => {
  await retryHistoryAfterFirstAttempt('network-error')
})
test('native history retries a no-progress attempt at the same revision and completes only after network page progress', async () => {
  await retryHistoryAfterFirstAttempt('no-progress')
})
