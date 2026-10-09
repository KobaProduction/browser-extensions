import { describe, expect, test } from 'bun:test'
import { ArchiveSourceGate } from '../packages/features/src/archive-source-contract'
import type { ArchivedMessage } from '../packages/features/src/archive-store'
import { ConversationStateStore } from '../packages/features/src/conversation-state'

const fakeWindow = {} as Window

function page(
  conversationId: string,
  messages: Record<string, unknown>[],
  timestamp = 2_000,
  payloadPatch: Record<string, unknown> = {},
) {
  return {
    kind: 'conversation-page' as const,
    conversationId,
    timestamp,
    sourceUrl: 'fixture://history',
    readId: `${conversationId}-read`,
    readStartedAt: timestamp - 10,
    isInitial: true,
    requestedBefore: null,
    payload: {
      conversation_id: conversationId,
      title: 'Fixture chat',
      messages,
      page_info: {
        start_cursor: 'start',
        end_cursor: 'end',
        has_previous_page: false,
        has_next_page: false,
      },
      ...payloadPatch,
    },
  }
}

function message(
  id: string,
  role: 'user' | 'assistant' | 'tool',
  createTime: number,
  patch: Record<string, unknown> = {},
) {
  return {
    id,
    author: { role, name: null, metadata: {} },
    create_time: createTime,
    update_time: null,
    content: { content_type: 'text', parts: [id] },
    status: 'finished_successfully',
    recipient: role === 'assistant' ? 'all' : null,
    channel: role === 'assistant' ? 'final' : null,
    metadata: {},
    ...patch,
  }
}

