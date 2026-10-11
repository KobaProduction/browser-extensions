import { expect, test } from 'bun:test'
import { readTarEntries, TarStreamWriter } from './tar-stream'

test('TAR writer and reader round trip ordinary files with exact padding', async () => {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const writer = new TarStreamWriter(
    new WritableStream({
      write(bytes) {
        chunks.push(bytes.slice())
      },
    }),
  )
  const one = new TextEncoder().encode('plain JSON rows')
  const big = new Uint8Array(2048).fill(113)
  await writer.add('manifest.json', one)
  await writer.add('indexeddb/messages/00000001.jsonl', big)
  await writer.finish()
  const entries = []
  for await (const item of readTarEntries(new Blob(chunks).stream())) entries.push(item)
  expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'indexeddb/messages/00000001.jsonl'])
  expect(entries[0]?.bytes).toEqual(one)
  expect(entries[1]?.bytes).toEqual(big)
  const corrupt = new Uint8Array(await new Blob(chunks).arrayBuffer())
  corrupt[4] = (corrupt[4] ?? 0) ^ 1
  const source = readTarEntries(new Blob([corrupt]).stream())
  await expect(async () => {
    for await (const item of source) void item
  }).toThrow()
})
