import { expect, test } from 'bun:test'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { decodeArchiveClone } from '@kobaproduction/browser-archive'
import { exportLegacyNativeV4 } from './archive-legacy092-extract'

async function oldV4(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 2)
    open.onupgradeneeded = () => {
      open.result.createObjectStore('conversations', { keyPath: 'key' })
      open.result.createObjectStore('messages', { keyPath: 'key' })
      open.result.createObjectStore('metadata', { keyPath: 'key' })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}
test('old v4 is backed up intact, without using the v4 archive writer or creating extra databases', async () => {
  Object.assign(globalThis, { indexedDB, IDBKeyRange })
  const name = 'chatgpt-booster-archive-v4'
  const db = await oldV4(name)
  const tx = db.transaction('messages', 'readwrite')
  tx.objectStore('messages').put({
    key: 'synthetic', accountId: 'owner-1',
    native: { embedded: new Uint8Array([5, 4, 3]), futurePart: null },
  })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  const namesBefore = (await indexedDB.databases()).map(x => x.name)
  const backup = await exportLegacyNativeV4(name, indexedDB)
  const raw = await new Response(backup.blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  const rows = raw.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
  expect(rows[0]).toMatchObject({
    kind: 'header', format: 'koba-native-v4-readonly-v1', originalDatabaseVersion: 2,
  })
  expect(decodeArchiveClone(rows.find(x => x.kind === 'record' && x.store === 'messages')?.value))
    .toMatchObject({ key: 'synthetic', accountId: 'owner-1', native: { futurePart: null } })
  expect(rows.at(-1)).toMatchObject({ kind: 'footer', counts: { messages: 1 } })
  expect((await indexedDB.databases()).map(x => x.name)).toEqual(namesBefore)
  const stillOpen = await oldV4(name)
  expect(stillOpen.version).toBe(2)
  stillOpen.close()
})
test('missing v4 refuses export without creating a database', async () => {
  const fresh = new (indexedDB.constructor as new () => IDBFactory)()
  await expect(exportLegacyNativeV4('chatgpt-booster-archive-v4', fresh)).rejects.toThrow('not found')
  expect(await fresh.databases()).toHaveLength(0)
})

test('older physical v4 version 1 is preserved by export without schema upgrades', async () => {
  const fresh = new (indexedDB.constructor as new () => IDBFactory)()
  const name = 'chatgpt-booster-archive-v4'
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fresh.open(name, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('conversations', { keyPath: 'key' })
      request.result.createObjectStore('messages', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  const result = await exportLegacyNativeV4(name, fresh)
  expect(result.databaseVersion).toBe(1)
  const listed = await fresh.databases()
  expect(listed).toEqual([{ name, version: 1 }])
})
