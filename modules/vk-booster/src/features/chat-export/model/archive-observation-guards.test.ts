import { expect, test } from 'bun:test'
import { decodeArchiveClone, encodeArchiveClone } from '@kobaproduction/browser-archive'
import type { PortableBackupRow } from '@kobaproduction/browser-storage'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedVkDexieRepository } from './archive-fixed-dexie'

test('a final owner/context guard rolls back a revised projection and its source observations together', async () => {
  const repo = new FixedVkDexieRepository(
    {
      productId: 'vk-booster',
      channel: 'dev',
      installationId: `synthetic-${crypto.randomUUID()}`,
      ownerId: 'synthetic-owner',
    },
    { indexedDB, IDBKeyRange },
  )
  const initial = { id: 7, date: 1700000000, peer_id: 42, text: 'synthetic initial' }
  try {
    await repo.observeOriginal(42, initial, 'synthetic', 1)
    await expect(
      repo.observeOriginal(42, { ...initial, text: 'synthetic changed' }, 'synthetic', 2, () => {
        throw Error('VK peer changed')
      }),
    ).rejects.toThrow('peer changed')
    expect((await repo.getOriginal(42, 7))?.raw).toEqual(initial)
    expect((await repo.getOriginal(42, 7))?.previous).toBeUndefined()
    expect((await repo.getMessage(42, 7))?.text).toBe('synthetic initial')
    const rows: PortableBackupRow[] = []
    for await (const row of repo.backupPort().readRows(100)) rows.push(row)
    const forged = await Promise.all(
      rows.map(async (row) => {
        if (row.store !== 'snapshots') return row
        const value = decodeArchiveClone(row.value) as Record<string, unknown>
        value.previous = [
          { sourceVersion: 'synthetic', recordedAtMs: 1, raw: { ...initial, peer_id: 99 } },
        ]
        return { ...row, value: await encodeArchiveClone(value) }
      }),
    )
    await expect(repo.backupPort().restoreAtomically(forged)).rejects.toThrow('revision identity')
    expect((await repo.getOriginal(42, 7))?.raw).toEqual(initial)
  } finally {
    repo.close()
  }
})
