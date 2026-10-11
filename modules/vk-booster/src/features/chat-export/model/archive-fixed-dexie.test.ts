import { expect, test } from 'bun:test'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedVkDexieRepository, fixedVkDatabaseName } from './archive-fixed-dexie'
import type { VkMessage } from './types'

const drivers = { indexedDB, IDBKeyRange }
const scope = (channel: 'dev' | 'prod', installationId: string, ownerId: string) => ({
  productId: 'vk-booster',
  channel,
  installationId,
  ownerId,
})
test('VK Dexie v1 fixes our fields but preserves every original source field', async () => {
  const db = new FixedVkDexieRepository(scope('dev', 'tampermonkey', 'account-a'), drivers)
  const original = {
    id: 7,
    date: 1710000000,
    peer_id: 100,
    from_id: 42,
    out: 1,
    text: 'synthetic VK message',
    attachments: [{ type: 'photo', future: { extra: 'retained' } }],
    unexpected_new_api_field: new Uint8Array([4, 5]),
  }
  await db.addOriginal(100, original, 'vk.api.observed', 10000)
  expect(await db.getMessage(100, 7)).toMatchObject({
    schemaVersion: 1,
    ownerId: 'account-a',
    peerId: 100,
    messageId: 7,
    date: 1710000000,
    senderId: 42,
    outgoing: true,
    attachmentCount: 1,
  })
  expect((await db.getOriginal(100, 7))?.raw).toEqual(original)
  await expect(db.addOriginal(100, original, 'vk.api.observed', 10000)).rejects.toThrow('already saved')
  expect(await db.listMessages(100)).toHaveLength(1)
  expect(await db.listMessages(100, 1, 7)).toHaveLength(0)
  db.close()
})
test('VK fixed database rejects unverified owner, wrong conversation and cross-channel reads', async () => {
  const a = new FixedVkDexieRepository(scope('dev', 'tm-other', 'owner-a'), drivers)
  const b = new FixedVkDexieRepository(scope('prod', 'tm-other', 'owner-a'), drivers)
  const c = new FixedVkDexieRepository(scope('dev', 'tm-other', 'owner-b'), drivers)
  await expect(
    a.addOriginal(2, { id: 2, date: 5, out: 'unknown' } as unknown as VkMessage, 'source', 1),
  ).rejects.toThrow('Unknown VK message direction')
  await expect(a.addOriginal(2, { id: 1, date: 5, peer_id: 3 }, 'source', 1)).rejects.toThrow(
    'Unverified',
  )
  await a.addOriginal(2, { id: 1, date: 5, text: 'test' }, 'source', 1)
  expect(await a.getMessage(2, 1)).toMatchObject({ attachmentCount: null, outgoing: null })
  expect(await b.getMessage(2, 1)).toBeUndefined()
  expect(await c.getMessage(2, 1)).toBeUndefined()
  expect(() => fixedVkDatabaseName({ productId: 'vk-booster', channel: 'prod' })).toThrow('verified')
  a.close()
  b.close()
  c.close()
})
