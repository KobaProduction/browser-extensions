import { describe, expect, test } from 'bun:test'
import {
  ArchiveContractError,
  ArchiveSourceGate,
  NATIVE_HISTORY_CONTRACT_V1,
  NATIVE_HISTORY_CONTRACT_V2,
  NATIVE_HISTORY_CONTRACT_V3,
  NATIVE_HISTORY_CONTRACT_V4,
  NATIVE_HISTORY_CONTRACT_V5,
  NATIVE_HISTORY_CONTRACT_V6,
  NATIVE_HISTORY_CONTRACT_V7,
  NATIVE_HISTORY_CONTRACT_V8,
  NATIVE_HISTORY_CONTRACT_V9,
  NATIVE_HISTORY_CONTRACT_V10,
  NATIVE_HISTORY_CONTRACT_V11,
  NATIVE_HISTORY_CONTRACT_VERSION,
  registeredNativeHistoryAdapters,
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

function page(messages: unknown[] = [message('m1')], initial = true): ConversationArchiveEventDetail {
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
  test('v8 retains native user context in page and stream while old adapters reject it', () => {
    const incoming = message('synthetic-context', {
      author: { role: 'user' },
      metadata: { is_user_system_message: true },
      content: {
        content_type: 'user_editable_context',
        user_profile: 'Synthetic profile',
        user_instructions: 'Synthetic instruction',
      },
    })
    const original = structuredClone(incoming)
    new ArchiveSourceGate().inspect(page([incoming]))
    new ArchiveSourceGate().inspectStreamMessage('conversation', incoming)
    expect(incoming).toEqual(original)
    expect(() =>
      new ArchiveSourceGate().inspectStreamMessage('conversation', {
        ...incoming,
        metadata: { is_user_system_message: 'true' },
      }),
    ).toThrow(ArchiveContractError)
    expect(() =>
      new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V7).inspectStreamMessage(
        'conversation',
        incoming,
      ),
    ).toThrow(ArchiveContractError)
    for (const content of [
      { ...incoming.content, user_profile: null },
      { ...incoming.content, user_instructions: 1 },
      { content_type: 'user_editable_context', user_profile: '' },
      { ...incoming.content, unsupported: '' },
    ])
      expect(() =>
        new ArchiveSourceGate().inspectStreamMessage('conversation', { ...incoming, content }),
      ).toThrow(ArchiveContractError)
  })
  test('v7 admits the observed exclusive key string in page and stream, without changing v1-v6', () => {
    const incoming = message('synthetic-exclusive', {
      metadata: { exclusive_key: 'synthetic-exclusive-key', rebase_developer_message: true },
    })
    const raw = JSON.stringify(incoming)
    new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V7).inspect(page([incoming]))
    new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V7).inspectStreamMessage(
      'conversation',
      incoming,
    )
    expect(JSON.stringify(incoming)).toBe(raw)
    for (const version of [
      NATIVE_HISTORY_CONTRACT_V1,
      NATIVE_HISTORY_CONTRACT_V2,
      NATIVE_HISTORY_CONTRACT_V3,
      NATIVE_HISTORY_CONTRACT_V4,
      NATIVE_HISTORY_CONTRACT_V5,
      NATIVE_HISTORY_CONTRACT_V6,
    ]) {
      expect(() => new ArchiveSourceGate(false, version).inspect(page([incoming]))).toThrow(
        ArchiveContractError,
      )
      expect(() =>
        new ArchiveSourceGate(false, version).inspectStreamMessage('conversation', incoming),
      ).toThrow(ArchiveContractError)
    }
  })
  test('v7 rejects unobserved exclusive key types and unrelated fields', () => {
    for (const value of [null, false, 12, [], {}]) {
      expect(() =>
        new ArchiveSourceGate().inspect(
          page([message('invalid', { metadata: { exclusive_key: value } })]),
        ),
      ).toThrow(ArchiveContractError)
      expect(() =>
        new ArchiveSourceGate().inspectStreamMessage(
          'conversation',
          message('invalid', { metadata: { exclusive_key: value } }),
        ),
      ).toThrow(ArchiveContractError)
    }
    expect(() =>
      new ArchiveSourceGate().inspect(
        page([message('unknown', { metadata: { exclusive_key_unknown: 'synthetic' } })]),
      ),
    ).toThrow(ArchiveContractError)
  })
  test('accepts known history envelopes and preserves original objects verbatim', () => {
    const first = page()
    const earlier = page([message('m0')], false)
    const raw = JSON.stringify(first.payload)
    const gate = new ArchiveSourceGate()
    gate.inspect(first)
    gate.inspect(earlier)
    expect(JSON.stringify(first.payload)).toBe(raw)
    expect(gate.get('conversation')).toBeUndefined()
    expect(NATIVE_HISTORY_CONTRACT_VERSION).toBe(NATIVE_HISTORY_CONTRACT_V11)
  })

  test('accepts observed nullable native creation timestamps unchanged', () => {
    const incoming = page([message('undated', { create_time: null })])
    const original = JSON.stringify(incoming.payload)
    new ArchiveSourceGate().inspect(incoming)
    expect(JSON.stringify(incoming.payload)).toBe(original)
    expect((incoming.payload.messages as Record<string, unknown>[])[0]?.create_time).toBeNull()
  })

  test('v2 accepts observed native variants without changing original records', () => {
    const records = [
      message('code', {
        content: {
          content_type: 'code',
          language: 'python',
          response_format_name: null,
          text: 'print(1)',
        },
        metadata: {
          parent_id: null,
          serialization_metadata: { custom_symbol_offsets: [] },
          is_free_thinking_preview_turn: true,
          write_like_me_offer_policy: 'observed-policy',
          tool_invoking_message: 'tool-call',
          tool_invoked_message: 'tool-call',
          tool_hide_expanded_content: false,
          connector_tool_payload: 'opaque',
          invoked_plugin: {},
          invoked_resource: {},
          aggregate_result: {},
          conversation_followup_suggestions_eligible: true,
          reasoning_title: null,
          reasoning_titles: null,
        },
      }),
      message('output', {
        content: { content_type: 'execution_output', text: '1' },
        metadata: { reasoning_title: 'Observed', reasoning_titles: [] },
      }),
    ]
    const incoming = page(records)
    const original = JSON.stringify(incoming.payload)
    const gate = new ArchiveSourceGate()
    gate.inspect(incoming)
    expect(JSON.stringify(incoming.payload)).toBe(original)
    expect(gate.get('conversation')).toBeUndefined()
    expect(gate.version).toBe(NATIVE_HISTORY_CONTRACT_VERSION)

    new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V2).inspect(incoming)
    const old = new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V1)
    expect(() => old.inspect(incoming)).toThrow(ArchiveContractError)
    expect(old.get('conversation')?.version).toBe(NATIVE_HISTORY_CONTRACT_V1)
  })

  test('v3 accepts exactly the observed new native metadata fields and types', () => {
    const metadata = {
      parent_id: null,
      thinking_effort: 'high',
      gizmo_id: 'example-project',
      reasoning_group_id: 'observed-group',
      model_dil_v2: {},
      view_state: {},
      summary_type: 'observed',
      is_merged_message: false,
      source_message_ids: ['source-a'],
      continuation_message_id: 'source-a',
      logical_answer_prefix_activity: {},
      genui_components: [{}],
    }
    const incoming = page([message('observed', { metadata })])
    const raw = JSON.stringify(incoming.payload)
    new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V3).inspect(incoming)
    expect(JSON.stringify(incoming.payload)).toBe(raw)
    const previous = new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V2)
    expect(() => previous.inspect(incoming)).toThrow(ArchiveContractError)
    expect(previous.get('conversation')?.path).toBe('payload.messages[0].metadata.thinking_effort')
    expect(previous.get('conversation')?.reason).toBe('unexpected')
  })

  test('v3 still rejects unknown future keys and changed observed metadata types', () => {
    for (const metadata of [
      { thinking_effort: 42 },
      { gizmo_id: null },
      { source_message_ids: 'not-array' },
      { model_dil_v2: [] },
      { genui_components: null },
      { unexpected_new_native_field: true },
    ]) {
      const gate = new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V3)
      expect(() => gate.inspect(page([message('changed', { metadata })]))).toThrow(ArchiveContractError)
      expect(gate.get('conversation')?.path).toContain('.metadata.')
    }
  })

  test('v4 accepts only confirmed streaming placement types without changing v1-v3 signatures', () => {
    for (const streaming_parent_id of ['synthetic-stream-parent', null]) {
      const record = message('stream-v4', {
        metadata: { streaming_parent_id, streaming_parent_revision: 0, has_versions: true },
      })
      const raw = JSON.stringify(record)
      const gate = new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V4)
      gate.inspect(page([record]))
      gate.inspectStreamMessage('conversation', record)
      expect(JSON.stringify(record)).toBe(raw)
      for (const version of [
        NATIVE_HISTORY_CONTRACT_V1,
        NATIVE_HISTORY_CONTRACT_V2,
        NATIVE_HISTORY_CONTRACT_V3,
      ]) {
        const pageGate = new ArchiveSourceGate(false, version)
        expect(() => pageGate.inspect(page([record]))).toThrow(ArchiveContractError)
        expect(pageGate.get('conversation')).toMatchObject({ version, reason: 'unexpected' })
        const streamGate = new ArchiveSourceGate(false, version)
        expect(() => streamGate.inspectStreamMessage('conversation', record)).toThrow(
          ArchiveContractError,
        )
        expect(streamGate.get('conversation')?.path).toBe('stream.message.metadata.streaming_parent_id')
      }
    }
    const old = new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V3)
    expect(() =>
      old.inspectStreamMessage(
        'conversation',
        message('version-flag', { metadata: { has_versions: true } }),
      ),
    ).toThrow(ArchiveContractError)
    expect(old.get('conversation')?.path).toBe('stream.message.metadata.has_versions')
    expect(registeredNativeHistoryAdapters().map((adapter) => adapter.version)).toEqual([
      NATIVE_HISTORY_CONTRACT_V1,
      NATIVE_HISTORY_CONTRACT_V2,
      NATIVE_HISTORY_CONTRACT_V3,
      NATIVE_HISTORY_CONTRACT_V4,
      NATIVE_HISTORY_CONTRACT_V5,
      NATIVE_HISTORY_CONTRACT_V6,
      NATIVE_HISTORY_CONTRACT_V7,
      NATIVE_HISTORY_CONTRACT_V8,
      NATIVE_HISTORY_CONTRACT_V9,
      NATIVE_HISTORY_CONTRACT_V10,
      NATIVE_HISTORY_CONTRACT_V11,
    ])
  })

  test('v4 rejects empty/incorrect streaming IDs, noninteger/nullable revisions and unknown metadata', () => {
    for (const metadata of [
      { streaming_parent_id: '' },
      { streaming_parent_id: 42 },
      { streaming_parent_id: [] },
      { streaming_parent_revision: null },
      { streaming_parent_revision: -1 },
      { streaming_parent_revision: 0.5 },
      { streaming_parent_revision: Number.NaN },
      { streaming_parent_revision: Number.POSITIVE_INFINITY },
      { streaming_parent_revision: '0' },
      { has_versions: 'true' },
      { unobserved_native_metadata: true },
    ]) {
      const record = message('invalid-v4', { metadata })
      expect(() =>
        new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V4).inspect(page([record])),
      ).toThrow(ArchiveContractError)
      expect(() =>
        new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V4).inspectStreamMessage(
          'conversation',
          record,
        ),
      ).toThrow(ArchiveContractError)
    }
  })

  test('v5 checkpoint acceptance restores the complete page and its original timestamps/tool records', () => {
    const checkpoint = {
      notification_id: 'synthetic-notification',
      source: 'synthetic-origin',
      source_id: null,
      triggered_at: '2026-10-16T00:00:00Z',
    }
    const records = [
      message('synthetic-user', { author: { role: 'user', name: null, metadata: {} } }),
      message('synthetic-assistant', { recipient: 'synthetic_tool', end_turn: false }),
      message('synthetic-tool', {
        author: { role: 'tool', name: 'synthetic_tool', metadata: {} },
        content: { content_type: 'execution_output', text: 'Synthetic output' },
        metadata: { parent_id: 'synthetic-assistant', notification_trigger_checkpoint: checkpoint },
      }),
    ]
    const incoming = page(records)
    const raw = JSON.stringify(incoming)
    const previous = new ConversationStateStore(
      {} as Window,
      new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V4),
    )
    expect(() => previous.ingestPage(incoming)).toThrow(ArchiveContractError)
    expect(previous.listMessages('conversation')).toEqual([])
    expect(previous.sourceGate.get('conversation')?.path).toBe(
      'payload.messages[2].metadata.notification_trigger_checkpoint',
    )
    const current = new ConversationStateStore(
      {} as Window,
      new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V5),
    )
    current.ingestPage(incoming)
    expect(current.listMessages('conversation')).toHaveLength(3)
    expect(current.getMessage('conversation', 'synthetic-tool')?.raw).toBe(records[2])
    expect(current.getMessage('conversation', 'synthetic-tool')?.role).toBe('tool')
    expect(current.getMessage('conversation', 'synthetic-tool')?.createTime).toBe(1_800_000_000)
    expect(JSON.stringify(incoming)).toBe(raw)
    const stream = new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V5)
    stream.inspectStreamMessage('conversation', records[2] as Record<string, unknown>)
    for (const version of [
      NATIVE_HISTORY_CONTRACT_V1,
      NATIVE_HISTORY_CONTRACT_V2,
      NATIVE_HISTORY_CONTRACT_V3,
      NATIVE_HISTORY_CONTRACT_V4,
    ])
      expect(() =>
        new ArchiveSourceGate(false, version).inspectStreamMessage(
          'conversation',
          records[2] as Record<string, unknown>,
        ),
      ).toThrow(ArchiveContractError)
  })

  test('v5 checkpoint requires exactly the observed keys and types, with source_id null only', () => {
    const checkpoint: Record<string, unknown> = {
      notification_id: 'synthetic-notification',
      source: 'synthetic-origin',
      source_id: null,
      triggered_at: 'synthetic-time',
    }
    const invalid: unknown[] = [null, [], 'checkpoint', { ...checkpoint, extra: true }]
    for (const key of Object.keys(checkpoint)) {
      const missing = { ...checkpoint }
      delete missing[key]
      invalid.push(missing, { ...checkpoint, [key]: key === 'source_id' ? 'unobserved-id' : null })
    }
    invalid.push({ ...checkpoint, source_id: {} }, { ...checkpoint, source_id: 0 })
    for (const value of invalid) {
      const record = message('invalid-checkpoint', {
        metadata: { notification_trigger_checkpoint: value },
      })
      expect(() =>
        new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V5).inspect(page([record])),
      ).toThrow(ArchiveContractError)
      expect(() =>
        new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V5).inspectStreamMessage(
          'conversation',
          record,
        ),
      ).toThrow(ArchiveContractError)
    }
    expect(() =>
      new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V5).inspect(
        page([message('unknown-v5', { metadata: { unseen_work_metadata: true } })]),
      ),
    ).toThrow(ArchiveContractError)
  })

  test('v6 retains the observed opaque user signal object without widening legacy metadata', () => {
    const opaque = {
      feedback_form: { version: 1, fields: [{ type: 'synthetic', options: ['synthetic-choice'] }] },
      arbitrary_nested: { retained: true, nullable: null },
    }
    const record = message('synthetic-feedback', { metadata: { user_signal_metadata: opaque } })
    const incoming = page([record])
    const original = JSON.stringify(incoming)
    const gate = new ArchiveSourceGate()
    const state = new ConversationStateStore({} as Window, gate)
    state.ingestPage(incoming)
    gate.inspectStreamMessage('conversation', record)
    expect(state.getMessage('conversation', record.id)?.raw).toBe(record)
    expect((record.metadata as Record<string, unknown>).user_signal_metadata).toBe(opaque)
    expect(JSON.stringify(incoming)).toBe(original)
    for (const version of [
      NATIVE_HISTORY_CONTRACT_V1,
      NATIVE_HISTORY_CONTRACT_V2,
      NATIVE_HISTORY_CONTRACT_V3,
      NATIVE_HISTORY_CONTRACT_V4,
      NATIVE_HISTORY_CONTRACT_V5,
    ]) {
      const legacy = new ArchiveSourceGate(false, version)
      expect(() => legacy.inspect(page([record]))).toThrow(ArchiveContractError)
      expect(legacy.get('conversation')).toMatchObject({
        version,
        reason: 'unexpected',
        path: 'payload.messages[0].metadata.user_signal_metadata',
      })
    }
  })

  test('v6 rejects unobserved user signal outer types and unrelated unknown metadata', () => {
    for (const value of [null, [], 'signal', 0, false]) {
      const record = message('invalid-user-signal', { metadata: { user_signal_metadata: value } })
      expect(() => new ArchiveSourceGate().inspect(page([record]))).toThrow(ArchiveContractError)
      expect(() => new ArchiveSourceGate().inspectStreamMessage('conversation', record)).toThrow(
        ArchiveContractError,
      )
    }
    expect(() =>
      new ArchiveSourceGate().inspect(
        page([message('unknown-v6', { metadata: { unknown_feedback_key: {} } })]),
      ),
    ).toThrow(ArchiveContractError)
  })

  test('v2 rejects unknown nested serialization and incompatible types', () => {
    const candidates = [
      message('nested', {
        metadata: {
          serialization_metadata: { custom_symbol_offsets: [{ start: 0 }] },
        },
      }),
      message('extra', {
        metadata: {
          serialization_metadata: { custom_symbol_offsets: [], new: 1 },
        },
      }),
      message('wrong', { metadata: { reasoning_titles: 'invalid' } }),
      message('wrong-code', {
        content: { content_type: 'code', language: 'python', text: 1 },
      }),
      message('new-key', { metadata: { future_field: true } }),
    ]
    for (const candidate of candidates) {
      const gate = new ArchiveSourceGate()
      const incoming = page([message('accepted'), candidate])
      expect(() => gate.inspect(incoming)).toThrow(ArchiveContractError)
      expect(gate.get('conversation')?.path).toContain('payload.messages[1]')
      expect(() => gate.inspect(page())).toThrow(ArchiveContractError)
    }
  })

  test('v2 stream validation uses the same explicit source registry', () => {
    const gate = new ArchiveSourceGate()
    gate.inspectStreamMessage(
      'c1',
      message('tool', {
        content: { content_type: 'execution_output', text: 'result' },
        metadata: { serialization_metadata: { custom_symbol_offsets: [] } },
      }),
    )
    expect(gate.get('c1')).toBeUndefined()
    expect(() =>
      gate.inspectStreamMessage(
        'c1',
        message('bad-tool', {
          metadata: {
            serialization_metadata: { custom_symbol_offsets: [123] },
          },
        }),
      ),
    ).toThrow(ArchiveContractError)
    expect(gate.get('c1')?.version).toBe(NATIVE_HISTORY_CONTRACT_VERSION)
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

test('v9 retains observed finished_text strings without widening v1-v8 or accepting other types', () => {
  const incoming = message('synthetic-finished', {
    metadata: {
      finished_text: 'Synthetic completion summary',
      initial_text: 'Synthetic initial summary',
      summarization_headline: 'Synthetic headline',
    },
  })
  const original = structuredClone(incoming)
  new ArchiveSourceGate().inspect(page([incoming]))
  new ArchiveSourceGate().inspectStreamMessage('conversation', incoming)
  expect(incoming).toEqual(original)
  expect(() =>
    new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V8).inspect(page([incoming])),
  ).toThrow(ArchiveContractError)
  for (const finished_text of [null, 1, true, [], {}]) {
    expect(() =>
      new ArchiveSourceGate().inspectStreamMessage('conversation', {
        ...incoming,
        metadata: { finished_text },
      }),
    ).toThrow(ArchiveContractError)
    expect(() =>
      new ArchiveSourceGate().inspectStreamMessage('conversation', {
        ...incoming,
        metadata: { initial_text: finished_text },
      }),
    ).toThrow(ArchiveContractError)
    expect(() =>
      new ArchiveSourceGate().inspectStreamMessage('conversation', {
        ...incoming,
        metadata: { summarization_headline: finished_text },
      }),
    ).toThrow(ArchiveContractError)
  }
})

test('v9 validates the observed asynchronous response metadata independently of database schema', () => {
  const metadata = {
    async_source: 'synthetic',
    permissions: [],
    poll_freshness_max_mins: 1,
    poll_interval_ms: 10,
    poll_on_websocket_inactivity_ms: 20,
    poll_suppress_reconnect_banner: true,
    pro_skipped: false,
    targeted_feedback: { synthetic: true },
    preamble_version: 1,
  }
  const incoming = message('synthetic-async', { metadata })
  new ArchiveSourceGate().inspect(page([incoming]))
  new ArchiveSourceGate().inspectStreamMessage('conversation', incoming)
  for (const [key, value] of Object.entries(metadata)) {
    const invalid = typeof value === 'string' ? false : 'wrong-type'
    expect(() =>
      new ArchiveSourceGate().inspectStreamMessage('conversation', {
        ...incoming,
        metadata: { ...metadata, [key]: invalid },
      }),
    ).toThrow(ArchiveContractError)
  }
  expect(() =>
    new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V8).inspect(page([incoming])),
  ).toThrow(ArchiveContractError)
})

