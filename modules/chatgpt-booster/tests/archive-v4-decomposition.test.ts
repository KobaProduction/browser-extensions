import { expect, test } from 'bun:test'
import { archiveCompositeKey } from '@kobaproduction/browser-archive'
import { comparePoint, identity, key, sourceObject } from '../packages/features/src/archive-v4-identities'
import {
  ARCHIVE_V4_DB_NAME,
  ARCHIVE_V4_DB_VERSION,
  type ArchiveV4Conversation,
} from '../packages/features/src/archive-v4-store'

test('native v4 schema identity stays stable after extracting entities and read-only queries', () => {
  expect(ARCHIVE_V4_DB_NAME).toBe('chatgpt-booster-archive-v4')
  expect(ARCHIVE_V4_DB_VERSION).toBe(2)
  expect(key('a:b', 'c')).toBe(archiveCompositeKey('a:b', 'c'))
  expect(key('a:b', 'c')).not.toBe(key('a', 'b:c'))
  expect(key(key('account', 'conversation'), 'message')).toBe(
    JSON.stringify([JSON.stringify(['account', 'conversation']), 'message']),
  )
  expect(identity('account', 'accountId')).toBe('account')
  expect(() => identity(' account ', 'accountId')).toThrow()
})

test('source validation and chronology remain fail-closed and provider-owned', () => {
  const native = { message: { id: 'm1', raw: true } }
  expect(sourceObject(native)).toBe(native)
  expect(() => sourceObject([])).toThrow('source message')
  expect(() => sourceObject(null)).toThrow('source message')
  expect(comparePoint(100, 'a', 100, 'b')).toBeLessThan(0)
  expect(comparePoint(200, 'a', 100, 'b')).toBeGreaterThan(0)
  // Compile-time contract: consumers still import source v4 types from the
  // original exported module rather than a new public path.
  const example: Pick<ArchiveV4Conversation, 'accountId' | 'conversationId'> = {
    accountId: 'a', conversationId: 'c',
  }
  expect(example.accountId).toBe('a')
})

test('provider read-only adapters preserve account-scoped v4 key and index contracts', async () => {
  const { getConversation, getMessage, getProject, listConversations, listProjects } =
    await import('../packages/features/src/archive-v4-queries')
  const records: Record<string, Array<Record<string, unknown>>> = {
    projects: [{ key: key('a', 'p'), accountId: 'a', projectId: 'p' },
      { key: key('b', 'p'), accountId: 'b', projectId: 'p' }],
    conversations: [{ key: key('a', 'c'), accountId: 'a', conversationId: 'c' },
      { key: key('b', 'c'), accountId: 'b', conversationId: 'c' }],
    messages: [{ key: key(key('a', 'c'), 'm'), accountId: 'a', messageId: 'm' }],
  }
  const request = (result: unknown): IDBRequest<unknown> => {
    const req = { result: undefined, onsuccess: null as (() => void) | null,
      onerror: null, error: null }
    queueMicrotask(() => { req.result = result as undefined; req.onsuccess?.() })
    return req as unknown as IDBRequest<unknown>
  }
  const db = { transaction(name: string) {
    const rows = records[name] ?? []
    return { objectStore() { return {
      get(key: IDBValidKey) { return request(rows.find(row => row.key === key)) },
      index(indexName: string) {
        if (indexName !== 'byAccount') throw Error('Unexpected index')
        return { getAll(account: string) { return request(rows.filter(row => row.accountId === account)) } }
      },
    } } }
  } } as unknown as IDBDatabase
  expect((await listProjects(db, 'a')).map(row => row.projectId)).toEqual(['p'])
  expect((await listConversations(db, 'a')).map(row => row.conversationId)).toEqual(['c'])
  expect((await getProject(db, 'a', 'p'))?.accountId).toBe('a')
  expect((await getConversation(db, 'b', 'c'))?.accountId).toBe('b')
  expect(await getProject(db, 'b', 'missing')).toBeUndefined()
  expect((await getMessage(db, 'a', 'c', 'm'))?.messageId).toBe('m')
  expect(await getMessage(db, 'b', 'c', 'm')).toBeUndefined()
})
