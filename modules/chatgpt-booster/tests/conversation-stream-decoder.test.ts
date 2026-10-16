import { expect, test } from 'bun:test'
import { ConversationStreamDecoder } from '../packages/observer/src/conversation-stream-decoder'
import { syntheticDeltaV1Stream } from './fixtures/stream-delta-v1'

const source = (id: string, text: string) => ({
  conversation_id: 'synthetic-channel-chat',
  message: {
    id,
    author: { role: 'assistant' },
    content: { content_type: 'text', parts: [text] },
    metadata: {},
    status: 'in_progress',
    end_turn: false,
  },
})
const text = (value: ReturnType<ConversationStreamDecoder['decode']>) =>
  ((value?.payload.message as Record<string, unknown>)?.content as { parts: string[] })?.parts[0]

test('native v1 source-shaped stream negotiates encoding, inherits top-level c/p/o and preserves every progressive source', () => {
  const decoder = new ConversationStreamDecoder(),
    messages: Record<string, unknown>[] = []
  for (const packet of syntheticDeltaV1Stream()) {
    if (packet.data === '[DONE]') continue
    const decoded = decoder.decode(packet.data, packet.event)
    if (
      decoded?.payload.message &&
      (decoded.payload.message as Record<string, unknown>).id === 'synthetic-final'
    )
      messages.push(decoded.payload.message as Record<string, unknown>)
  }
  expect(decoder.hasGap()).toBe(false)
  expect(messages.map((message) => (message.content as { parts: string[] }).parts[0])).toEqual([
    'SYNTHETIC',
    'SYNTHETIC_READY',
    'SYNTHETIC_READY',
    'SYNTHETIC_READY',
  ])
  expect(messages.at(-1)).toMatchObject({
    status: 'finished_successfully',
    end_turn: true,
    metadata: {
      can_save: true,
      conversation_followup_suggestions_eligible: true,
      model_dil_v2: {
        constants: { '0': 'SYNTHETIC_READY' },
        fallbackMarkdown: 'SYNTHETIC_READY',
        unknown_native_field: { retained: true },
      },
    },
  })
  expect(messages[0]).toMatchObject({ status: 'in_progress', end_turn: null })
})

test('native channels keep independent baselines while global field inheritance survives unencoded controls', () => {
  const decoder = new ConversationStreamDecoder()
  decoder.decode('v1', 'delta_encoding')
  decoder.decode({ c: 0, v: source('first', 'A') }, 'delta')
  decoder.decode({ c: 1, v: source('second', 'B') }, 'delta')
  decoder.decode({ c: 0, o: 'append', p: '/message/content/parts/0', v: '1' }, 'delta')
  decoder.decode({ type: 'safety_review_update', message: 'Synthetic review', active: true })
  decoder.decode({
    type: 'input_message',
    input_message: {
      id: 'user',
      author: { role: 'user' },
      content: { content_type: 'text', parts: ['Control input'] },
    },
  })
  expect(text(decoder.decode({ c: 1, v: '2' }, 'delta'))).toBe('B2')
  expect(text(decoder.decode({ c: 0, v: '3' }, 'delta'))).toBe('A13')
  // The native decoder fills compact defaults before expanding aliases.
  // Long-name fields cannot replace inherited top-level compact fields.
  expect(text(decoder.decode({ channel: 1, op: 'replace', path: '', v: '4' }, 'delta'))).toBe('A134')
  expect(decoder.hasGap()).toBe(false)
})

test('native patch object/array append, relative nested patches, container creation and truncate match verified operations', () => {
  const decoder = new ConversationStreamDecoder()
  decoder.decode('v1', 'delta_encoding')
  decoder.decode({ v: source('first', 'initial') }, 'delta')
  const result = decoder.decode(
    {
      o: 'patch',
      v: [
        { o: 'append', p: '/message/metadata', v: { list: [1], obj: { old: true, changed: 'old' } } },
        { o: 'append', p: '/message/metadata/list', v: 2 },
        { o: 'append', p: '/message/metadata/list', v: [3, 4] },
        { o: 'append', p: '/message/metadata/obj', v: { changed: 'new', added: true } },
        { o: 'patch', p: '/message/content', v: [{ o: 'truncate', p: '/parts/0', v: 3 }] },
        { o: 'replace', p: '/message/metadata/new_list/0', v: { preserved: true } },
      ],
    },
    'delta',
  )
  if (!result) throw Error('Synthetic native patch failed to decode')
  expect(text(result)).toBe('ini')
  expect((result.payload.message as Record<string, unknown>).metadata).toEqual({
    list: [1, 2, 3, 4],
    obj: { old: true, changed: 'new', added: true },
    new_list: [{ preserved: true }],
  })
  expect(decoder.hasGap()).toBe(false)
})

test('a malformed native patch is atomic, poisons only its source channel and recovers only from a full root', () => {
  const decoder = new ConversationStreamDecoder()
  decoder.decode('v1', 'delta_encoding')
  decoder.decode({ c: 0, v: source('first', 'A') }, 'delta')
  decoder.decode({ c: 1, v: source('second', 'B') }, 'delta')
  const bad = {
    c: 0,
    o: 'patch',
    p: '',
    v: [
      { o: 'append', p: '/message/content/parts/0', v: 'must-not-commit' },
      { o: 'remove', p: '/message/missing', v: null },
    ],
  }
  expect(decoder.decode(bad, 'delta')).toBeNull()
  expect(decoder.hasGap()).toBe(true)
  const retained = decoder.retainedBaseline()
  if (!retained) throw Error('Synthetic native baseline missing')
  expect((retained.message as { content: { parts: string[] } }).content.parts[0]).toBe('A')
  expect(
    text(decoder.decode({ c: 1, o: 'append', p: '/message/content/parts/0', v: '2' }, 'delta')),
  ).toBe('B2')
  expect(decoder.hasGap()).toBe(true)
  expect(decoder.decode({ c: 0, v: 'unsupported-delta-after-gap' }, 'delta')).toBeNull()
  expect(
    text(decoder.decode({ c: 0, o: 'replace', p: '', v: source('first', 'Rebased') }, 'delta')),
  ).toBe('Rebased')
  expect(decoder.hasGap()).toBe(false)
  expect(decoder.takeGapEvidence()[0]).toMatchObject({
    kind: 'source_patch_gap',
    source: { event: 'delta', source: bad },
  })
})

test('native inner patch fields never inherit and unknown encoding or unsafe paths fail closed', () => {
  const decoder = new ConversationStreamDecoder()
  expect(decoder.decode({ v: source('first', 'A') }, 'delta')).toBeNull()
  expect(decoder.hasGap()).toBe(true)
  decoder.decode('v1', 'delta_encoding')
  decoder.decode({ v: source('first', 'A') }, 'delta')
  expect(
    decoder.decode(
      {
        o: 'patch',
        v: [
          { o: 'append', p: '/message/content/parts/0', v: 'valid' },
          { v: 'not-an-inherited-append' },
        ],
      },
      'delta',
    ),
  ).toBeNull()
  decoder.decode({ o: 'replace', p: '', v: source('first', 'A') }, 'delta')
  expect(
    decoder.decode({ o: 'append', p: '/message/metadata/__proto__/unsafe', v: 'rejected' }, 'delta'),
  ).toBeNull()
  expect(({} as Record<string, unknown>).unsafe).toBeUndefined()
  decoder.decode('v2', 'delta_encoding')
  expect(decoder.decode({ o: 'add', p: '', v: source('first', 'A') }, 'delta')).toBeNull()
  expect(decoder.hasGap()).toBe(true)
})
