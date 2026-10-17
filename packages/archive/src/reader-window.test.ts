import { expect, test } from 'bun:test'
import { ARCHIVE_READER_MAX_RECORDS, mergeArchiveReaderRecords } from './reader-window'

const rows = (start: number, end: number) =>
  Array.from({ length: end - start }, (_, index) => ({ id: (start + index) * 7 + 1, text: 'synthetic' }))
const options = {
  key: (row: { id: number }) => row.id,
  compare: (a: { id: number }, b: { id: number }) => a.id - b.id,
}

test('adjacent sparse source identities deduplicate, bound memory and remain reversible', () => {
  const middle = mergeArchiveReaderRecords(rows(0, 160), rows(160, 320), 'newer', options)
  expect(middle.records).toHaveLength(ARCHIVE_READER_MAX_RECORDS)
  const end = mergeArchiveReaderRecords(middle.records, rows(300, 480), 'newer', options)
  expect(end.trimmed).toBe(true)
  expect(end.records).toEqual(rows(160, 480))
  const reversed = mergeArchiveReaderRecords(end.records, rows(0, 160), 'older', options)
  expect(reversed.records).toEqual(middle.records)
})
test('incoming observations replace overlap without changing source arrays', () => {
  const current = rows(0, 2)
  const result = mergeArchiveReaderRecords(current, [{ id: 8, text: 'enriched' }], 'older', options)
  expect(result.records[1]?.text).toBe('enriched')
  expect(current[1]?.text).toBe('synthetic')
  expect(() => mergeArchiveReaderRecords(current, [], 'older', { ...options, maximum: 0 })).toThrow()
})
