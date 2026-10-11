import { expect, test } from 'bun:test'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedCanonicalDexieRepository } from '../packages/features/src/archive-fixed-dexie'
import { FixedVkDexieRepository } from '../../vk-booster/src/features/chat-export/model/archive-fixed-dexie'

const drivers = { indexedDB, IDBKeyRange }

test('DEV/PROD of both standalones and all-in-one use six independent physical Dexie archives', async () => {
  const targets = [
    { productId: 'chatgpt-booster', channel: 'dev', installationId: 'chatgpt-booster-userscript', ownerId: 'owner-synthetic' },
    { productId: 'chatgpt-booster', channel: 'prod', installationId: 'chatgpt-booster-userscript', ownerId: 'owner-synthetic' },
    { productId: 'chatgpt-booster', channel: 'dev', installationId: 'all-in-one-userscript', ownerId: 'owner-synthetic' },
    { productId: 'chatgpt-booster', channel: 'prod', installationId: 'all-in-one-userscript', ownerId: 'owner-synthetic' },
  ] as const
  const chat = targets.map(scope => new FixedCanonicalDexieRepository(scope, drivers))
  const vkDev = new FixedVkDexieRepository({
    productId: 'vk-booster', channel: 'dev', installationId: 'vk-booster-userscript', ownerId: 'vk-user-23',
  }, drivers)
  const vkProd = new FixedVkDexieRepository({
    productId: 'vk-booster', channel: 'prod', installationId: 'vk-booster-userscript', ownerId: 'vk-user-23',
  }, drivers)
  try {
    expect(new Set([...chat.map(x => x.databaseName), vkDev.databaseName, vkProd.databaseName]).size)
      .toBe(6)
    await chat[0]!.addObservation({
      accountId: 'owner-synthetic', conversationId: 'c-one',
      sourceKind: 'native', sourceVersion: 'observed', observedAtMs: 123,
      raw: { id: 'msg-1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Synthetic'] } },
    })
    await vkDev.addOriginal(100, { id: 1, date: 123, text: 'Synthetic' }, 'vk-current', 123)
    expect(await chat[0]!.countConversation('c-one')).toBe(1)
    expect((await vkDev.listMessages(100)).length).toBe(1)
    for (const other of chat.slice(1)) expect(await other.countConversation('c-one')).toBe(0)
    expect(await vkProd.listMessages(100)).toHaveLength(0)
  } finally {
    for (const db of chat) db.close()
    vkDev.close()
    vkProd.close()
  }
})
