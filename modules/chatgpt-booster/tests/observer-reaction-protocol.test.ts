import { afterEach, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { ArchiveSourceGate } from '../packages/features/src/archive-source-contract'
import { ConversationStateStore } from '../packages/features/src/conversation-state'
import {
  CONVERSATION_ACCOUNT_EVENT,
  CONVERSATION_REQUEST_EVENT,
  CONVERSATION_STOP_EVENT,
  CONVERSATION_STREAM_EVENT,
  CONVERSATION_STREAM_STATUS_EVENT,
  type ConversationAccountEventDetail,
  type ConversationRequestEventDetail,
  type ConversationStopEventDetail,
  type ConversationStreamEventDetail,
  type ConversationStreamStatusEventDetail,
  installTransportObserver,
} from '../packages/observer/src'
import { syntheticDeltaV1Stream } from './fixtures/stream-delta-v1'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
async function setup(source: string, pathname = '/c/network-chat', status = 200) {
  const dom = new Window({ url: `https://chatgpt.com${pathname}` })
  const previous = { window: globalThis.window, location: globalThis.location }
  Object.assign(globalThis, { window: dom, location: dom.location })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  const state = new ConversationStateStore({} as globalThis.Window, new ArchiveSourceGate(true))
  class Xhr extends EventTarget {
    open() {}
    send() {}
  }
  class Socket extends EventTarget {
    send() {}
  }
  class Events extends EventTarget {}
  const packets: { type: string; detail: unknown }[] = []
  const target = Object.assign(new EventTarget(), {
    location: new URL(dom.location.href),
    XMLHttpRequest: Xhr,
    WebSocket: Socket,
    EventSource: Events,
    fetch: async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/accounts/check'))
        return Response.json({ accounts: { 'owner-A': { account: { account_id: 'owner-A' } } } })
      if (url.includes('/conversations')) return Response.json({ items: [] })
      return new Response(source, {
        status,
        headers: { 'content-type': status >= 400 ? 'application/json' : 'text/event-stream' },
      })
    },
    postMessage(value: { type: string; detail: unknown }) {
      packets.push(value)
      if (value.type === CONVERSATION_ACCOUNT_EVENT)
        state.ingestAccount(value.detail as ConversationAccountEventDetail)
      if (value.type === CONVERSATION_REQUEST_EVENT)
        state.ingestRequest(value.detail as ConversationRequestEventDetail)
      if (value.type === CONVERSATION_STREAM_EVENT)
        state.ingestStreamEvent(value.detail as ConversationStreamEventDetail)
      if (value.type === CONVERSATION_STREAM_STATUS_EVENT)
        state.ingestStreamStatus(value.detail as ConversationStreamStatusEventDetail)
      if (value.type === CONVERSATION_STOP_EVENT)
        state.ingestStop(value.detail as ConversationStopEventDetail)
    },
  }) as unknown as globalThis.Window & typeof globalThis
  const dispose = installTransportObserver(target)
  cleanup.push(dispose)
  await target.fetch('https://chatgpt.com/backend-api/accounts/check')
  await tick()
  expect(state.verifiedAccountId()).toBe('owner-A')
  return { target, state, packets }
}

test('native handoff acknowledges new chat identity without treating HTTP DONE as assistant completion', async () => {
  const source = `data: ${JSON.stringify({ type: 'stream_handoff', conversation_id: 'new-network-chat', options: { token: 'synthetic-secret' } })}\n\ndata: [DONE]\n\n`
  const { target, state, packets } = await setup(source, '/')
  await target.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({
      action: 'next',
      turn_attribution: { turn_trigger: 'composer' },
      parent_message_id: 'synthetic-parent',
      messages: [
        {
          id: 'synthetic-first',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Synthetic'] },
        },
      ],
    }),
  })
  await tick()
  const events = packets.filter((packet) => packet.type === CONVERSATION_STREAM_EVENT)
  expect(events.map((packet) => (packet.detail as ConversationStreamEventDetail).kind)).toEqual([
    'handoff',
  ])
  expect(JSON.stringify(events)).not.toContain('synthetic-secret')
  expect(state.header('new-network-chat')?.startEvidence?.firstMessageId).toBe('synthetic-first')
  expect(state.lifecycle('new-network-chat').state).toBe('in_progress')
})

