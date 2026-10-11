import { expect, test } from 'bun:test'
import { exportBackupTar, inspectBackupTar, restoreBackupTar } from '@kobaproduction/browser-storage'
import Dexie from 'dexie'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedVkDexieRepository, fixedVkDatabaseName } from './archive-fixed-dexie'
import type { VkMessage } from './types'

const scope = {
  productId: 'vk-booster',
  channel: 'dev' as const,
  ownerId: 'vk-user-445',
  installationId: 'test-vk-only',
}

async function databaseTest(fn: (repo: FixedVkDexieRepository) => Promise<void>) {
  const previous = { ...Dexie.dependencies }
  Dexie.dependencies.indexedDB = indexedDB
  Dexie.dependencies.IDBKeyRange = IDBKeyRange
  const repo = new FixedVkDexieRepository(scope)
  try {
    await fn(repo)
  } finally {
    repo.close()
    await Dexie.delete(fixedVkDatabaseName(scope))
    Dexie.dependencies.indexedDB = previous.indexedDB
    Dexie.dependencies.IDBKeyRange = previous.IDBKeyRange
  }
}

function row(id: number): VkMessage {
  return {
    id,
    peer_id: 123,
    date: 1788000000 + id,
    from_id: 445,
    text: `snapshot-${id}`,
    attachments: [{ type: 'doc', file: new Uint8Array([1, 2, id]) }],
  }
}

test('VK port round-trip covers both fixed tables and preserves structured-clone source bytes', async () => {
  await databaseTest(async (repo) => {
    await repo.addOriginal(123, row(1), 'vk-current', 1234)
    await repo.addOriginal(123, row(2), 'vk-current', 1235)
    const indexeddbPort = repo.backupPort()
    const ports = { scope, indexeddb: indexeddbPort }
    const blob = await exportBackupTar(ports, {
      settings: false,
      indexeddb: true,
      compression: 'gzip',
    })
    if (!blob) throw Error('Missing archive file')
    expect((await inspectBackupTar(ports, blob)).rows).toBe(4)
    const originals = [
      ...(await indexeddbPort
        .readRows(1)
        [Symbol.asyncIterator]()
        .next()
        .then((x) => (x.value ? [x.value] : []))),
    ]
    expect(originals).toHaveLength(1)
    await repo.addOriginal(123, row(3), 'vk-current', 1236)
    await restoreBackupTar(ports, blob, { settings: false, indexeddb: true })
    const result = await repo.listMessages(123)
    expect(result.map((x) => x.messageId)).toEqual([1, 2])
    const restored = await repo.getOriginal(123, 2)
    expect(restored?.raw.attachments?.[0]?.file).toEqual(new Uint8Array([1, 2, 2]))
  })
})

test('VK adapter validates owner and snapshot projections before destructive transaction', async () => {
  await databaseTest(async (repo) => {
    await repo.addOriginal(123, row(7), 'vk-current', 7)
    const port = repo.backupPort()
    const records = []
    for await (const item of port.readRows(2)) records.push(item)
    const corrupted = records.map((item) => ({ ...item }))
    const first = records[0]
    if (!first) throw Error('Missing test record')
    corrupted[0] = { ...first, key: 'wrong-vk-owner' }
    await expect(port.restoreAtomically(corrupted)).rejects.toThrow()
    expect((await repo.listMessages(123)).map((x) => x.messageId)).toEqual([7])
    // A different owner in the same channel and physical store is not overwritten.
    const other = new FixedVkDexieRepository({ ...scope, ownerId: 'vk-user-991' })
    try {
      await other.addOriginal(123, row(9), 'vk-current', 9)
      await port.restoreAtomically(records)
      expect((await other.listMessages(123)).map((x) => x.messageId)).toEqual([9])
    } finally {
      other.close()
    }
  })
})

test('VK portable export advances through multiple bounded IndexedDB pages', async () => {
  await databaseTest(async (repo) => {
    for (let id = 1; id <= 137; id++) await repo.addOriginal(123, row(id), 'vk-current', id)
    const port = repo.backupPort()
    let seen = 0
    for await (const item of port.readRows(32)) {
      expect(['messages', 'snapshots']).toContain(item.store)
      seen++
    }
    expect(seen).toBe(274)
    const backup = await exportBackupTar(
      { scope, indexeddb: port },
      {
        settings: false,
        indexeddb: true,
        compression: 'gzip',
      },
    )
    if (!backup) throw Error('Missing archive file')
    expect((await inspectBackupTar({ scope, indexeddb: port }, backup)).rows).toBe(274)
  })
})
