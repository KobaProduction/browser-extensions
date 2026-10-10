import { expect, test } from 'bun:test'
import { archiveCompositeKey, archiveSha256Hex, indexArchiveRecords } from './index'

test('shared archive preserves provider-native numeric and string identities', () => {
  const rows = [{ id: 5, text: 'first' }, { id: 9, text: 'second' }, { id: 5, text: 'updated' }]
  expect([...indexArchiveRecords(rows, (row) => row.id).values()]).toEqual([
    { id: 5, text: 'updated' }, { id: 9, text: 'second' },
  ])
  expect(indexArchiveRecords([{ id: 'm:1' }], row => row.id).size).toBe(1)
  expect(() => indexArchiveRecords([{ id: Number.NaN }], row => row.id)).toThrow()
  expect(() => indexArchiveRecords([{ id: '' }], row => row.id)).toThrow()
})

test('archive composite keys do not collide on delimiter-containing identities', () => {
  expect(archiveCompositeKey('one:two', 'three')).not.toBe(archiveCompositeKey('one', 'two:three'))
  expect(archiveCompositeKey('account', 'chat', 'message')).toBe(JSON.stringify(['account', 'chat', 'message']))
})

test('shared SHA-256 has identical output for source text and binary media', async () => {
  const text = 'original tool response'
  expect(await archiveSha256Hex(text)).toBe(await archiveSha256Hex(new TextEncoder().encode(text)))
  expect(await archiveSha256Hex(text)).toMatch(/^[0-9a-f]{64}$/)
})
