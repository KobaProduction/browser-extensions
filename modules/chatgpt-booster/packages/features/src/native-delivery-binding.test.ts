import { expect, test } from 'bun:test'
import { ArchiveSourceGate } from './archive-source-contract'
import { ConversationStateStore } from './conversation-state'
import { bindNativeDeliveryFailure } from './native-delivery-binding'

function fixture() {
  const state = new ConversationStateStore({} as Window, new ArchiveSourceGate(true))
  state.ingestAccount({ accountId: 'owner', observedAt: 1 })
  const page = {
    kind: 'conversation-page' as const,
    conversationId: 'chat',
    timestamp: 3000,
    readStartedAt: 2000,
    readId: 'read',
    isInitial: true,
    requestedBefore: null,
    sourceUrl: 'fixture://history',
    payload: {
      conversation_id: 'chat',
      current_node: 'reply',
      async_status: 3,
      messages: ['user', 'reply'].map((id, i) => ({
        id,
        author: { role: i ? 'assistant' : 'user' },
        create_time: 1 + i,
        status: i ? 'in_progress' : 'finished_successfully',
        end_turn: false,
        recipient: 'all',
        channel: 'final',
        metadata: { parent_id: i ? 'user' : null },
        content: { content_type: 'text', parts: ['Synthetic message'] },
      })),
      page_info: {
        start_cursor: 'user',
        end_cursor: 'reply',
        has_previous_page: false,
        has_next_page: false,
      },
    },
  }
  state.ingestPage(page)
  const tokens = { account: {}, status: {}, error: {}, head: {} }
  const values = new Map<unknown, unknown>([
    [tokens.account, 'owner'],
    [tokens.status, 'streaming'],
    [tokens.head, 'reply'],
  ])
  const receipt = Symbol('native-result')
  const watchers = new Set<() => void>()
  const write = (token: unknown, value: unknown) => {
    values.set(token, value)
    for (const watcher of [...watchers]) watcher()
  }
  const scope = {
    get: (token: unknown) => values.get(token),
    watch(callback: (reader: { get(token: unknown): unknown }) => void) {
      const watcher = () => callback({ get: scope.get })
      watchers.add(watcher)
      watcher()
      return () => {
        watchers.delete(watcher)
      }
    },
    set(token: unknown, _id: unknown, value: unknown) {
      write(token, value)
      return receipt
    },
  }
  const original = scope.set
  const fail = () => {
    scope.set(tokens.error, 'chat', {
      metadata: { errorCode: 'recovery_unconfirmed', messageId: 'reply' },
    })
    return scope.set(tokens.status, 'chat', 'error')
  }
  return { state, page, scope, tokens, values, receipt, original, fail, write, watchers }
}

test('native delivery error closes the recovered run, preserves native return and cannot be resurrected by old pages', () => {
  const f = fixture()
  const stop = bindNativeDeliveryFailure(f.state, f.scope, f.tokens, () => true)
  expect(f.fail()).toBe(f.receipt)
  expect(f.state.lifecycle('chat')).toMatchObject({
    state: 'failed',
    terminalCause: 'native_delivery_failure',
  })
  const completed = f.state.lifecycle('chat')?.completedAt
  f.state.ingestPage({ ...f.page, timestamp: 5000 })
  f.state.ingestStreamStatus({
    conversationId: 'chat',
    status: 'IS_STREAMING',
    observedAt: Date.now(),
    httpStatus: 200,
  })
  expect(f.state.lifecycle('chat')).toMatchObject({ state: 'failed', completedAt: completed })
  expect(f.state.listMessages('chat')).toHaveLength(2)
  stop()
  expect(f.scope.set).toBe(f.original)
  expect(f.watchers.size).toBe(0)
})

test('native subscription observes writes through another scope sharing the same store', () => {
  const f = fixture()
  const stop = bindNativeDeliveryFailure(f.state, f.scope, f.tokens, () => true)
  f.write(f.tokens.error, { metadata: { errorCode: 'recovery_unconfirmed', messageId: 'reply' } })
  f.write(f.tokens.status, 'error')
  expect(f.state.lifecycle('chat')?.state).toBe('failed')
  stop()
})

test('native error already present on attachment stops a recovered timer without a new network request', () => {
  const f = fixture()
  f.fail()
  const stop = bindNativeDeliveryFailure(f.state, f.scope, f.tokens, () => true)
  expect(f.state.lifecycle('chat')?.state).toBe('failed')
  stop()
})

test('unknown, wrong-head, wrong-owner and revoked native errors cannot finish a run', () => {
  for (const mode of ['unknown', 'head', 'owner', 'revoked']) {
    const f = fixture()
    const stop = bindNativeDeliveryFailure(f.state, f.scope, f.tokens, () => mode !== 'revoked')
    if (mode === 'owner') f.values.set(f.tokens.account, 'other-owner')
    f.scope.set(f.tokens.error, 'chat', {
      metadata: {
        errorCode: mode === 'unknown' ? 'unknown' : 'recovery_unconfirmed',
        messageId: mode === 'head' ? 'old-head' : 'reply',
      },
    })
    f.scope.set(f.tokens.status, 'chat', 'error')
    expect(f.state.lifecycle('chat')?.state).toBe('in_progress')
    stop()
  }
})

test('an old native error and page cannot terminate a newer local request', () => {
  const f = fixture()
  const stop = bindNativeDeliveryFailure(f.state, f.scope, f.tokens, () => true)
  f.fail()
  f.state.ingestRequest({
    accountId: 'owner',
    conversationId: 'chat',
    requestId: 'new-run',
    userMessageId: 'new-user',
    startedAt: Date.now(),
    observedAt: Date.now(),
    source: 'transport_request',
  })
  f.state.ingestPage({ ...f.page, timestamp: Date.now() })
  f.fail()
  expect(f.state.lifecycle('chat')).toMatchObject({ state: 'in_progress', requestId: 'new-run' })
  stop()
})
