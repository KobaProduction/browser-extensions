/**
 * Provider-neutral bounded IndexedDB index scan.
 *
 * The index key may be shared by thousands of records, so the resume token is
 * the primary key, not the non-unique index key. Each page has its own readonly
 * transaction and never leaves a cursor open across asynchronous work.
 */
export interface IndexedPage<T> {
  readonly records: readonly T[]
  readonly lastPrimaryKey: IDBValidKey | null
  readonly exhausted: boolean
}

export interface IndexedPageOptions<T> {
  readonly db: IDBDatabase
  readonly store: string
  /** Omit index AND indexKey to scan the object store by its primary keys. */
  readonly index?: string
  readonly indexKey?: IDBValidKey
  readonly afterPrimaryKey?: IDBValidKey | null
  readonly pageSize: number
  readonly decode: (value: unknown) => T
  readonly signal?: AbortSignal
  /** Default browser IDB key comparison; inject a compatible comparator for adapters. */
  readonly compareKeys?: (a: IDBValidKey, b: IDBValidKey) => number
}

function aborted(): DOMException {
  return new DOMException('IndexedDB scan cancelled', 'AbortError')
}

export function readIndexedPage<T>(options: IndexedPageOptions<T>): Promise<IndexedPage<T>> {
  if (!Number.isSafeInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1024)
    throw new RangeError('IndexedDB pageSize must be an integer from 1 to 1024')
  if ((options.index === undefined) !== (options.indexKey === undefined))
    throw new Error('IndexedDB scan requires index and indexKey together')
  if (options.signal?.aborted) return Promise.reject(aborted())
  const compare = options.compareKeys ?? ((a: IDBValidKey, b: IDBValidKey) => indexedDB.cmp(a, b))
  const tx = options.db.transaction(options.store, 'readonly')
  return new Promise((resolve, reject) => {
    const records: T[] = []
    let lastPrimaryKey: IDBValidKey | null = null
    let exhausted = false
    let finished = false
    let jumped = false
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
    const rejectOnce = (reason: unknown) => {
      if (finished) return
      finished = true
      cleanup()
      reject(reason)
    }
    const fail = (reason: unknown) => {
      if (finished) return
      rejectOnce(reason)
      try {
        tx.abort()
      } catch {
        // Transaction might have settled already.
      }
    }
    const onAbort = () => fail(aborted())
    tx.addEventListener(
      'complete',
      () => {
        if (finished) return
        finished = true
        cleanup()
        resolve({ records, lastPrimaryKey, exhausted })
      },
      { once: true },
    )
    tx.addEventListener(
      'abort',
      () =>
        rejectOnce(
          options.signal?.aborted
            ? aborted()
            : (tx.error ?? new Error('IndexedDB indexed page aborted')),
        ),
      { once: true },
    )
    tx.addEventListener(
      'error',
      () => rejectOnce(tx.error ?? new Error('IndexedDB indexed page failed')),
      { once: true },
    )
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) {
      onAbort()
      return
    }
    try {
      const store = tx.objectStore(options.store)
      const request =
        options.index !== undefined && options.indexKey !== undefined
          ? store.index(options.index).openCursor(IDBKeyRange.only(options.indexKey))
          : store.openCursor()
      request.onerror = () => fail(request.error ?? new Error('IndexedDB cursor failed'))
      request.onsuccess = () => {
        if (finished) return
        const cursor = request.result
        if (!cursor) {
          exhausted = true
          return
        }
        try {
          const after = options.afterPrimaryKey
          if (after != null && !jumped) {
            jumped = true
            // continuePrimaryKey requires a *strictly later* target.
            if (compare(cursor.primaryKey, after) < 0) {
              if (options.index !== undefined && options.indexKey !== undefined)
                cursor.continuePrimaryKey(options.indexKey, after)
              else cursor.continue(after)
              return
            }
          }
          if (after != null && compare(cursor.primaryKey, after) <= 0) {
            cursor.continue()
            return
          }
          records.push(options.decode(cursor.value))
          lastPrimaryKey = cursor.primaryKey
          if (records.length < options.pageSize) cursor.continue()
          // Otherwise let this transaction finish. Caller processes this page
          // only after the readonly transaction has completed.
        } catch (reason) {
          fail(reason)
        }
      }
    } catch (reason) {
      fail(reason)
    }
  })
}

export interface IndexedScanOptions<T> extends Omit<IndexedPageOptions<T>, 'afterPrimaryKey'> {
  readonly initialPrimaryKey?: IDBValidKey | null
  /**
   * A durable migration/replication caller must store this checkpoint with
   * its materialized batch, atomically. Memory-only readers can just consume.
   */
  readonly accept: (page: Readonly<IndexedPage<T>>) => Promise<void> | void
  readonly stopped?: () => boolean
}

export interface IndexedScanResult {
  readonly lastPrimaryKey: IDBValidKey | null
  readonly exhausted: boolean
  readonly paused: boolean
}

/** No checkpoint advancement before accept resolves; abort/error propagates. */
export async function scanIndexedPages<T>(options: IndexedScanOptions<T>): Promise<IndexedScanResult> {
  let lastPrimaryKey = options.initialPrimaryKey ?? null
  let exhausted = false
  while (!options.stopped?.()) {
    if (options.signal?.aborted) throw aborted()
    const page = await readIndexedPage({ ...options, afterPrimaryKey: lastPrimaryKey })
    if (!page.records.length) {
      if (!page.exhausted) throw new Error('IndexedDB scan made no progress')
      exhausted = true
      break
    }
    await options.accept(page)
    if (options.signal?.aborted) throw aborted()
    if (page.lastPrimaryKey == null) throw new Error('IndexedDB scan missing primary key')
    lastPrimaryKey = page.lastPrimaryKey
    if (page.exhausted) {
      exhausted = true
      break
    }
  }
  return { lastPrimaryKey, exhausted, paused: !exhausted && !!options.stopped?.() }
}

/** Whole-store primary-key scan. No index is required; pages still complete before use. */
export type StorePageOptions<T> = Omit<IndexedPageOptions<T>, 'index' | 'indexKey'>
export type StoreScanOptions<T> = Omit<IndexedScanOptions<T>, 'index' | 'indexKey'>
export function readStorePage<T>(options: StorePageOptions<T>): Promise<IndexedPage<T>> {
  return readIndexedPage(options)
}
export function scanStorePages<T>(options: StoreScanOptions<T>): Promise<IndexedScanResult> {
  return scanIndexedPages(options)
}