test('v10 retains retrieval tool metadata in older pages without widening older adapters', () => {
  const metadata = {
    retrieval_turn_number: 2,
    retrieval_file_index: 0,
    retrieval_visible_content_line_count: 12,
    citation_metadata: { synthetic: true },
    command: 'synthetic command',
    status: 'synthetic status',
  }
  const incoming = message('synthetic-retrieval', {
    author: { role: 'tool', name: 'synthetic-retrieval', metadata: {} },
    metadata,
  })
  const original = structuredClone(incoming)
  new ArchiveSourceGate().inspect(page([incoming], false))
  new ArchiveSourceGate().inspectStreamMessage('conversation', incoming)
  expect(incoming).toEqual(original)
  expect(() =>
    new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V9).inspect(page([incoming], false)),
  ).toThrow(ArchiveContractError)
  for (const key of Object.keys(metadata)) {
    const invalidValues =
      typeof metadata[key as keyof typeof metadata] === 'string'
        ? [null, 1, [], true]
        : [null, 'invalid', [], true]
    for (const invalid of invalidValues) {
      expect(() =>
        new ArchiveSourceGate().inspect(
          page([{ ...incoming, metadata: { ...metadata, [key]: invalid } }], false),
        ),
      ).toThrow(ArchiveContractError)
    }
  }
})