test('actual fetch/SSE observation correlates approval, segment completion and DONE without renderer evidence', async () => {
  const source = `${[
    {
      conversation_id: 'network-chat',
      type: 'safety_review_update',
      active: true,
      protection_type: 'cyber',
      message: 'synthetic approval review',
    },
    { type: 'message_stream_complete' },
  ]
    .map((packet) => `data: ${JSON.stringify(packet)}\n\n`)
    .join('')}data: [DONE]\n\n`
  const { target, state, packets } = await setup(source)
  const response = await target.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: 'network-chat',
      messages: [{ id: 'synthetic-user', author: { role: 'user' } }],
    }),
  })
  expect(await response.text()).toBe(source)
  await tick()
  expect(state.lifecycle('network-chat')).toMatchObject({
    state: 'complete',
    source: 'transport',
    transportHealth: 'healthy',
  })
  expect(state.safetyReview('network-chat')).toMatchObject({
    active: true,
    message: 'synthetic approval review',
  })
  const request = packets.find((packet) => packet.type === CONVERSATION_REQUEST_EVENT)
    ?.detail as ConversationRequestEventDetail
  const stream = packets
    .filter((packet) => packet.type === CONVERSATION_STREAM_EVENT)
    .map((packet) => packet.detail as ConversationStreamEventDetail)
  expect(request.requestId).toBeTruthy()
  expect(
    stream.every((packet) => packet.requestId === request.requestId && packet.accountId === 'owner-A'),
  ).toBe(true)
  expect(stream.map((packet) => packet.kind)).toEqual(['safety-review', 'complete', 'complete'])
})

