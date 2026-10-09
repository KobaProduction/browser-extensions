import type {
  HistoryCollectionStopReason,
  HistoryLoaderPhase,
  HistoryLoaderState,
} from '@chatgpt-booster/core'

/** Local consent, not a ChatGPT source identity and never persisted across reloads. */
export interface ArchiveCollectionRun {
  readonly id: number
  readonly accountId: string
  readonly conversationId: string
  readonly projectId: string | null
  readonly selectedTipId: string | null
  readonly sourceReadId: string | null
  readonly sourceReadStartedAt: number | null
  readonly startedAt: number
  readonly expiresAt: number
  readonly signal: AbortSignal
}

type RunningPhase = Exclude<HistoryLoaderPhase, 'idle' | 'complete' | 'cancelled' | 'error'>
type Progress = Partial<
  Pick<
    HistoryLoaderState,
    'knownMessageCount' | 'hasOlderServerHistory' | 'pagesLoaded' | 'consecutiveErrors'
  >
> & { phase?: RunningPhase }

/**
 * Single consent/lifecycle owner shared by Capture and History Loader.
 * No document, window, storage, scrolling or IndexedDB dependency. Every
 * continuation carries an exact run object; an old run cannot alter a new one.
 */
export class ArchiveCollectionSession {
  static readonly MAX_DURATION_MS = 30 * 60_000
  #generation = 0
  #active: { run: ArchiveCollectionRun; controller: AbortController } | undefined
  #listeners = new Set<(state: Readonly<HistoryLoaderState>) => void>()
  #state: HistoryLoaderState = {
    phase: 'idle',
    conversationId: null,
    knownMessageCount: 0,
    hasOlderServerHistory: null,
    pagesLoaded: 0,
    consecutiveErrors: 0,
  }

  constructor(private readonly now: () => number = Date.now) {}

  current(): ArchiveCollectionRun | undefined {
    return this.#active?.run
  }
  snapshot(): Readonly<HistoryLoaderState> {
    return Object.freeze({ ...this.#state })
  }

  subscribe(listener: (state: Readonly<HistoryLoaderState>) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Only the explicit collection command may call begin; observers never resume. */
  begin(
    context: Pick<
      ArchiveCollectionRun,
      'accountId' | 'conversationId' | 'projectId' | 'selectedTipId'
    > &
      Partial<Pick<ArchiveCollectionRun, 'sourceReadId' | 'sourceReadStartedAt'>>,
  ): ArchiveCollectionRun {
    if (!context.accountId || !context.conversationId) throw new Error('archive.error.auth')
    const startedAt = this.now()
    if (!Number.isFinite(startedAt)) throw new Error('archive.error.timeout')
    this.pause('superseded')
    const controller = new AbortController()
    const run: ArchiveCollectionRun = Object.freeze({
      ...context,
      sourceReadId: context.sourceReadId ?? null,
      sourceReadStartedAt: context.sourceReadStartedAt ?? null,
      id: ++this.#generation,
      startedAt,
      expiresAt: startedAt + ArchiveCollectionSession.MAX_DURATION_MS,
      signal: controller.signal,
    })
    this.#active = { run, controller }
    this.#state = {
      phase: 'preparing',
      conversationId: run.conversationId,
      sessionId: run.id,
      knownMessageCount: 0,
      hasOlderServerHistory: null,
      pagesLoaded: 0,
      consecutiveErrors: 0,
    }
    this.#publish()
    return run
  }

  owns(run: ArchiveCollectionRun): boolean {
    return this.#active?.run === run && !run.signal.aborted
  }

  permits(
    run: ArchiveCollectionRun | undefined,
    accountId: string,
    conversationId: string,
  ): boolean {
    return (
      !!run &&
      this.owns(run) &&
      run.accountId === accountId &&
      run.conversationId === conversationId &&
      this.now() < run.expiresAt
    )
  }

  requireCurrent(run: ArchiveCollectionRun): void {
    this.expire(run)
    if (!this.owns(run))
      throw run.signal.reason instanceof Error
        ? run.signal.reason
        : new DOMException('Collection no longer active', 'AbortError')
  }

  update(run: ArchiveCollectionRun, progress: Progress): boolean {
    if (!this.owns(run)) return false
    // Callers can report progress, not replace identity or terminal decisions.
    this.#state = { ...this.#state, ...progress }
    this.#publish()
    return true
  }

  expire(run: ArchiveCollectionRun | undefined = this.current()): void {
    if (run && this.owns(run) && this.now() >= run.expiresAt)
      this.#end(run, 'error', 'expired', 'archive.error.timeout')
  }

  pause(reason: HistoryCollectionStopReason = 'user', run = this.current()): boolean {
    return !!run && this.#end(run, 'cancelled', reason)
  }

  fail(run: ArchiveCollectionRun, message: string): boolean {
    // Only a safe application error key can leave the feature layer.
    return this.#end(
      run,
      'error',
      undefined,
      /^archive\.error\.[a-zA-Z]+$/.test(message) ? message : 'archive.error.unknown',
    )
  }

  complete(run: ArchiveCollectionRun): boolean {
    // Complete is reserved for a native evidence check followed by queue drain.
    if (this.#state.phase !== 'saving') return false
    return this.#end(run, 'complete')
  }

  /** Await persistence without retaining a cancelled session until I/O finishes. */
  waitFor<T>(run: ArchiveCollectionRun, work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () =>
        reject(
          run.signal.reason instanceof Error
            ? run.signal.reason
            : new DOMException('Collection cancelled', 'AbortError'),
        )
      run.signal.addEventListener('abort', abort, { once: true })
      const detach = () => run.signal.removeEventListener('abort', abort)
      work.then(
        (result) => {
          detach()
          try {
            this.requireCurrent(run)
            resolve(result)
          } catch (cause) {
            reject(cause)
          }
        },
        (cause: unknown) => {
          detach()
          reject(cause)
        },
      )
      if (run.signal.aborted) {
        detach()
        abort()
      }
    })
  }

  #end(
    run: ArchiveCollectionRun,
    phase: 'complete' | 'cancelled' | 'error',
    stopReason?: HistoryCollectionStopReason,
    message?: string,
  ): boolean {
    if (!this.owns(run)) return false
    const active = this.#active
    if (!active) return false
    const controller = active.controller
    this.#active = undefined // Revoke consent before invoking any subscriber.
    this.#state = { ...this.#state, phase, stopReason, message }
    controller.abort(new DOMException('Collection ended', 'AbortError'))
    this.#publish()
    return true
  }

  #publish() {
    const identity = this.#state
    const state = this.snapshot()
    for (const listener of this.#listeners) {
      // A nested stop/restart publishes its own state; do not deliver the
      // superseded snapshot to the remaining listeners afterwards.
      if (identity !== this.#state) break
      try {
        listener(state)
      } catch {
        /* UI/transport observers cannot own lifecycle. */
      }
    }
  }
}
