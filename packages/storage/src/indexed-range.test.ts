import { afterAll, beforeAll, expect, test } from 'bun:test'
import { type IndexedRangePage, type IndexedRangePosition, readIndexedRangePage } from './indexed-range'

type NativeRow = { index: number; id: string; raw: unknown }
function fakeDatabase(rows: NativeRow[]): IDBDatabase {
  const ordered = [...rows].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
  return {
    transaction() {
      const tx = new EventTarget()
      let closed = false
      let active = ordered
      let request: {
        result: IDBCursorWithValue | null
        error: DOMException | null
        onsuccess: ((event: Event) => unknown) | null
        onerror: ((event: Event) => unknown) | null
      }
      const deliver = (at: number) =>
        queueMicrotask(() => {
          if (closed) return
          const row = active[at]
          let advanced = false
          request.result = row
            ? ({
                key: row.index,
                primaryKey: row.id,
                value: row.raw,
                continue() {
                  advanced = true
                  deliver(at + 1)
                },
                continuePrimaryKey(nextIndex: IDBValidKey, nextPrimary: IDBValidKey) {
                  advanced = true
                  const next = active.findIndex(
                    (item, i) =>
                      i > at &&
                      (item.index > Number(nextIndex) ||
                        (item.index === Number(nextIndex) && item.id >= String(nextPrimary))),
                  )
                  deliver(next < 0 ? active.length : next)
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
      Object.assign(tx, {
        error: null,
        abort() {
          if (closed) return
          closed = true
          tx.dispatchEvent(new Event('abort'))
        },
        objectStore() {
          return {
            index: () => ({
              openCursor(range: { lower: number; upper: number }) {
                request = { result: null, error: null, onsuccess: null, onerror: null }
                active = ordered.filter((row) => row.index >= range.lower && row.index <= range.upper)
                deliver(0)
                return request
              },
            }),
          }
        },
      })
      return tx as IDBTransaction
    },
  } as unknown as IDBDatabase
}
const compare = (a: IDBValidKey, b: IDBValidKey) =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
let savedRange: unknown
beforeAll(() => {
  savedRange = (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange
  ;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = {
    bound: (lower: number, upper: number) => ({ lower, upper }),
  }
})
afterAll(() => {
  if (savedRange !== undefined) (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = savedRange
  else delete (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange
})
test('range pager resumes through duplicate timestamps without losing any source row', async () => {
  const db = fakeDatabase([
    { index: 2, id: 'a', raw: 1 },
    { index: 2, id: 'b', raw: 2 },
    { index: 2, id: 'c', raw: 3 },
    { index: 2, id: 'd', raw: 4 },
    { index: 3, id: 'a', raw: 5 },
    { index: 4, id: 'b', raw: 6 },
  ])
  const received: number[] = []
  let after: IndexedRangePosition | null = null
  for (let i = 0; i < 5; i++) {
    const page: IndexedRangePage<number> = await readIndexedRangePage<number>({
      db,
      store: 'messages',
      index: 'lastSeenAt',
      range: IDBKeyRange.bound(2, 3),
      pageSize: 2,
      after,
      compareKeys: compare,
      decode: (value) => value as number,
    })
    received.push(...page.records)
    if (page.exhausted || !page.records.length) break
    expect(page.last).not.toBeNull()
    after = page.last
  }
  expect(received).toEqual([1, 2, 3, 4, 5])
  expect(after).toEqual({ indexKey: 2, primaryKey: 'd' })
})
test('range pager rejects a malformed page atomically', async () => {
  const db = fakeDatabase([
    { index: 2, id: 'a', raw: 'valid' },
    { index: 2, id: 'b', raw: 3 },
  ])
  await expect(
    readIndexedRangePage<string>({
      db,
      store: 'messages',
      index: 'lastSeenAt',
      range: IDBKeyRange.bound(2, 3),
      pageSize: 4,
      compareKeys: compare,
      decode(value) {
        if (typeof value !== 'string') throw Error('malformed source')
        return value
      },
    }),
  ).rejects.toThrow('malformed source')
})
test('range pager validates bounds and cancelled reads before opening a transaction', async () => {
  const db = fakeDatabase([])
  expect(() =>
    readIndexedRangePage({
      db,
      store: 'messages',
      index: 'lastSeenAt',
      range: IDBKeyRange.bound(2, 3),
      pageSize: 0,
      decode: (value) => value,
    }),
  ).toThrow('pageSize')
  const controller = new AbortController()
  controller.abort()
  await expect(
    readIndexedRangePage({
      db,
      store: 'messages',
      index: 'lastSeenAt',
      range: IDBKeyRange.bound(2, 3),
      pageSize: 2,
      signal: controller.signal,
      decode: (value) => value,
    }),
  ).rejects.toThrow('cancelled')
})
test('range pager never publishes a partially decoded page after cancellation', async () => {
  const db = fakeDatabase([
    { index: 2, id: 'a', raw: 'first' },
    { index: 2, id: 'b', raw: 'second' },
  ])
  const controller = new AbortController()
  await expect(
    readIndexedRangePage<string>({
      db,
      store: 'messages',
      index: 'lastSeenAt',
      range: IDBKeyRange.bound(2, 3),
      pageSize: 4,
      signal: controller.signal,
      compareKeys: compare,
      decode(value) {
        controller.abort()
        return value as string
      },
    }),
  ).rejects.toThrow('cancelled')
})
