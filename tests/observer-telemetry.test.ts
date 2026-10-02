import { describe, expect, test } from 'bun:test'
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
