import { expect, test } from 'bun:test'
import { archiveCompositeKey, archiveSha256Hex, indexArchiveRecords, selectArchivePage } from './index'

const entries = [
  { id: 'm5', at: 5 },
  { id: 'm4', at: 4 },
  { id: 'm3', at: 3 },
  { id: 'm2', at: 2 },
]
const base = {
  records: entries,
  keyOf: (r: (typeof entries)[number]) => r.id,
  timestampOf: (r: (typeof entries)[number]) => r.at,
  knownKeys: new Set(['m4']),
  remaining: 3,
}

test('recent counts known records toward exact N but persists only missing identities', () => {
  const result = selectArchivePage({ ...base, mode: 'recent' })
  expect(result).toEqual({
    consumed: 3,
    matched: 3,
    added: [entries[0], entries[2]],
    boundaryReached: false,
  })
  expect(base.knownKeys.has('m5')).toBe(false)
})
test('incremental ends at first known source identity', () => {
  expect(selectArchivePage({ ...base, mode: 'incremental' })).toEqual({
    consumed: 2,
    matched: 1,
    added: [entries[0]],
    boundaryReached: true,
  })
})
test('backfill skips known records and advances source offset by actual consumed', () => {
  expect(selectArchivePage({ ...base, mode: 'backfill', remaining: 2 })).toEqual({
    consumed: 3,
    matched: 2,
    added: [entries[0], entries[2]],
    boundaryReached: false,
  })
})
test('date selection excludes newer records, stops on older bound, does not invent dates', () => {
  expect(
    selectArchivePage({ ...base, mode: 'recent', remaining: 10, fromInclusive: 3, toExclusive: 5 }),
  ).toEqual({
    consumed: 4,
    matched: 2,
    added: [entries[2]],
    boundaryReached: true,
  })
  expect(() =>
    selectArchivePage({ ...base, mode: 'recent', fromInclusive: 3, timestampOf: () => null }),
  ).toThrow('timestamp')
})

test('shared archive preserves provider-native numeric and string identities', () => {
  const rows = [
    { id: 5, text: 'first' },
    { id: 9, text: 'second' },
    { id: 5, text: 'updated' },
  ]
  expect([...indexArchiveRecords(rows, (row) => row.id).values()]).toEqual([
    { id: 5, text: 'updated' },
    { id: 9, text: 'second' },
  ])
  expect(indexArchiveRecords([{ id: 'm:1' }], (row) => row.id).size).toBe(1)
  expect(() => indexArchiveRecords([{ id: Number.NaN }], (row) => row.id)).toThrow()
  expect(() => indexArchiveRecords([{ id: '' }], (row) => row.id)).toThrow()
})

test('archive composite keys do not collide on delimiter-containing identities', () => {
  expect(archiveCompositeKey('one:two', 'three')).not.toBe(archiveCompositeKey('one', 'two:three'))
  expect(archiveCompositeKey('account', 'chat', 'message')).toBe(
    JSON.stringify(['account', 'chat', 'message']),
  )
})

test('shared SHA-256 has identical output for source text and binary media', async () => {
  const text = 'original tool response'
  expect(await archiveSha256Hex(text)).toBe(await archiveSha256Hex(new TextEncoder().encode(text)))
  expect(await archiveSha256Hex(text)).toMatch(/^[0-9a-f]{64}$/)
})

test('streaming GZIP round-trips an archive without creating an uncompressed whole-file Blob', async () => {
  async function* source() {
    for (let i = 0; i < 48; i++)
      yield new TextEncoder().encode(
        JSON.stringify({ row: i, content: 'tool-output'.repeat(2048) }) + '\n',
      )
  }
  const { createGzipFromChunks } = await import('./index')
  const zipped = await createGzipFromChunks(source())
  expect(zipped.size).toBeLessThan(50_000)
  const expanded = await new Response(
    zipped.stream().pipeThrough(new DecompressionStream('gzip')),
  ).text()
  expect(expanded.trim().split('\n')).toHaveLength(48)
  expect(JSON.parse(expanded.trim().split('\n').at(-1) ?? '{}').row).toBe(47)
})

test('streaming GZIP rejects a revoked export before starting', async () => {
  const { createGzipFromChunks } = await import('./index')
  const controller = new AbortController()
  controller.abort()
  async function* source() {
    yield new TextEncoder().encode('secret-test')
  }
  await expect(createGzipFromChunks(source(), controller.signal)).rejects.toThrow()
})
