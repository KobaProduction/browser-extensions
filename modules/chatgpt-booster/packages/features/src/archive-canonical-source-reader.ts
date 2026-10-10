import {
  type IndexedPage, readIndexedPage, readIndexedRangePage,
  type IndexedRangePage, type IndexedRangePosition,
} from '@kobaproduction/browser-storage'

/** Native ChatGPT source readers, independent from canonical write/generation
 * orchestration. Physical DB names, account and consent rules remain owned by
 * the calling migrator. No source record is mutated by a read. */
export type Row = Record<string, unknown>
export const object = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null
/** Bounded source-index enumeration delegates cursor resumption, primary-key
 * ties and transaction completion to the provider-neutral platform storage service.
 * This provider still owns native record validation and the source index key. */
export async function* scan(
  db: IDBDatabase,
  table: string,
  index: string,
  query: IDBValidKey,
  batchLimit = 128,
): AsyncGenerator<Row> {
  let after: IDBValidKey | null = null
  while (true) {
    const page: IndexedPage<Row> = await readIndexedPage<Row>({
      db, store: table, index, indexKey: query, afterPrimaryKey: after,
      pageSize: batchLimit,
      decode(value) {
        const row = object(value)
        if (!row) throw new Error('Legacy source row malformed')
        return row
      },
    })
    for (const row of page.records) yield row
    if (page.exhausted || !page.records.length) return
    if (page.lastPrimaryKey === null) throw new Error('Legacy source scan did not advance')
    after = page.lastPrimaryKey
  }
}

/** A single IndexedDB transaction per bounded page, not per original message. */
export async function* scanBatches(
  db: IDBDatabase,
  table: string,
  index: string,
  query: IDBValidKey,
): AsyncGenerator<Row[]> {
  let batch: Row[] = []
  for await (const row of scan(db, table, index, query)) {
    batch.push(row)
    if (batch.length === 128) {
      yield batch
      batch = []
    }
  }
  if (batch.length) yield batch
}

/** Timestamp-range migration uses the shared dual-key cursor position.
 * Equal lastSeenAt values can never be skipped across batch boundaries. */
export async function* scanRecent(
  db: IDBDatabase,
  table: string,
  index: string,
  since: number,
  until: number,
): AsyncGenerator<Row[]> {
  const range = IDBKeyRange.bound(since, until)
  let after: IndexedRangePosition | null = null
  while (true) {
    const page: IndexedRangePage<Row> = await readIndexedRangePage<Row>({
      db, store: table, index, range, after, pageSize: 128,
      decode(value) {
        const row = object(value)
        if (!row) throw new Error('Recent-source row malformed')
        return row
      },
    })
    if (!page.records.length) return
    yield [...page.records]
    if (page.exhausted) return
    if (!page.last) throw new Error('Recent-source scan did not advance')
    after = page.last
  }
}

export async function existingSource(name: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB.databases !== 'function') throw new Error('IndexedDB inspection unavailable')
  const known = await indexedDB.databases()
  if (!known.some((x) => x.name === name)) return null
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onupgradeneeded = () => {
      req.transaction?.abort()
      reject(new Error('Legacy source was missing'))
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open legacy source'))
  })
}
