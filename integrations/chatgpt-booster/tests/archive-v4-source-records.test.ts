import { expect, test } from 'bun:test'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import { collectArchiveSourceRecords } from '../packages/features/src/archive-v4-source-records'

function detail(messages: unknown[]): ConversationArchiveEventDetail {
  return {
    conversationId: 'chat',
    payload: { messages },
  } as unknown as ConversationArchiveEventDetail
}
function item(id: string, body: string) {
  return {
    id,
    create_time: 5,
    metadata: {},
    author: { role: 'assistant' },
    content: { content_type: 'text', parts: [body] },
  }
}
test('native read deduplicates identical records without silently double counting', () => {
  let decisions = 0
  const raw = item('one', 'original')
  const result = collectArchiveSourceRecords(detail([raw, raw, item('two', 'other')]), () => {
    decisions++
    return true
  })
  expect(result.receivedCount).toBe(3)
  expect(result.uniqueCount).toBe(2)
  expect(result.records.map((row) => row.raw.id)).toEqual(['one', 'two'])
  expect(decisions).toBe(2)
})
test('different raw versions for the same ID in one native read fail closed', () => {
  expect(() =>
    collectArchiveSourceRecords(detail([item('one', 'before'), item('one', 'after')]), () => true),
  ).toThrow('archive.error.sourceChanged')
})
test('invalid native source fields are rejected before any write starts', () => {
  expect(() =>
    collectArchiveSourceRecords(
      detail([
        {
          id: 'one',
          create_time: 'not-a-native-time',
          metadata: {},
        },
      ]),
      () => true,
    ),
  ).toThrow('archive.error.incompatibleSource')
})
