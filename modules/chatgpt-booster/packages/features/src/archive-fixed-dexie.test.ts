import { expect, test } from 'bun:test'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedCanonicalDexieRepository, fixedArchiveDatabaseName } from './archive-fixed-dexie'

const driver = { indexedDB, IDBKeyRange }
const scope = (channel: 'dev' | 'prod', installationId: string, ownerId: string) => ({
  productId: 'chatgpt-booster', channel, installationId, ownerId,
})
const source = (accountId: string, conversationId: string, id: string) => ({
  accountId, conversationId, projectId: 'p1', conversationTitle: 'Saved chat',
  projectTitle: 'Saved project', sourceKind: 'native',
  sourceVersion: 'observed-2026-10', observedAtMs: 1234,
  raw: {
    id,
    author: { role: 'assistant' }, channel: 'final',
    content: { content_type: 'multimodal_text', parts: ['known text', { unknown_future_part: 7 }] },
    private_future_metadata: { opaque: true },
  },
})

test('Dexie canonical v1 is fixed, keeps opaque unknown input and never changes native databases', async () => {
  const db = new FixedCanonicalDexieRepository(scope('dev', 'tm-fixed-1', 'account-a'), driver)
  expect(db.databaseName).toContain('canonical-v1')
  expect(db.databaseName).not.toContain('account-a')
  const input = source('account-a', 'c1', 'm1')
  const key = await db.addObservation(input)
  expect(key).toBe(JSON.stringify(['account-a', 'c1', 'm1']))
  const stored = await db.getMessage('c1', 'm1')
  expect(stored?.projection).toMatchObject({
    modelVersion: 1, accountId: 'account-a', conversationId: 'c1',
    messageId: 'm1', renderCoverage: 'contains_opaque',
  })
  expect(stored?.projection.elements.map(e => e.kind)).toEqual(['container', 'text', 'opaque'])
  const snapshot = await db.getSourceSnapshot('c1', 'm1')
  expect(snapshot?.raw).toEqual(input.raw)
  expect(snapshot?.raw).not.toBe(input.raw)
  expect(await db.counts()).toEqual({ projects: 1, conversations: 1, messages: 1, elements: 3, snapshots: 1 })
  expect(await db.listMessages('c1', 100, 'm1')).toHaveLength(0)
  expect(stored?.projection.sourceCreateTime).toBeNull()
  expect(stored?.projection.parentObserved).toBe(false)
  await expect(db.addObservation(input)).rejects.toThrow('already exists')
  expect(await db.counts()).toMatchObject({ messages: 1, elements: 3, snapshots: 1 })
  db.close()
})

test('fixed archive rejects unknown ownership, conflicted projects and unsupported snapshots atomically', async () => {
  const db = new FixedCanonicalDexieRepository(scope('prod', 'tm-fixed-2', 'account-a'), driver)
  await expect(db.addObservation(source('account-b', 'c1', 'bad'))).rejects.toThrow('identity')
  await db.addObservation(source('account-a', 'c1', 'm1'))
  await expect(db.addObservation({ ...source('account-a', 'c1', 'm2'), projectId: 'p2' }))
    .rejects.toThrow('project changed')
  const unsafe = source('account-a', 'c1', 'm3')
  Object.assign(unsafe.raw, { uncloneable: () => 'private' })
  await expect(db.addObservation(unsafe)).rejects.toThrow()
  expect(await db.counts()).toEqual({ projects: 1, conversations: 1, messages: 1, elements: 3, snapshots: 1 })
  db.close()
})

test('fixed schema separates channels/installations and strictly limits owner reads', async () => {
  const a = new FixedCanonicalDexieRepository(scope('dev', 'tm-fixed-3', 'owner-a'), driver)
  const b = new FixedCanonicalDexieRepository(scope('dev', 'tm-fixed-3', 'owner-b'), driver)
  const c = new FixedCanonicalDexieRepository(scope('prod', 'tm-fixed-3', 'owner-a'), driver)
  const d = new FixedCanonicalDexieRepository(scope('dev', 'chromium-fixed-3', 'owner-a'), driver)
  expect(new Set([a.databaseName, c.databaseName, d.databaseName]).size).toBe(3)
  await a.addObservation(source('owner-a', 'c', 'ma'))
  await b.addObservation(source('owner-b', 'c', 'mb'))
  expect(await a.listMessages('c')).toHaveLength(1)
  expect(await b.listMessages('c')).toHaveLength(1)
  expect(await a.getSourceSnapshot('c', 'mb')).toBeUndefined()
  expect(await a.counts()).toMatchObject({ messages: 1, snapshots: 1, elements: 3 })
  expect(await b.counts()).toMatchObject({ messages: 1, snapshots: 1, elements: 3 })
  expect(await c.counts()).toMatchObject({ messages: 0 })
  expect(await d.counts()).toMatchObject({ messages: 0 })
  expect(() => fixedArchiveDatabaseName({ productId: 'chatgpt-booster', channel: 'prod' }))
    .toThrow('verified')
  expect(() => fixedArchiveDatabaseName({ ...scope('dev', 'tm', 'owner-a'), productId: 'vk-booster' }))
    .toThrow('ChatGPT')
  a.close(); b.close(); c.close(); d.close()
})
