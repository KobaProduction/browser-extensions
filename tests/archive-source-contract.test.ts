import { describe, expect, test } from 'bun:test'
import {
  ArchiveContractError,
  ArchiveSourceGate,
  NATIVE_HISTORY_CONTRACT_VERSION,
} from '../packages/features/src/archive-source-contract'
import { ConversationArchiveStore } from '../packages/features/src/archive-store'
import { ConversationStateStore } from '../packages/features/src/conversation-state'
import type { ConversationArchiveEventDetail } from '../packages/observer/src'

function message(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    author: { role: 'assistant', name: null, metadata: {} },
    create_time: 1_800_000_000,
    update_time: null,
    content: { content_type: 'text', parts: ['source text'] },
    metadata: { parent_id: null, model_slug: 'gpt-6' },
    status: 'finished_successfully',
    channel: 'final',
    recipient: 'all',
    end_turn: true,
    weight: 1,
    ...patch,
  }
}

function page(
  messages: unknown[] = [message('m1')],
  initial = true,
): ConversationArchiveEventDetail {
  return {
    kind: 'conversation-page',
    conversationId: 'conversation',
    sourceUrl: `https://chatgpt.com/backend-api/conversations/conversation${initial ? '' : '/messages?before=next'}`,
    timestamp: 1,
    readId: 'observed-read',
    readStartedAt: 1,
    isInitial: initial,
    requestedBefore: initial ? null : 'next',
    payload: {
      ...(initial ? { conversation_id: 'conversation', title: 'Test' } : {}),
      messages,
      page_info: {
        start_cursor: 'start',
        end_cursor: 'end',
        has_previous_page: !initial,
        has_next_page: false,
      },
    },
  }
}

