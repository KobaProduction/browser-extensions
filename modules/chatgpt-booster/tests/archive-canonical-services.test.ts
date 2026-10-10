import { expect, test } from 'bun:test'
import { ArchiveCanonicalReader } from '../packages/features/src/archive-canonical-reader'
import { ArchiveCanonicalAudit } from '../packages/features/src/archive-canonical-audit'
import { ArchiveCanonicalMigrator } from '../packages/features/src/archive-canonical-migrator'
import type { ArchiveV4Store } from '../packages/features/src/archive-v4-store'

function noGeneration() {
  let opened = 0
  const store = {
    canonicalDatabase: async () => { opened++; throw new Error('Unauthorized DB access') },
  } as unknown as ArchiveV4Store
  return { store, opened: () => opened }
}

test('canonical reader never opens an account archive without an activated generation', async () => {
  const fake = noGeneration()
  const reader = new ArchiveCanonicalReader(fake.store, async () => null)
  expect(await reader.listConversations('acct')).toEqual([])
  expect(await reader.readMessages('acct', 'thread')).toEqual([])
  expect(await reader.hasConversation('acct', 'thread')).toBe(false)
  expect(await reader.conversationCounts('acct', 'thread')).toEqual({
    total: 0, visible: 0, internal: 0, firstId: null, lastId: null,
  })
  await expect(reader.preview('acct', 'thread')).rejects.toThrow('not active')
  await expect(reader.threadWindow('acct', 'thread')).rejects.toThrow('not active')
  await expect(reader.exportKnownRecords('acct', 'thread')).rejects.toThrow('not been activated')
  expect(fake.opened()).toBe(0)
})

test('read-only audit requires an activated canonical generation before inspecting sources', async () => {
  const fake = noGeneration()
  const audit = new ArchiveCanonicalAudit(fake.store, async () => null, async () => [])
  await expect(audit.auditCoverage('acct')).rejects.toThrow('not been activated')
  await expect(audit.inspectSkippedAll('acct')).rejects.toThrow('not been activated')
  await expect(audit.inspectSkippedAll('')).rejects.toThrow('Verified account required')
  expect(fake.opened()).toBe(0)
})

test('stable migrator interface delegates read service without initiating source migration', async () => {
  const fake = noGeneration()
  // The facade's migration manifest authority requires an actual DB, but the
  // reader and auditor remain independently testable via injected read ports.
  const migrator = new ArchiveCanonicalMigrator(fake.store)
  expect(typeof migrator.auditCoverage).toBe('function')
  expect(typeof migrator.inspectSkippedRecent).toBe('function')
  expect(typeof migrator.exportKnownRecords).toBe('function')
  expect(typeof migrator.threadWindow).toBe('function')
  expect(fake.opened()).toBe(0)
})

test('canonical reader returns only active generation rows and chronological native IDs', async () => {
  const on = (value: unknown): IDBRequest<unknown> => {
    const request = { result: value, onsuccess: null as (() => void) | null,
      onerror: null, error: null }
    queueMicrotask(() => request.onsuccess?.())
    return request as unknown as IDBRequest<unknown>
  }
  const headers = [
    { conversationId: 'old', generation: 'stale', accountId: 'account' },
    { conversationId: 'active', generation: 'g1', accountId: 'account' },
  ]
  const messages = [
    { messageId: 'z', sourceCreateTime: 5, generation: 'g1' },
    { messageId: 'c', sourceCreateTime: 2, generation: 'g1' },
    { messageId: 'b', sourceCreateTime: 2, generation: 'g1' },
  ]
  const queries: string[] = []
  const store = { canonicalDatabase: async () => ({
    transaction(name: string, mode: string) {
      expect(mode).toBe('readonly')
      if (!['canonicalConversations', 'canonicalMessages'].includes(name))
        throw new Error(`Unexpected store ${name}`)
      return { objectStore(storeName: string) {
        if (storeName !== name) throw new Error('Mismatched store')
        return { index(indexName: string) {
          const expected = name === 'canonicalConversations' ? 'byAccount' : 'byConversation'
          if (indexName !== expected) throw new Error('Unexpected canonical index')
          return { getAll(query: string) {
            queries.push(`${name}:${query}`)
            return on(name === 'canonicalConversations' ? headers : messages)
          } }
        } }
      } }
    },
  }) } as unknown as ArchiveV4Store
  const reader = new ArchiveCanonicalReader(store, async () => 'g1')
  const list = await reader.listConversations('account')
  expect(list.map(row => row.conversationId)).toEqual(['active'])
  const rows = await reader.readMessages('account', 'active')
  expect(rows.map(row => row.messageId)).toEqual(['b', 'c', 'z'])
  expect(queries).toContain('canonicalConversations:account')
  expect(queries).toContain('canonicalMessages:["g1","[\\"account\\",\\"active\\"]"]')
})
