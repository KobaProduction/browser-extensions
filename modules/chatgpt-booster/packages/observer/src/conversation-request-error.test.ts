import { expect, test } from 'bun:test'
import { conversationRequestErrorCode } from './conversation-request-error'

test('native nested HTTP 413 context limit maps to the existing terminal signal without rewriting source', () => {
  const payload = {
    detail: {
      code: 'conversation_length_exceeds_limit',
      message: 'Synthetic native context-limit message',
    },
  }
  const original = structuredClone(payload)
  expect(conversationRequestErrorCode(payload, 413)).toBe('conversation_too_large')
  expect(payload).toEqual(original)
  expect(conversationRequestErrorCode(payload, 400)).toBe('request_rejected')
})

test('generic payload limits, translated text and changed shapes cannot emit the exhausted alert', () => {
  for (const payload of [
    null,
    { detail: 'The conversation is too long, please start a new one.' },
    { detail: { code: 'payload_too_large', message: 'Synthetic' } },
    { detail: { code: 'conversation_length_exceeds_limit', message: null } },
    { detail: [{ code: 'conversation_length_exceeds_limit', message: 'Synthetic' }] },
  ])
    expect(conversationRequestErrorCode(payload, 413)).toBe('request_rejected')
})

test('existing terminal/resume codes and network fallback retain their meaning', () => {
  expect(conversationRequestErrorCode({ error_code: 'conversation_too_large' }, 400)).toBe(
    'conversation_too_large',
  )
  expect(conversationRequestErrorCode({ error: { code: 'tokenless_resume_unavailable' } }, 404)).toBe(
    'tokenless_resume_unavailable',
  )
  expect(conversationRequestErrorCode({ code: 'persisted_final_available' }, 409)).toBe(
    'persisted_final_available',
  )
  expect(conversationRequestErrorCode(null, 0, 'network_error')).toBe('network_error')
})