test('v10 validates original tether browser results and preserves their opaque source', () => {
  const content = {
    content_type: 'tether_browsing_display',
    result: 'Synthetic browser result',
    summary: 'Synthetic summary',
    assets: null,
    tether_id: null,
  }
  const incoming = message('synthetic-browser', { content })
  const original = structuredClone(incoming)
  new ArchiveSourceGate().inspect(page([incoming], false))
  new ArchiveSourceGate().inspectStreamMessage('conversation', incoming)
  expect(incoming).toEqual(original)
  expect(() =>
    new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V9).inspect(page([incoming], false)),
  ).toThrow(ArchiveContractError)
  for (const [key, invalid] of Object.entries({
    result: null,
    summary: 1,
    assets: [],
    tether_id: 'unknown',
  })) {
    expect(() =>
      new ArchiveSourceGate().inspect(
        page([{ ...incoming, content: { ...content, [key]: invalid } }], false),
      ),
    ).toThrow(ArchiveContractError)
  }
})

test('v11 retains parallel-generation source metadata without widening v10', () => {
  const incoming = message('synthetic-parallel', {
    metadata: {
      paragen_variant_choice: 'synthetic-choice',
      paragen_variants_info: {
        conversation_id: 'synthetic-conversation',
        type: 'synthetic-type',
        display_treatment: 'synthetic-display',
        paragen_ui_treatment: 'synthetic-ui',
        num_variants_in_stream: 2,
      },
    },
  })
  const original = structuredClone(incoming)
  new ArchiveSourceGate().inspect(page([incoming], false))
  new ArchiveSourceGate().inspectStreamMessage('conversation', incoming)
  expect(incoming).toEqual(original)
  const old = new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V10)
  expect(() => old.inspect(page([incoming], false))).toThrow(ArchiveContractError)
  expect(old.get('conversation')?.path).toBe('payload.messages[0].metadata.paragen_variant_choice')
  for (const invalid of [null, [], 'invalid', 2, false]) {
    const record = { ...incoming, metadata: { paragen_variants_info: invalid } }
    expect(() => new ArchiveSourceGate().inspect(page([record], false))).toThrow(ArchiveContractError)
    expect(() => new ArchiveSourceGate().inspectStreamMessage('conversation', record)).toThrow(
      ArchiveContractError,
    )
  }
  for (const invalid of [null, [], {}, 2, false]) {
    const record = { ...incoming, metadata: { paragen_variant_choice: invalid } }
    expect(() => new ArchiveSourceGate().inspect(page([record], false))).toThrow(ArchiveContractError)
    expect(() => new ArchiveSourceGate().inspectStreamMessage('conversation', record)).toThrow(
      ArchiveContractError,
    )
  }
})
