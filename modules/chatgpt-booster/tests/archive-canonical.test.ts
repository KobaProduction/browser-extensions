import { describe, expect, test } from 'bun:test'
import {
  ARCHIVE_CANONICAL_MODEL_VERSION,
  projectNativeMessage,
} from '../packages/core/src/archive-canonical'

describe('Booster canonical content model', () => {
  const scope = { accountId: 'account-a', conversationId: 'chat' }
  test('keeps nested elements ordered and independent of the source shape', () => {
    const raw = {
      id: 'm1',
      author: { role: 'assistant' },
      channel: 'final',
      recipient: 'all',
      metadata: { parent_id: null },
      create_time: 100,
      content: {
        content_type: 'multimodal_text',
        parts: ['first', { asset_pointer: 'opaque' }, 'third'],
      },
    }
    const original = JSON.stringify(raw)
    const result = projectNativeMessage(raw, scope)
    expect(result.modelVersion).toBe(ARCHIVE_CANONICAL_MODEL_VERSION)
    expect(result.parentObserved).toBe(true)
    expect(result.parentMessageId).toBeNull()
    expect(result.elements.map((element) => element.kind)).toEqual([
      'container',
      'text',
      'opaque',
      'text',
    ])
    expect(result.elements.slice(1).map((element) => element.siblingOrder)).toEqual([0, 1, 2])
    expect(
      result.elements
        .slice(1)
        .every((element) => element.parentElementId === result.elements[0]?.elementId),
    ).toBe(true)
    expect(result.renderCoverage).toBe('contains_opaque')
    expect(JSON.stringify(raw)).toBe(original)
    expect(result.elements[2]?.text).toBeNull()
  })

  test('uses account-conversation-message identity and preserves unknown parent', () => {
    const raw = {
      id: 'same',
      author: { role: 'tool' },
      metadata: {},
      content: { content_type: 'execution_output', text: 'result' },
    }
    const first = projectNativeMessage(raw, scope)
    const other = projectNativeMessage(raw, { accountId: 'account-b', conversationId: 'chat' })
    expect(first.messageKey).not.toBe(other.messageKey)
    expect(first.parentObserved).toBe(false)
    expect(first.elements.map((element) => element.kind)).toEqual(['tool_result', 'tool_result'])
    expect(first.elements[1]?.text).toBe('result')
    expect(first.renderCoverage).toBe('typed')
  })

  test('does not manufacture content when a source shape is unsupported', () => {
    const msg = projectNativeMessage(
      { id: 'm2', content: { content_type: 'unknown_type', data: {} } },
      scope,
    )
    expect(msg.elements[1]?.kind).toBe('opaque')
    expect(msg.elements[1]?.sourcePath).toBe('content')
    expect(msg.elements[1]?.text).toBeNull()
    expect(msg.renderCoverage).toBe('contains_opaque')
    expect(() =>
      projectNativeMessage({ id: 'm2' }, { accountId: '', conversationId: 'chat' }),
    ).toThrow('Canonical archive identity missing')
  })
})