describe('ConversationStateStore memory-first state', () => {
  test('account transition does not promote unattributed or other-account pages', () => {
    const store = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const oldPage = { ...page('chat-memory', [message('m1', 'user', 1)]), accountId: null }
    store.ingestPage(oldPage)
    expect(store.listMessages('chat-memory')).toHaveLength(1)

    store.ingestAccount({ accountId: 'account-A', observedAt: 1 })
    expect(store.verifiedAccountId()).toBe('account-A')
    expect(store.listMessages('chat-memory')).toHaveLength(0)

    store.ingestPage({ ...oldPage, timestamp: 2, accountId: 'account-A' })
    expect(store.listMessages('chat-memory')).toHaveLength(1)

    store.ingestAccount({ accountId: 'account-B', observedAt: 3 })
    expect(store.verifiedAccountId()).toBe('account-B')
    expect(store.listMessages('chat-memory')).toHaveLength(0)
    store.ingestPage({ ...oldPage, timestamp: 4, accountId: 'account-A' })
    expect(store.listMessages('chat-memory')).toHaveLength(0)
  })

  test('initial payload is immediately indexed by message and turn ids', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-memory'
    const turnId = 'turn-memory'
    state.ingestPage(
      page(conversationId, [
        message('user-1', 'user', 1, {
          metadata: { turn_exchange_id: turnId, working_turn_id: turnId },
        }),
        message('assistant-1', 'assistant', 2, {
          metadata: { turn_exchange_id: turnId, working_turn_id: turnId },
        }),
        message('tool-1', 'tool', 1.5, {
          metadata: { turn_exchange_id: turnId, working_turn_id: turnId },
        }),
      ]),
    )

    expect(state.getMessage(conversationId, 'user-1')?.messageId).toBe('user-1')
    expect(
      state.recordsForMessageIds(conversationId, ['user-1']).map((item) => item.messageId),
    ).toEqual(['user-1', 'tool-1', 'assistant-1'])
    expect(state.snapshot(conversationId)?.title).toBe('Fixture chat')
  })

  test('page subscribers observe records only after they are already committed to RAM', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-page-order'
    let visibleInsideSubscriber = false
    state.subscribePages(() => {
      visibleInsideSubscriber = Boolean(state.getMessage(conversationId, 'user-page-order'))
    })

    state.ingestPage(page(conversationId, [message('user-page-order', 'user', 5)]))

    expect(visibleInsideSubscriber).toBe(true)
  })

  test('live memory wins over older persisted hydration', async () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-hydrate'
    state.ingestPage(
      page(
        conversationId,
        [
          message('assistant-1', 'assistant', 10, {
            update_time: 20,
            content: { content_type: 'text', parts: ['live'] },
          }),
        ],
        3_000,
      ),
    )
    const persisted = {
      ...state.getMessage(conversationId, 'assistant-1'),
      updateTime: 15,
      raw: message('assistant-1', 'assistant', 10, {
        update_time: 15,
        content: { content_type: 'text', parts: ['persisted-old'] },
      }),
    } as ArchivedMessage

    await state.hydrate(conversationId, {
      listMessages: async () => [persisted],
    })

    expect(state.getMessage(conversationId, 'assistant-1')?.raw.content).toEqual({
      content_type: 'text',
      parts: ['live'],
    })
  })

  test('renderer in-progress state immediately anchors to initial user create_time', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-initial-active'
    state.ingestPage(
      page(conversationId, [
        message('user-active', 'user', 1234.5, {
          metadata: {
            turn_exchange_id: 'turn-active',
            working_turn_id: 'turn-active',
          },
        }),
      ]),
    )

    state.observeRendererState(conversationId, 'in_progress', 'user-active')

    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'in_progress',
      userMessageId: 'user-active',
      startedAt: 1_234_500,
      completedAt: null,
      source: 'renderer',
    })
  })

  test('stop request keeps lifecycle open until API confirmation', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-stop'
    state.ingestRequest({
      conversationId,
      userMessageId: 'user-stop',
      startedAt: 1_000,
      observedAt: 1_010,
      source: 'message_create_time',
    })
    state.ingestStop({
      conversationId,
      phase: 'requested',
      timestamp: 2_000,
      status: null,
    })

    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'stop_requested',
      startedAt: 1_000,
      completedAt: null,
      stopRequestedAt: 2_000,
    })

    state.ingestStop({
      conversationId,
      phase: 'confirmed',
      timestamp: 2_250,
      status: 200,
    })
    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'stopped',
      startedAt: 1_000,
      completedAt: 2_250,
      stopRequestedAt: 2_000,
    })
  })

  test('stream COMPLETE is terminal even when stale renderer still says in-progress', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-stream-complete'
    state.ingestPage(
      page(conversationId, [
        message('user-complete', 'user', 10, {
          metadata: { turn_exchange_id: 'turn-complete', working_turn_id: 'turn-complete' },
        }),
        message('reasoning-tail', 'assistant', 11, {
          channel: null,
          end_turn: false,
          content: { content_type: 'thoughts', thoughts: [] },
          metadata: {
            turn_exchange_id: 'turn-complete',
            working_turn_id: 'turn-complete',
            reasoning_status: 'is_reasoning',
          },
        }),
      ]),
    )
    state.observeRendererState(conversationId, 'in_progress', 'user-complete')
    state.ingestStreamStatus({
      conversationId,
      status: 'COMPLETE',
      observedAt: 12_000,
      httpStatus: 200,
    })

    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'complete',
      userMessageId: 'user-complete',
      startedAt: 10_000,
      completedAt: 12_000,
      source: 'transport',
    })

    state.observeRendererState(conversationId, 'in_progress', 'user-complete')
    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'complete',
      completedAt: 12_000,
      source: 'transport',
    })
  })

  test('older stale renderer cannot replace a newer outbound request', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-new-run-wins'
    state.ingestPage(
      page(conversationId, [message('user-old', 'user', 10), message('user-new', 'user', 20)]),
    )
    state.ingestRequest({
      conversationId,
      userMessageId: 'user-new',
      startedAt: 20_000,
      observedAt: 20_100,
      source: 'message_create_time',
    })

    state.observeRendererState(conversationId, 'in_progress', 'user-old')

    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'in_progress',
      userMessageId: 'user-new',
      startedAt: 20_000,
      source: 'request',
    })
  })

  test('failed stop confirmation returns lifecycle to in-progress', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    state.ingestRequest({
      conversationId: 'chat-failed-stop',
      userMessageId: 'user-stop',
      startedAt: 100,
      observedAt: 110,
      source: 'message_create_time',
    })
    state.ingestStop({
      conversationId: 'chat-failed-stop',
      phase: 'requested',
      timestamp: 200,
      status: null,
    })
    state.ingestStop({
      conversationId: 'chat-failed-stop',
      phase: 'failed',
      timestamp: 250,
      status: 500,
    })

    expect(state.lifecycle('chat-failed-stop')).toMatchObject({
      state: 'in_progress',
      startedAt: 100,
      completedAt: null,
      stopRequestedAt: null,
    })
  })

  test('numeric async status is authoritative and null closes a stale in-progress renderer', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-async-status'
    const messages = [
      message('user-async', 'user', 10, {
        metadata: { turn_exchange_id: 'turn-async', working_turn_id: 'turn-async' },
      }),
      message('thought-async', 'assistant', 11, {
        channel: null,
        recipient: 'all',
        content: { content_type: 'thoughts', thoughts: [{ summary: 'working', finished: true }] },
        metadata: {
          turn_exchange_id: 'turn-async',
          working_turn_id: 'turn-async',
          reasoning_status: 'is_reasoning',
        },
      }),
    ]

    state.ingestPage(page(conversationId, messages, 20_000, { async_status: 3 }))
    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'in_progress',
      userMessageId: 'user-async',
      startedAt: 10_000,
      source: 'initial',
    })

    state.ingestPage(page(conversationId, messages, 30_000, { async_status: null }))
    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'complete',
      userMessageId: 'user-async',
      source: 'initial',
    })

    state.observeRendererState(conversationId, 'in_progress', 'user-async')
    expect(state.lifecycle(conversationId)?.state).toBe('complete')
  })

  test('message stream completion closes an active request without waiting for renderer DOM', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-sse-complete'
    state.ingestRequest({
      conversationId,
      userMessageId: 'user-sse',
      startedAt: 1_000,
      observedAt: 1_010,
      source: 'message_create_time',
    })
    state.ingestStreamEvent({
      conversationId,
      kind: 'complete',
      phase: 'message',
      observedAt: 1_750,
    })

    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'complete',
      userMessageId: 'user-sse',
      completedAt: 1_750,
      source: 'transport',
    })
  })
  test('conversation-too-large stream error becomes a terminal source cause', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-exhausted'
    state.ingestRequest({
      conversationId,
      userMessageId: 'user-exhausted',
      startedAt: 1_000,
      observedAt: 1_010,
      source: 'message_create_time',
    })
    state.ingestStreamEvent({
      conversationId,
      kind: 'error',
      errorCode: 'conversation_too_large',
      errorReason: null,
      canRetry: false,
      observedAt: 1_800,
    })

    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'complete',
      userMessageId: 'user-exhausted',
      completedAt: 1_800,
      terminalCause: 'conversation_too_large',
      source: 'transport',
    })

    state.ingestStreamEvent({
      conversationId,
      kind: 'complete',
      phase: 'main',
      observedAt: 1_900,
    })
    expect(state.lifecycle(conversationId)?.terminalCause).toBe('conversation_too_large')
  })

  test('generic terminal stream error is failed and a new request clears its cause', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'chat-stream-error'
    state.ingestRequest({
      conversationId,
      userMessageId: 'user-error',
      startedAt: 1_000,
      observedAt: 1_010,
      source: 'message_create_time',
    })
    state.ingestStreamEvent({
      conversationId,
      kind: 'error',
      errorCode: 'network_error',
      errorReason: 'network',
      canRetry: true,
      observedAt: 1_500,
    })
    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'failed',
      terminalCause: 'network_error',
      completedAt: 1_500,
    })

    state.ingestStreamEvent({
      conversationId,
      kind: 'complete',
      phase: 'main',
      observedAt: 1_600,
    })
    state.observeRendererState(conversationId, 'complete', 'user-error')
    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'failed',
      terminalCause: 'network_error',
      completedAt: 1_500,
    })

    state.ingestRequest({
      conversationId,
      userMessageId: 'user-next',
      startedAt: 2_000,
      observedAt: 2_010,
      source: 'message_create_time',
    })
    expect(state.lifecycle(conversationId)).toMatchObject({
      state: 'in_progress',
      userMessageId: 'user-next',
      terminalCause: null,
    })
  })
})