test.each(['"v1"', 'v1'])(
  'native fetch/SSE header %s preserves inherited message prefixes and completes healthy after controls and DONE',
  async (encoding) => {
    const source = syntheticDeltaV1Stream()
      .map(
        ({ event, data }) =>
          `${event ? `event: ${event}\n` : ''}data: ${event === 'delta_encoding' ? encoding : typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
      )
      .join('')
    const { target, state, packets } = await setup(source)
    const response = await target.fetch('https://chatgpt.com/backend-api/f/conversation', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: 'network-chat',
        messages: [{ id: 'synthetic-user', author: { role: 'user' } }],
      }),
    })
    expect(await response.text()).toBe(source)
    await tick()
    expect(state.lifecycle('network-chat')).toMatchObject({
      state: 'complete',
      source: 'transport',
      transportHealth: 'healthy',
    })
    const events = packets
      .filter((packet) => packet.type === CONVERSATION_STREAM_EVENT)
      .map((packet) => packet.detail as ConversationStreamEventDetail)
    expect(events.filter((event) => event.kind === 'error')).toEqual([])
    const messages = events.filter(
      (event) => event.kind === 'message' && event.record.id === 'synthetic-final',
    )
    expect(
      messages.map((event) =>
        event.kind === 'message' ? (event.record.content as { parts: string[] }).parts[0] : null,
      ),
    ).toEqual(['SYNTHETIC', 'SYNTHETIC_READY', 'SYNTHETIC_READY', 'SYNTHETIC_READY'])
    expect(messages.at(-1)).toMatchObject({
      record: {
        end_turn: true,
        status: 'finished_successfully',
        metadata: { can_save: true, conversation_followup_suggestions_eligible: true },
      },
    })
  },
)

test('unknown JSON-encoded native SSE encoding fails closed through final DONE', async () => {
  const source = 'event: delta_encoding\ndata: "v2"\n\ndata: [DONE]\n\n'
  const { target, state, packets } = await setup(source)
  const response = await target.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: 'network-chat',
      messages: [{ id: 'synthetic-user', author: { role: 'user' } }],
    }),
  })
  await response.text()
  await tick()
  const events = packets
    .filter((packet) => packet.type === CONVERSATION_STREAM_EVENT)
    .map((packet) => packet.detail as ConversationStreamEventDetail)
  expect(events.some((event) => event.kind === 'error' && event.errorCode === 'source_patch_gap')).toBe(
    true,
  )
  expect(events.some((event) => event.kind === 'complete')).toBe(false)
  expect(state.lifecycle('network-chat')?.state).not.toBe('complete')
})

test('actual clean fetch EOF without terminal protocol evidence marks interrupted health and leaves the request active', async () => {
  const source = `data: ${JSON.stringify({ type: 'message_stream_complete' })}\n\n`
  const { target, state } = await setup(source)
  const response = await target.fetch('https://chatgpt.com/backend-api/conversation', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: 'network-chat',
      messages: [{ id: 'synthetic-user', author: { role: 'user' } }],
    }),
  })
  await response.text()
  await tick()
  expect(state.lifecycle('network-chat')).toMatchObject({
    state: 'in_progress',
    transportHealth: 'interrupted',
    completedAt: null,
  })
})

test('new-conversation fetch waits for explicit response identity instead of assigning the visible route', async () => {
  const source = `data: ${JSON.stringify({ conversation_id: 'new-network-chat', type: 'safety_review_update', active: false, message: null })}\n\ndata: [DONE]\n\n`
  const { target, state } = await setup(source, '/c/unrelated-visible-chat')
  const response = await target.fetch('https://chatgpt.com/backend-api/conversation', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ id: 'new-user', author: { role: 'user' } }] }),
  })
  await response.text()
  await tick()
  expect(state.lifecycle('new-network-chat')?.state).toBe('complete')
  expect(state.lifecycle('unrelated-visible-chat')).toBeUndefined()
})

test('socket final messages inherit only the exact native request identity from SSE', async () => {
  const source = `data: ${JSON.stringify({
    conversation_id: 'network-chat',
    message: {
      id: 'socket-user',
      author: { role: 'user' },
      content: { content_type: 'text', parts: ['Synthetic'] },
      metadata: { request_id: 'native-run-A' },
    },
  })}\n\ndata: ${JSON.stringify({ type: 'stream_handoff', conversation_id: 'network-chat' })}\n\ndata: [DONE]\n\n`
  const { target, state } = await setup(source)
  await target.fetch('https://chatgpt.com/backend-api/conversations', {
    headers: { 'chatgpt-account-id': 'owner-A' },
  })
  await tick()
  await target.fetch('https://chatgpt.com/backend-api/conversation', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: 'network-chat',
      messages: [{ id: 'socket-user', author: { role: 'user' } }],
    }),
  })
  await tick()
  const socket = new target.WebSocket('wss://chatgpt.com/synthetic-stream')
  const final = (requestId: string) =>
    new MessageEvent('message', {
      data: JSON.stringify({
        conversation_id: 'network-chat',
        message: {
          id: `final-${requestId}`,
          recipient: 'all',
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['Synthetic'] },
          metadata: { request_id: requestId, parent_id: 'socket-user' },
          status: 'finished_successfully',
          end_turn: true,
        },
      }),
    })
  socket.dispatchEvent(final('different-run'))
  expect(state.lifecycle('network-chat').state).toBe('in_progress')
  socket.dispatchEvent(final('native-run-A'))
  expect(state.lifecycle('network-chat').state).toBe('complete')
})

test('uncorrelated WebSocket terminal packets and socket close cannot complete a fetch run', async () => {
  const { target, state } = await setup('')
  await target.fetch('https://chatgpt.com/backend-api/conversations', {
    headers: { 'chatgpt-account-id': 'owner-A' },
  })
  await tick()
  const response = await target.fetch('https://chatgpt.com/backend-api/conversation', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: 'network-chat',
      messages: [{ id: 'socket-user', author: { role: 'user' } }],
    }),
  })
  await response.text()
  await tick()
  const socket = new target.WebSocket('wss://chatgpt.com/synthetic-stream')
  socket.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({ conversation_id: 'network-chat', type: 'main_stream_complete' }),
    }),
  )
  socket.dispatchEvent(new Event('close'))
  expect(state.lifecycle('network-chat')).toMatchObject({
    state: 'in_progress',
    transportHealth: 'interrupted',
  })
})

test('native HTTP 413 detail.code ends the exact submit as context-exhausted instead of ordinary rejection', async () => {
  const { target, state, packets } = await setup(
    JSON.stringify({
      detail: {
        code: 'conversation_length_exceeds_limit',
        message: 'Synthetic context-limit message',
      },
    }),
    '/c/network-chat',
    413,
  )
  await target.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({
      action: 'next',
      conversation_id: 'network-chat',
      turn_attribution: { turn_trigger: 'composer' },
      parent_message_id: 'synthetic-parent',
      messages: [
        {
          id: 'synthetic-exhausted-submit',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Synthetic report request'] },
        },
      ],
    }),
  })
  await tick()
  const error = packets
    .filter((p) => p.type === CONVERSATION_STREAM_EVENT)
    .map((p) => p.detail as ConversationStreamEventDetail)
    .find((d) => d.kind === 'error')
  expect(error).toMatchObject({
    kind: 'error',
    errorCode: 'conversation_too_large',
    canRetry: false,
    userMessageId: 'synthetic-exhausted-submit',
  })
  expect(state.lifecycle('network-chat')).toMatchObject({
    state: 'complete',
    terminalCause: 'conversation_too_large',
    userMessageId: 'synthetic-exhausted-submit',
  })
})