describe('ChatGPT native page source contract', () => {
  test('accepts known history envelopes and preserves original objects verbatim', () => {
    const first = page()
    const earlier = page([message('m0')], false)
    const raw = JSON.stringify(first.payload)
    const gate = new ArchiveSourceGate()
    gate.inspect(first)
    gate.inspect(earlier)
    expect(JSON.stringify(first.payload)).toBe(raw)
    expect(gate.get('conversation')).toBeUndefined()
    expect(NATIVE_HISTORY_CONTRACT_VERSION).toContain('v1')
  })

  test('rejects missing required native message and page fields', () => {
    const missingMessage = page([message('m1')])
    delete (missingMessage.payload.messages as Record<string, unknown>[])[0]?.status
    const missingPage = page()
    delete (missingPage.payload.page_info as Record<string, unknown>).has_next_page
    const one = new ArchiveSourceGate()
    const two = new ArchiveSourceGate()
    expect(() => one.inspect(missingMessage)).toThrow(ArchiveContractError)
    expect(one.get('conversation')?.path).toBe('payload.messages[0].status')
    expect(() => two.inspect(missingPage)).toThrow(ArchiveContractError)
    expect(two.get('conversation')?.path).toBe('payload.page_info.has_next_page')
  })

  test('rejects changed top-level signatures without accepting later pages', () => {
    const invalid = page()
    invalid.payload.unexpected_new_api_key = true
    const gate = new ArchiveSourceGate()
    expect(() => gate.inspect(invalid)).toThrow(ArchiveContractError)
    expect(gate.get('conversation')?.path).toBe('payload.unexpected_new_api_key')
    expect(gate.get('conversation')?.reason).toBe('unexpected')
    expect(() => gate.inspect(page())).toThrow('archive.error.incompatibleSource')
  })

  test('rejects missing, typed-wrong and unsupported nested message structures', () => {
    const malformed = page([
      message('valid'),
      message('broken', {
        content: { content_type: 'unknown_future_type', parts: [] },
      }),
    ])
    const wrong = page([message('m1', { author: { role: 42, metadata: {} } })])
    const missing = page([{ id: 'm1', content: { content_type: 'text', parts: [] }, metadata: {} }])
    for (const candidate of [malformed, wrong, missing]) {
      const gate = new ArchiveSourceGate()
      expect(() => gate.inspect(candidate)).toThrow(ArchiveContractError)
      expect(gate.get('conversation')).toBeDefined()
    }
  })

  test('rejects incorrect conversation identity and unknown message metadata', () => {
    const mismatch = page()
    mismatch.payload.conversation_id = 'other'
    const unknown = page([message('m1', { metadata: { newly_added_field: true } })])
    const gate1 = new ArchiveSourceGate()
    const gate2 = new ArchiveSourceGate()
    expect(() => gate1.inspect(mismatch)).toThrow(ArchiveContractError)
    expect(gate1.get('conversation')?.reason).toBe('identity')
    expect(() => gate2.inspect(unknown)).toThrow(ArchiveContractError)
    expect(gate2.get('conversation')?.path).toContain('newly_added_field')
  })

  test('validates before changing current-chat memory, even if earlier records look good', () => {
    const gate = new ArchiveSourceGate()
    const state = new ConversationStateStore({} as Window, gate)
    const batch = page([
      message('ok'),
      message('bad', { content: { content_type: 'text', parts: 'wrong' } }),
    ])
    expect(() => state.ingestPage(batch)).toThrow(ArchiveContractError)
    expect(state.snapshot('conversation')).toBeUndefined()
    expect(state.listMessages('conversation')).toEqual([])
    expect(() => state.ingestPage(page())).toThrow(ArchiveContractError)
    expect(gate.get('conversation')?.path).toBe('payload.messages[1].content.parts')
  })

  test('rejects non-ChatGPT source URLs and never silently treats a fixture as native', () => {
    const gate = new ArchiveSourceGate()
    const invalid = page()
    invalid.sourceUrl = 'fixture://history'
    expect(() => gate.inspect(invalid)).toThrow(ArchiveContractError)
    expect(gate.get('conversation')?.path).toBe('sourceUrl')
    const fixture = new ArchiveSourceGate(true)
    fixture.inspect(invalid)
    expect(fixture.get('conversation')).toBeUndefined()
  })

  test('rejects a cross-conversation pagination URL and changed metadata types', () => {
    const pathMismatch = page()
    pathMismatch.sourceUrl = 'https://chatgpt.com/backend-api/conversations/other'
    const invalidNested = page([message('m1', { metadata: { attachments: 'wrong-type' } })])
    const gate1 = new ArchiveSourceGate()
    const gate2 = new ArchiveSourceGate()
    expect(() => gate1.inspect(pathMismatch)).toThrow(ArchiveContractError)
    expect(gate1.get('conversation')?.reason).toBe('identity')
    expect(() => gate2.inspect(invalidNested)).toThrow(ArchiveContractError)
    expect(gate2.get('conversation')?.path).toBe('payload.messages[0].metadata.attachments')
  })

  test('rejects an invalid batch before attempting any IndexedDB operation', async () => {
    const store = new ConversationArchiveStore()
    const invalid = page([message('valid'), 7])
    await expect(store.ingest(invalid)).rejects.toBeInstanceOf(ArchiveContractError)
    expect(store.sourceGate.get('conversation')?.path).toBe('payload.messages[1]')
  })

  test('validates streamed message variants before they can enter live memory', () => {
    const gate = new ArchiveSourceGate()
    const state = new ConversationStateStore({} as Window, gate)
    const valid = message('live-valid')
    state.ingestStreamEvent({
      conversationId: 'conversation',
      kind: 'message',
      record: valid,
      observedAt: 12,
    })
    expect(state.getMessage('conversation', 'live-valid')?.raw).toBe(valid)

    const invalid = message('live-bad', { metadata: { attachments: 'unexpected' } })
    expect(() =>
      state.ingestStreamEvent({
        conversationId: 'conversation',
        kind: 'message',
        record: invalid,
        observedAt: 13,
      }),
    ).toThrow(ArchiveContractError)
    expect(state.getMessage('conversation', 'live-bad')).toBeUndefined()
    expect(gate.get('conversation')?.path).toBe('stream.message.metadata.attachments')
  })

  test('locks only the affected chat and allows another confirmed chat', () => {
    const gate = new ArchiveSourceGate()
    const invalid = page()
    invalid.payload.messages = [42]
    expect(() => gate.inspect(invalid)).toThrow(ArchiveContractError)
    const another = page()
    another.conversationId = 'another'
    another.payload.conversation_id = 'another'
    another.sourceUrl = 'https://chatgpt.com/backend-api/conversations/another'
    gate.inspect(another)
    expect(gate.get('another')).toBeUndefined()
    expect(gate.get('conversation')).toBeDefined()
  })
})
