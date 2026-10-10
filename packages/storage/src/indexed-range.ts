/** Provider-neutral bounded range scan. Non-unique index keys require a
 * composite index-key/primary-key resume position; a timestamp alone can
 * silently skip records with identical timestamps. */
export interface IndexedRangePosition {
  readonly indexKey: IDBValidKey
  readonly primaryKey: IDBValidKey
}
export interface IndexedRangePage<T> {
  readonly records: readonly T[]
  readonly last: IndexedRangePosition | null
  readonly exhausted: boolean
}
export interface IndexedRangeOptions<T> {
  readonly db: IDBDatabase
  readonly store: string
  readonly index: string
  readonly range: IDBKeyRange
  readonly after?: IndexedRangePosition | null
  readonly pageSize: number
  readonly decode: (value: unknown) => T
  readonly signal?: AbortSignal
  readonly compareKeys?: (a: IDBValidKey, b: IDBValidKey) => number
}

/** Only committed read-only pages are exposed to the caller. On abort, cursor
 * error or decode failure the entire page is rejected, not partially accepted. */
export function readIndexedRangePage<T>(options: IndexedRangeOptions<T>): Promise<IndexedRangePage<T>> {
  if (!Number.isSafeInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1024)
    throw new RangeError('IndexedDB range pageSize must be an integer from 1 to 1024')
  const aborted = () => new DOMException('IndexedDB range scan cancelled', 'AbortError')
  if (options.signal?.aborted) return Promise.reject(aborted())
  const compare = options.compareKeys ?? ((a: IDBValidKey, b: IDBValidKey) => indexedDB.cmp(a, b))
  const tx = options.db.transaction(options.store, 'readonly')
  return new Promise((resolve, reject) => {
    const records: T[] = []
    let last: IndexedRangePosition | null = null
    let exhausted = false
    let finished = false
    let jumped = false
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
    const rejectOnce = (error: unknown) => {
      if (finished) return
      finished = true
      cleanup()
      reject(error)
    }
    const fail = (error: unknown) => {
      if (finished) return
      rejectOnce(error)
      try {
        tx.abort()
      } catch {
        /* Already settled. */
      }
    }
    const onAbort = () => fail(aborted())
    tx.addEventListener(
      'complete',
      () => {
        if (finished) return
        finished = true
        cleanup()
        resolve({ records, last, exhausted })
      },
      { once: true },
    )
    tx.addEventListener(
      'abort',
      () =>
        rejectOnce(
          options.signal?.aborted
            ? aborted()
            : (tx.error ?? new Error('IndexedDB range transaction aborted')),
        ),
      { once: true },
    )
    tx.addEventListener(
      'error',
      () => rejectOnce(tx.error ?? new Error('IndexedDB range transaction failed')),
      { once: true },
    )
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) {
      onAbort()
      return
    }
    try {
      const request = tx.objectStore(options.store).index(options.index).openCursor(options.range)
      request.onerror = () => fail(request.error ?? new Error('IndexedDB range cursor failed'))
      request.onsuccess = () => {
        if (finished) return
        const cursor = request.result
        if (!cursor) {
          exhausted = true
          return
        }
        try {
          const after = options.after
          if (after) {
            const order = compare(cursor.key, after.indexKey)
            const primary = order === 0 ? compare(cursor.primaryKey, after.primaryKey) : 0
            if (!jumped && (order < 0 || (order === 0 && primary < 0))) {
              jumped = true
              cursor.continuePrimaryKey(after.indexKey, after.primaryKey)
              return
            }
            if (order < 0 || (order === 0 && primary <= 0)) {
              cursor.continue()
              return
            }
          }
          records.push(options.decode(cursor.value))
          last = { indexKey: cursor.key, primaryKey: cursor.primaryKey }
          if (records.length < options.pageSize) cursor.continue()
        } catch (cause) {
          fail(cause)
        }
      }
    } catch (cause) {
      fail(cause)
    }
  })
}
