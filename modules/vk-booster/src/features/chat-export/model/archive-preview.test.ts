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
