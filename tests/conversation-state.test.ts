import { describe, expect, test } from 'bun:test'
import type { ArchivedMessage } from '../packages/features/src/archive-store'
import { ConversationStateStore } from '../packages/features/src/conversation-state'

const fakeWindow = {} as Window

function page(conversationId: string, messages: Record<string, unknown>[], timestamp = 2_000) {
  return {
    kind: 'conversation-page' as const,
    conversationId,
    timestamp,
    sourceUrl: `https://chatgpt.com/backend-api/conversations/${conversationId}`,
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
  test('initial payload is immediately indexed by message and turn ids', () => {
    const state = new ConversationStateStore(fakeWindow)
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
    const state = new ConversationStateStore(fakeWindow)
    const conversationId = 'chat-page-order'
    let visibleInsideSubscriber = false
    state.subscribePages(() => {
      visibleInsideSubscriber = Boolean(state.getMessage(conversationId, 'user-page-order'))
    })

    state.ingestPage(page(conversationId, [message('user-page-order', 'user', 5)]))

    expect(visibleInsideSubscriber).toBe(true)
  })

  test('live memory wins over older persisted hydration', async () => {
    const state = new ConversationStateStore(fakeWindow)
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
    const state = new ConversationStateStore(fakeWindow)
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
    const state = new ConversationStateStore(fakeWindow)
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

  test('failed stop confirmation returns lifecycle to in-progress', () => {
    const state = new ConversationStateStore(fakeWindow)
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
})
