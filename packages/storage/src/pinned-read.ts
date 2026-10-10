/** Checks a provider-supplied durable version before and after an async read.
 *
 * This guards multi-transaction paging only when the adapter's stamp changes
 * on EVERY mutation affecting the returned data (including deletion/recreate).
 * It cannot turn a mutable, unversioned database into an atomic snapshot.
 */
export interface PinnedReadOptions<TStamp, TResult> {
  readonly readStamp: () => Promise<TStamp>
  readonly read: (stamp: TStamp) => Promise<TResult>
  readonly sameStamp: (before: TStamp, after: TStamp) => boolean
  /** Authorization, account epoch, request-token checks, etc. */
  readonly assertCurrent?: () => void
  /** Validate a requested revision or already-open session before the IO. */
  readonly acceptStamp?: (stamp: TStamp) => void
  readonly onConflict?: () => void
  readonly signal?: AbortSignal
  readonly conflictError?: () => Error
}

export interface VerifyPinnedResultOptions<TStamp, TResult>
  extends Omit<PinnedReadOptions<TStamp, TResult>, 'read' | 'acceptStamp'> {
  readonly stamp: TStamp
  readonly result: TResult
}

/** Recheck a pinned stamp after a read that already returned its own source version. */
export async function verifyPinnedResult<TStamp, TResult>(
  options: VerifyPinnedResultOptions<TStamp, TResult>,
): Promise<{ stamp: TStamp; result: TResult }> {
  abortIfNeeded(options.signal)
  options.assertCurrent?.()
  const latest = await options.readStamp()
  abortIfNeeded(options.signal)
  options.assertCurrent?.()
  if (!options.sameStamp(options.stamp, latest)) {
    options.onConflict?.()
    throw options.conflictError?.() ?? new Error('Source snapshot changed during read')
  }
  return { stamp: options.stamp, result: options.result }
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Pinned read cancelled', 'AbortError')
}

/** Never publish results until the source stamp has been reread and compared. */
export async function readPinnedSnapshot<TStamp, TResult>(
  options: PinnedReadOptions<TStamp, TResult>,
): Promise<{ stamp: TStamp; result: TResult }> {
  const check = (): void => {
    abortIfNeeded(options.signal)
    options.assertCurrent?.()
  }
  check()
  const stamp = await options.readStamp()
  check()
  options.acceptStamp?.(stamp)
  check()
  const result = await options.read(stamp)
  check()
  return verifyPinnedResult({
    stamp,
    result,
    readStamp: options.readStamp,
    sameStamp: options.sameStamp,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.assertCurrent ? { assertCurrent: options.assertCurrent } : {}),
    ...(options.onConflict ? { onConflict: options.onConflict } : {}),
    ...(options.conflictError ? { conflictError: options.conflictError } : {}),
  })
}
