import { afterAll, beforeAll, expect, test } from 'bun:test'
import { readIndexedPage, scanIndexedPages, scanStorePages } from './indexed-batches'

// Minimal synthetic IDB cursor contract: all records share one non-unique index
// key, which is precisely why the primary key must be the resume cursor.
type IndexedRow = { pk: string; data: number }
function source(records: IndexedRow[]): IDBDatabase {
  return {
    transaction() {
      const tx = new EventTarget()
      let closed = false
      let request: {
        result: IDBCursorWithValue | null
        error: DOMException | null
        onsuccess: ((event: Event) => unknown) | null
        onerror: ((event: Event) => unknown) | null
      }
      const deliver = (index: number) => {
        queueMicrotask(() => {
          if (closed) return
          const row = records[index]
          let advanced = false
          request.result = row
            ? ({
                value: row.data,
                primaryKey: row.pk,
                continue(from?: IDBValidKey) {
                  advanced = true
                  if (from === undefined) deliver(index + 1)
                  else {
                    const next = records.findIndex(
                      (candidate, i) => i > index && candidate.pk >= String(from),
                    )
                    deliver(next < 0 ? records.length : next)
                  }
                },
                continuePrimaryKey(_key: IDBValidKey, from: IDBValidKey) {
                  advanced = true
                  const next = records.findIndex((candidate, i) => i > index && candidate.pk >= from)
                  deliver(next < 0 ? records.length : next)
                },
              } as IDBCursorWithValue)
            : null
          request.onsuccess?.(new Event('success'))
          if (!advanced)
            queueMicrotask(() => {
              if (closed) return
              closed = true
              tx.dispatchEvent(new Event('complete'))
            })
        })
      }
      Object.assign(tx, {
        error: null,
        abort() {
          if (closed) return
          closed = true
          tx.dispatchEvent(new Event('abort'))
        },
        objectStore() {
          const openCursor = () => {
            request = { result: null, error: null, onsuccess: null, onerror: null }
            deliver(0)
            return request
          }
          return { openCursor, index: () => ({ openCursor }) }
        },
      })
      return tx as IDBTransaction
    },
  } as unknown as IDBDatabase
}
const compareKeys = (a: IDBValidKey, b: IDBValidKey) => String(a).localeCompare(String(b))
let savedRange: unknown
beforeAll(() => {
  savedRange = (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange
  ;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = { only: (key: IDBValidKey) => key }
})
afterAll(() => {
  if (savedRange !== undefined) (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = savedRange
  else delete (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange
})
test('bounded indexed pages resume by primary key without duplicates at full-page boundaries', async () => {
  const db = source([
    { pk: 'a', data: 1 },
    { pk: 'b', data: 2 },
    { pk: 'c', data: 3 },
    { pk: 'd', data: 4 },
    { pk: 'e', data: 5 },
  ])
  const batches: number[][] = []
  const result = await scanIndexedPages({
    db,
    store: 'messages',
    index: 'byConversation',
    indexKey: 'one-scope',
    pageSize: 2,
    compareKeys,
    decode: (value) => value as number,
    async accept(page) {
      batches.push([...page.records])
    },
  })
  expect(batches).toEqual([[1, 2], [3, 4], [5]])
  expect(result).toEqual({ lastPrimaryKey: 'e', exhausted: true, paused: false })
})

test('failed acknowledgement does not advance durable cursor and retry resumes correctly', async () => {
  const db = source([
    { pk: 'a', data: 1 },
    { pk: 'b', data: 2 },
    { pk: 'c', data: 3 },
    { pk: 'd', data: 4 },
  ])
  let durableCursor: IDBValidKey | null = null
  let attempts = 0
  const common = {
    db,
    store: 'messages',
    index: 'byConversation',
    indexKey: 'one-scope',
    pageSize: 2,
    compareKeys,
    decode: (value: unknown) => value as number,
  }
  await expect(
    scanIndexedPages({
      ...common,
      async accept(page) {
        if (++attempts === 2) throw Error('disk full')
        durableCursor = page.lastPrimaryKey
      },
    }),
  ).rejects.toThrow('disk full')
  expect(String(durableCursor)).toBe('b')
  const saved: number[] = []
  const resumed = await scanIndexedPages({
    ...common,
    initialPrimaryKey: durableCursor,
    async accept(page) {
      saved.push(...page.records)
      durableCursor = page.lastPrimaryKey
    },
  })
  expect(saved).toEqual([3, 4])
  expect(resumed.lastPrimaryKey).toBe('d')
})

test('malformed source row aborts before acknowledgement and preserves the specific error', async () => {
  const db = source([{ pk: 'a', data: 1 }])
  await expect(
    readIndexedPage({
      db,
      store: 'messages',
      index: 'byConversation',
      indexKey: 'one-scope',
      pageSize: 2,
      compareKeys,
      decode() {
        throw Error('malformed source')
      },
    }),
  ).rejects.toThrow('malformed source')
})

test('unindexed object store uses primary-key continuation without duplicating boundary rows', async () => {
  const db = source([
    { pk: 'aa', data: 1 },
    { pk: 'bb', data: 2 },
    { pk: 'cc', data: 3 },
    { pk: 'dd', data: 4 },
    { pk: 'ee', data: 5 },
  ])
  const results: number[] = []
  const cursors: IDBValidKey[] = []
  const state = await scanStorePages({
    db,
    store: 'conversations',
    pageSize: 2,
    compareKeys,
    decode: (value) => value as number,
    async accept(page) {
      results.push(...page.records)
      if (page.lastPrimaryKey != null) cursors.push(page.lastPrimaryKey)
    },
  })
  expect(results).toEqual([1, 2, 3, 4, 5])
  expect(cursors).toEqual(['bb', 'dd', 'ee'])
  expect(state).toEqual({ lastPrimaryKey: 'ee', exhausted: true, paused: false })
})

test('cannot accidentally combine whole-store and secondary-index pagination inputs', () => {
  const db = source([])
  expect(() =>
    readIndexedPage({
      db,
      store: 'conversations',
      index: 'byAccount',
      pageSize: 3,
      decode: (value) => value,
    }),
  ).toThrow('index and indexKey together')
})
