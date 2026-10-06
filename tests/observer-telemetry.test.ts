import { describe, expect, test } from 'bun:test'
import {
  archiveFileResolverId,
  conversationRequestTimingFromBody,
  parseArchiveAssetResolution,
} from '../packages/observer/src'
import { sanitizeBodyPreview, sanitizeTransportUrl } from '../packages/observer/src/index'
import { buildOtlpLogPayload } from '../packages/telemetry/src/index'

describe('transport sanitization', () => {
  test('redacts secret query values and opaque path identifiers', () => {
    const value = sanitizeTransportUrl(
      'https://chatgpt.com/backend/123456789012345678901234?token=secret&mode=read',
    )

    expect(value).not.toContain('secret')
    expect(value).toContain('token=%5BREDACTED%5D')
    expect(value).toContain(':id')
  })

  test('redacts nested credentials and bearer values from body previews', () => {
    const preview = sanitizeBodyPreview(
      JSON.stringify({
        authorization: 'Bearer should-not-leak',
        nested: { session: 'session-secret', value: 42 },
      }),
      2048,
    )

    expect(preview).toBeDefined()
    expect(preview).not.toContain('should-not-leak')
    expect(preview).not.toContain('session-secret')
    expect(preview).toContain('[REDACTED]')
  })
})

describe('conversation request timing boundary', () => {
  test('uses the user message create_time from ChatGPT conversation payload', () => {
    const detail = conversationRequestTimingFromBody(
      'https://chatgpt.com/backend-api/f/conversation',
      'POST',
      JSON.stringify({
        conversation_id: 'chat-1',
        messages: [
          {
            id: 'user-message-1',
            author: { role: 'user' },
            create_time: 1791315880.927,
            content: { content_type: 'text', parts: ['hello'] },
          },
        ],
      }),
      1791315882000,
    )

    expect(detail).toEqual({
      conversationId: 'chat-1',
      userMessageId: 'user-message-1',
      startedAt: 1791315880927,
      observedAt: 1791315882000,
      source: 'message_create_time',
    })
  })

  test('falls back to the actual outbound transport boundary when create_time is absent', () => {
    const detail = conversationRequestTimingFromBody(
      'https://chatgpt.com/backend-api/conversation',
      'POST',
      JSON.stringify({
        conversation_id: 'chat-2',
        messages: [{ id: 'user-message-2', author: { role: 'user' } }],
      }),
      123456789,
    )

    expect(detail).toMatchObject({
      conversationId: 'chat-2',
      userMessageId: 'user-message-2',
      startedAt: 123456789,
      source: 'transport_request',
    })
  })

  test('ignores unrelated requests', () => {
    expect(
      conversationRequestTimingFromBody(
        'https://chatgpt.com/backend-api/f/conversation/prepare',
        'POST',
        '{}',
        1,
      ),
    ).toBeNull()
  })
})

describe('OTLP resource contract', () => {
  test('uses the Booster service and transport observer scope', () => {
    const payload = JSON.stringify(
      buildOtlpLogPayload(
        {
          scope: 'transport-observer',
          name: 'transport.fetch.request',
          timestamp: 1,
          attributes: {
            'url.full': 'https://example.test/?token=secret',
          },
        },
        '0.3.0',
      ),
    )

    expect(payload).toContain('chatgpt-booster-extension')
    expect(payload).toContain('chatgpt-booster.transport-observer')
    expect(payload).not.toContain('token=secret')
  })
})

test('transport counter helper accumulates request and message events', async () => {
  const { EMPTY_TRANSPORT_COUNTERS, applyTransportCounterEvent } = await import(
    '../packages/core/src/diagnostics'
  )
  let counters = { ...EMPTY_TRANSPORT_COUNTERS }
  counters = applyTransportCounterEvent(counters, {
    direction: 'outbound',
    phase: 'request',
    timestamp: 1,
  })
  counters = applyTransportCounterEvent(counters, {
    direction: 'inbound',
    phase: 'message',
    timestamp: 2,
  })

  expect(counters.requestsSent).toBe(1)
  expect(counters.messagesReceived).toBe(1)
  expect(counters.lastEventAt).toBe(2)
})

test('transport diagnostics batch matches sequential counter semantics', async () => {
  const { createDiagnosticsStore } = await import('../packages/core/src/diagnostics')
  const store = createDiagnosticsStore()
  store.recordTransportBatch([
    { direction: 'outbound', phase: 'request', timestamp: 10 },
    { direction: 'inbound', phase: 'response', timestamp: 11 },
    { direction: 'inbound', phase: 'message', timestamp: 12 },
    { direction: 'inbound', phase: 'error', timestamp: 13, errorClass: 'network' },
  ])

  expect(store.getTransportCounters()).toEqual({
    requestsSent: 1,
    responsesReceived: 1,
    messagesSent: 0,
    messagesReceived: 1,
    errors: 1,
    lastEventAt: 13,
  })
})

test('redacts secret fields embedded inside SSE text', () => {
  const sse =
    'data: {"type":"resume_conversation_token","token":"header.payload.signature","verify":"secret-verify"}\n\n'
  const preview = sanitizeBodyPreview(sse, 2048)

  expect(preview).toBeDefined()
  expect(preview).not.toContain('header.payload.signature')
  expect(preview).not.toContain('secret-verify')
  expect(preview).toContain('[REDACTED]')
})

test('redacts websocket verification query values', () => {
  const value = sanitizeTransportUrl(
    'wss://ws.chatgpt.com/ws/user/123456789012345678901234?verify=sensitive-value',
  )

  expect(value).not.toContain('sensitive-value')
  expect(value).toContain('verify=%5BREDACTED%5D')
})

describe('archive attachment resolver sanitization', () => {
  test('accepts only the observed download route and matching signed estuary content URL', () => {
    const id = 'file_fixture_123'
    expect(
      archiveFileResolverId(
        `https://chatgpt.com/backend-api/files/download/${id}?post_id=&inline=false&download_intent=false`,
      ),
    ).toBe(id)
    expect(
      archiveFileResolverId(`https://example.com/backend-api/files/download/${id}`),
    ).toBeUndefined()
    const resolution = parseArchiveAssetResolution(
      {
        status: 'success',
        download_url: `https://chatgpt.com/backend-api/estuary/content?id=${id}&sig=signed`,
        file_name: 'photo.jpg',
        file_size_bytes: 123,
      },
      id,
    )
    expect(resolution).toMatchObject({ assetId: id, fileName: 'photo.jpg', fileSizeBytes: 123 })
    expect(
      parseArchiveAssetResolution(
        {
          status: 'success',
          download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_other&sig=signed',
        },
        id,
      ),
    ).toBeUndefined()
  })
})
