import { expect, test } from 'bun:test'
import { buildArchiveThread } from '@chatgpt-booster/chatgpt'
import { normalizeConversationMessage } from '../packages/features/src/conversation-records'
import { mergeArchiveReaderWindows } from '../packages/ui/src/archive-reader-window'
import type { ArchiveThreadWindow } from '../packages/ui/src/mount'

function window(start: number, end: number): ArchiveThreadWindow {
  const records = Array.from({ length: end - start }, (_, offset) => {
    const index = start + offset
    const record = normalizeConversationMessage(
      {
        id: `m-${index}`,
        create_time: index + 1,
        author: { role: 'user' },
        content: { content_type: 'text', parts: [`Synthetic ${index}`] },
        metadata: { parent_id: index ? `m-${index - 1}` : null },
      },
      'synthetic',
      null,
      1,
    )
    if (!record) throw new Error(`Synthetic message ${index} failed normalization`)
    return record
  })
  return {
    thread: buildArchiveThread(records),
    olderCursor: { messageId: `m-${start}`, sourceCreateTime: start + 1 },
    newerCursor: { messageId: `m-${end - 1}`, sourceCreateTime: end },
    hasOlderStored: start > 0,
    hasNewerStored: end < 400,
    loadedRecordCount: records.length,
    totalKnownRecordCount: 400,
    hasUnsequencedRecords: false,
    source: 'saved',
    accountId: 'synthetic-owner',
    sourceRevision: 8,
    sourceInstanceId: 'canonical-v1',
  }
}
const ids = (value: ArchiveThreadWindow) =>
  value.thread.turns
    .flatMap((turn) => [...turn.messages, ...turn.details])
    .map((item) => item.record.messageId)

test('progressive adjacent windows retain context, bound memory and allow reversal without skipped records', () => {
  const combined = mergeArchiveReaderWindows(window(240, 400), window(80, 240), 'older')
  expect(ids(combined)).toHaveLength(320)
  expect(ids(combined)[0]).toBe('m-80')
  expect(ids(combined).at(-1)).toBe('m-399')
  const first = mergeArchiveReaderWindows(combined, window(0, 80), 'older')
  expect(ids(first)).toHaveLength(320)
  expect(first.olderCursor?.messageId).toBe('m-0')
  expect(first.newerCursor?.messageId).toBe('m-319')
  expect(first.hasOlderStored).toBe(false)
  expect(first.hasNewerStored).toBe(true)
  const latest = mergeArchiveReaderWindows(first, window(320, 400), 'newer')
  expect(ids(latest)).toEqual(ids(combined))
  expect(latest.hasNewerStored).toBe(false)
})
test('overlap is deduplicated and changed revisions or owners cannot be concatenated', () => {
  const latest = window(200, 400),
    overlap = window(100, 260)
  expect(ids(mergeArchiveReaderWindows(latest, overlap, 'older'))).toHaveLength(300)
  expect(() => mergeArchiveReaderWindows(latest, { ...overlap, sourceRevision: 9 }, 'older')).toThrow(
    'sourceChanged',
  )
  expect(() =>
    mergeArchiveReaderWindows(latest, { ...overlap, accountId: 'other-owner' }, 'older'),
  ).toThrow('sourceChanged')
})
