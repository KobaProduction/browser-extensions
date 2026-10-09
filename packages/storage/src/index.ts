/** Provider-neutral IndexedDB transaction primitives moved from ChatGPT Booster.
 * Request resolution is not evidence of a committed transaction: await transactionComplete.
 */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/** Resolves only after the complete event, rejecting transaction aborts and errors. */
export function transactionComplete(tx: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    tx.addEventListener('complete', () => resolve(), { once: true })
    tx.addEventListener('error', () => reject(tx.error ?? new Error('IndexedDB transaction failed')), {
      once: true,
    })
    tx.addEventListener(
      'abort',
      () => reject(tx.error ?? new DOMException('IndexedDB transaction aborted', 'AbortError')),
      { once: true },
    )
  })
  // Prevent unhandled rejections if the caller is awaiting an earlier failed request.
  void done.catch(() => undefined)
  return done
}

export type {
  IndexedPage,
  IndexedPageOptions,
  IndexedScanOptions,
  IndexedScanResult,
} from './indexed-batches'
export { readIndexedPage, scanIndexedPages } from './indexed-batches'