describe('Work subagent runtime state', () => {
  test('keeps independent subagent lifecycle in RAM and does not let wait complete a running agent', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    const conversationId = 'work-subagents'

    state.ingestRequest({
      conversationId,
      userMessageId: 'user-work',
      conversationOrigin: 'tpp',
      startedAt: 1_000,
      observedAt: 1_010,
      source: 'message_create_time',
    })

    const activity = (
      id: string,
      threadId: string,
      path: string,
      kind: 'started' | 'completed',
      observedAt: number,
    ) =>
      state.ingestStreamEvent({
        conversationId,
        kind: 'message',
        observedAt,
        record: message(id, 'assistant', observedAt / 1000, {
          recipient:
            kind === 'started'
              ? 'SubAgentActivityThreadItem.started'
              : 'SubAgentActivityThreadItem.completed',
          channel: 'commentary',
          metadata: {
            codex_sub_agent_activity: {
              type: 'subAgentActivity',
              kind,
              agentPath: path,
              agentThreadId: threadId,
              id,
            },
          },
        }),
      })

    activity('multiply-start', 'thread-multiply', '/root/multiply', 'started', 2_000)
    activity('primes-start', 'thread-primes', '/root/primes', 'started', 3_000)
    activity('multiply-done', 'thread-multiply', '/root/multiply', 'completed', 4_000)

    state.ingestStreamEvent({
      conversationId,
      kind: 'message',
      observedAt: 5_000,
      record: message('wait-one', 'assistant', 5, {
        recipient: 'CollabAgentToolCallThreadItem.wait',
        channel: 'commentary',
        metadata: {
          codex_collab_agent_tool_call: {
            type: 'collabAgentToolCall',
            tool: 'wait',
            status: 'completed',
            receiverThreadIds: [],
            agentsStates: {},
          },
        },
      }),
    })

    expect(state.conversationOrigin(conversationId)).toBe('tpp')
    const beforePrimesComplete = new Map(
      state.subagents(conversationId).map((agent) => [agent.threadId, agent]),
    )
    expect(beforePrimesComplete.get('thread-multiply')).toMatchObject({
      displayName: 'Multiply',
      status: 'done',
      activityKind: 'completed',
    })
    expect(beforePrimesComplete.get('thread-primes')).toMatchObject({
      displayName: 'Primes',
      status: 'working',
      activityKind: 'started',
    })

    activity('primes-done', 'thread-primes', '/root/primes', 'completed', 6_000)
    const afterPrimesComplete = new Map(
      state.subagents(conversationId).map((agent) => [agent.threadId, agent]),
    )
    expect(afterPrimesComplete.get('thread-primes')).toMatchObject({
      status: 'done',
      activityKind: 'completed',
    })
    expect(state.listMessages(conversationId)).toHaveLength(5)
  })

  test('catalog origin can classify a sidebar conversation without materializing a RAM conversation', () => {
    const state = new ConversationStateStore(fakeWindow, new ArchiveSourceGate(true))
    state.ingestCatalog({
      observedAt: 2_000,
      items: [
        {
          conversationId: 'catalog-work',
          projectId: null,
          conversationOrigin: 'tpp',
        },
      ],
    })

    expect(state.conversationOrigin('catalog-work')).toBe('tpp')
    expect(state.snapshot('catalog-work')).toBeUndefined()
  })
})
