import { expect, test } from 'bun:test'
import { selectVkArchivePreview } from './archive-preview'
import type { VkMessage } from './types'

const rows: VkMessage[] = Array.from({ length: 3000 }, (_, index) => ({
  id: index + 1,
  date: index + 100,
  from_id: index % 2 ? 100 : 200,
  out: index % 2,
  text: index % 300 === 0 ? 'special message' : 'regular message',
}))

test('VK preview uses a bounded recent window without discarding old file-backed messages', () => {
  const page = selectVkArchivePreview(rows, { limit: 80 })
  expect(page.matching).toBe(3000)
  expect(page.messages).toHaveLength(80)
  expect(page.messages[0]?.id).toBe(2921)
  expect(page.messages.at(-1)?.id).toBe(3000)
  expect(rows).toHaveLength(3000)
})

test('VK search counts all matches but retains at most a bounded UI window', () => {
  const result = selectVkArchivePreview(rows, { limit: 3, query: ' SPECIAL ' })
  expect(result.matching).toBe(10)
  expect(result.messages.map((message) => message.id)).toEqual([2101, 2401, 2701])
  const huge = selectVkArchivePreview(rows, { limit: 100000 })
  expect(huge.messages).toHaveLength(240)
  expect(huge.messages.at(-1)?.id).toBe(3000)
})

test('VK preview handles empty archives and invalid limits without fetching or mutations', () => {
  expect(selectVkArchivePreview([], { limit: 80, query: 'abc' })).toEqual({ messages: [], matching: 0 })
  expect(selectVkArchivePreview(rows, { limit: Number.NaN }).messages).toHaveLength(80)
  expect(selectVkArchivePreview(rows, { limit: -5 }).messages).toHaveLength(1)
})

test('VK Reader pages through all 3000 archived messages without unbounded projections', () => {
  const newest = selectVkArchivePreview(rows, { limit: 80, offset: 0 })
  const older = selectVkArchivePreview(rows, { limit: 80, offset: 80 })
  const oldest = selectVkArchivePreview(rows, { limit: 80, offset: 2960 })
  expect(newest.messages.map((message) => message.id)).toEqual(
    Array.from({ length: 80 }, (_, index) => 2921 + index),
  )
  expect(older.messages[0]?.id).toBe(2841)
  expect(older.messages.at(-1)?.id).toBe(2920)
  expect(oldest.messages.map((message) => message.id)).toEqual(
    Array.from({ length: 40 }, (_, index) => index + 1),
  )
  expect(oldest.matching).toBe(3000)
  expect(selectVkArchivePreview(rows, { limit: 80, offset: 3000 })).toEqual({
    messages: [],
    matching: 3000,
  })
  expect(rows).toHaveLength(3000)
})

test('VK Reader offset applies after text search and invalid offsets fail safely', () => {
  const searched = selectVkArchivePreview(rows, { limit: 3, offset: 3, query: ' SPECIAL ' })
  expect(searched.matching).toBe(10)
  expect(searched.messages.map((message) => message.id)).toEqual([1201, 1501, 1801])
  for (const offset of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    expect(selectVkArchivePreview(rows, { limit: 1, offset }).messages[0]?.id).toBe(3000)
  }
})
