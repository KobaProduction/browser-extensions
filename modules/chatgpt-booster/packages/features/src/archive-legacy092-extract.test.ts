import { expect, test } from 'bun:test'
import { decodeArchiveClone, archiveSha256Hex } from '@kobaproduction/browser-archive'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { exportLegacy092NativeV3, LEGACY_092_V3_DATABASE } from './archive-legacy092-extract'

async function sourceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_092_V3_DATABASE, 3)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('conversations', { keyPath: 'conversationId' })
      db.createObjectStore('messages', { keyPath: 'messageKey' })
      db.createObjectStore('assets')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}
test('stable 0.8.92 native v3 can be extracted read-only with all keys and binary fields', async () => {
  Object.assign(globalThis, { IDBKeyRange })
  const db = await sourceDatabase()
  const bytes = new Uint8Array([9, 3, 1, 5])
  const tx = db.transaction(['conversations', 'messages', 'assets'], 'readwrite')
  tx.objectStore('conversations').put({ conversationId: 'chat-a', title: 'synthetic' })
  tx.objectStore('messages').put({
    messageKey: 'chat-a/m1', conversationId: 'chat-a',
    id: 'm1', extra: { future: 'source-kept' },
  })
  tx.objectStore('assets').put({ binary: bytes.buffer, date: new Date(123) }, 'asset-key')
  await waitTx(tx)
  db.close()

  const result = await exportLegacy092NativeV3(indexedDB)
  expect(result.databaseVersion).toBe(3)
  expect(result.counts).toEqual({ assets: 1, conversations: 1, messages: 1 })
  const text = await new Response(result.blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  const lines = text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
  expect(lines[0]).toMatchObject({ kind: 'header', originalDatabaseVersion: 3 })
  expect(lines[0]?.sourceSchema).toBeTruthy()
  expect(lines[0]?.consistency).toContain('pause_capture')
  const rows = lines.filter(x => x.kind === 'record')
  expect(rows).toHaveLength(3)
  const asset = rows.find(x => x.store === 'assets')
  expect(decodeArchiveClone(asset?.primaryKey)).toBe('asset-key')
  const original = decodeArchiveClone(asset?.value) as { binary: ArrayBuffer; date: Date }
  expect(new Uint8Array(original.binary)).toEqual(bytes)
  expect(original.date.getTime()).toBe(123)
  const message = rows.find(x => x.store === 'messages')
  expect(decodeArchiveClone(message?.value)).toMatchObject({
    messageKey: 'chat-a/m1', extra: { future: 'source-kept' },
  })
  const footer = lines.at(-1)
  expect(footer?.counts).toEqual(result.counts)
  let digest = 'start'
  for (const line of lines.slice(0, -1))
    digest = await archiveSha256Hex(digest + '\n' + JSON.stringify(line))
  expect(footer?.digest).toBe(digest)
  const source = await sourceDatabase()
  expect(source.version).toBe(3)
  expect(source.objectStoreNames.contains('assets')).toBe(true)
  source.close()
})

test('read-only extractor never creates an absent v3 database', async () => {
  // Use an isolated IndexedDB factory with no browser history at all.
  const fresh = new (indexedDB.constructor as new () => IDBFactory)()
  await expect(exportLegacy092NativeV3(fresh)).rejects.toThrow('not found')
  expect(await fresh.databases()).toEqual([])
})
