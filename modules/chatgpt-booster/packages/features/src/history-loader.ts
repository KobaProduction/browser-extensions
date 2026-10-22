import { buildArchiveThread } from '@chatgpt-booster/chatgpt'
import {
  type BoosterModule,
  HISTORY_LOADER_STATE_EVENT,
  OPEN_ARCHIVE_EVENT,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { ARCHIVE_NETWORK_EVENT, TRANSPORT_CHANNEL } from '@chatgpt-booster/observer'
import type { ArchiveCollectionRun, ArchiveCollectionSession } from './archive-collection-session'
import type { historyCoverage } from './archive-coverage'
import type { FixedChatGptCapture } from './archive-fixed-runtime'
import type { ConversationStateStore } from './conversation-state'

export type { HistoryLoaderState } from '@chatgpt-booster/core'
export {
  HISTORY_LOADER_START_EVENT,
  HISTORY_LOADER_STATE_EVENT,
  HISTORY_LOADER_STOP_EVENT,
} from '@chatgpt-booster/core'

export function historyBackoffMs(status: number, errors: number): number {
  return status === 429 ? 12_000 : Math.min(8_000, 1_000 * 2 ** errors)
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortReason = () =>
      signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
    if (signal.aborted) {
      reject(abortReason())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortReason())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
export interface ChatGptNativeHistoryPort {
  /** Explicitly bound native application read; only subsequently observed network pages prove progress. */
  readOlder(context: {
    conversationId: string
    sourceReadId: string | null
    signal: AbortSignal
  }): Promise<void>
}

/** Network-evidence collection driver. No DOM scroll, renderer bounds or route confirmation. */
export class HistoryLoaderModule implements BoosterModule {
  readonly id = 'history-loader'
  #active = false
  #running: ArchiveCollectionRun | undefined
  #sessionUnsubscribe: (() => void) | undefined
  #stateUnsubscribe: (() => void) | undefined
  #network: { pending: boolean; error: number | null } = { pending: false, error: null }
  #evidenceCache:
    | {
        accountId: string
        conversationId: string
        revision: number
        evidence: ReturnType<typeof historyCoverage>
        visibleMessageCount: number
      }
    | undefined
  private readonly sessions: ArchiveCollectionSession

  constructor(
    private readonly stateStore: ConversationStateStore,
    private readonly capture: Pick<FixedChatGptCapture, 'collectionSession' | 'completeCollection'> &
      Partial<Pick<FixedChatGptCapture, 'completeSavedCollection'>>,
    private readonly messageSource: Window = window,
    _settingsAdapter?: SettingsAdapter,
    private readonly openArchiveOnComplete = true,
    private readonly nativeHistory?: ChatGptNativeHistoryPort,
  ) {
    this.sessions = capture.collectionSession
  }

  start() {
    if (this.#active) return
    this.#active = true
    window.addEventListener('chatgpt-booster:history-loader-query', this.#publish)
    this.#stateUnsubscribe = this.stateStore.subscribe(this.#onStateChange)
    this.#sessionUnsubscribe = this.sessions.subscribe(this.#onSessionChange)
    window.addEventListener('message', this.#onNetwork)
    this.#onSessionChange()
  }

  stop() {
    if (!this.#active) return
    this.sessions.pause('runtime_stopped')
    this.#active = false
    this.#stateUnsubscribe?.()
    this.#sessionUnsubscribe?.()
    this.#stateUnsubscribe = undefined
    this.#sessionUnsubscribe = undefined
    this.#running = undefined
    this.#evidenceCache = undefined
    window.removeEventListener('chatgpt-booster:history-loader-query', this.#publish)
    window.removeEventListener('message', this.#onNetwork)
  }

  #onSessionChange = () => {
    if (!this.#active) return
    const run = this.sessions.current()
    if (this.#running && this.#running !== run) {
      this.#evidenceCache = undefined
      this.#running = undefined
    }
    this.#publish()
    // Read the in-memory service only. Reloading the page never restores consent.
    if (!run || !this.sessions.owns(run) || this.#running === run) return
    this.#running = run
    this.#network = { pending: false, error: null }
    void this.#run(run)
  }

  #onStateChange = (change: { conversationId: string; reason: string }) => {
    if (!this.#running || !this.sessions.owns(this.#running)) return
    if (change.conversationId === this.#running.conversationId && change.reason === 'page')
      this.#network.pending = false
  }
  #onNetwork = (event: MessageEvent) => {
    if (!this.#running || !this.sessions.owns(this.#running)) return
    if (event.origin !== location.origin || event.source !== this.messageSource) return
    const data = event.data
    if (
      data?.channel !== TRANSPORT_CHANNEL ||
      data.type !== ARCHIVE_NETWORK_EVENT ||
      data.detail?.conversationId !== this.#running.conversationId
    )
      return
    if (data.detail.phase === 'request') this.#network = { pending: true, error: null }
    if (data.detail.phase === 'response') this.#network.pending = false
    if (data.detail.phase === 'error') this.#network = { pending: false, error: data.detail.status ?? 0 }
  }
  /** Reconcile expensive RAM projections only when native conversation evidence changes. */
  #memoryEvidence(id: string, accountId: string) {
    const revision = this.stateStore.header(id)?.revision ?? -1
    const cached = this.#evidenceCache
    if (
      cached &&
      cached.accountId === accountId &&
      cached.conversationId === id &&
      cached.revision === revision
    )
      return cached
    const thread = buildArchiveThread(this.stateStore.listMessages(id))
    const result = {
      accountId,
      conversationId: id,
      revision,
      evidence: this.stateStore.nativeHistoryCoverage(id),
      visibleMessageCount: thread.messageCount,
    }
    this.#evidenceCache = result
    return result
  }

  async #run(run: ArchiveCollectionRun) {
    const { conversationId: id, startedAt, signal } = run
    let stalledAt = Date.now()
    let noProgress = 0
    let previousPageCount = 0
    let requestedRevision: number | undefined
    const requireCurrentCollection = () => {
      this.sessions.requireCurrent(run)
      if (this.stateStore.verifiedAccountId() !== run.accountId)
        this.sessions.pause('account_changed', run)
      this.sessions.requireCurrent(run)
    }
    try {
      if (await this.capture.completeSavedCollection?.(run)) return
      while (true) {
        requireCurrentCollection()

        const { evidence, visibleMessageCount, revision } = this.#memoryEvidence(id, run.accountId)
        requireCurrentCollection()
        // A selected already-loaded native read is reusable evidence, not a fresh
        // response. Without one, wait for an actual read started during this run.
        const selectedRead = run.sourceReadId
          ? evidence.readId === run.sourceReadId && evidence.readStartedAt === run.sourceReadStartedAt
          : (evidence.readStartedAt ?? 0) >= startedAt
        this.sessions.update(run, {
          knownMessageCount: visibleMessageCount,
          pagesLoaded: evidence.pageCount,
          hasOlderServerHistory: !evidence.startReached,
        })
        requireCurrentCollection()

        if (selectedRead && evidence.verified) {
          // Native collection is done, but manual persistence permission stays
          // owned by this run until Capture settles its already queued pages.
          await this.capture.completeCollection(run)
          const finished = this.sessions.snapshot()
          if (
            this.openArchiveOnComplete &&
            finished.sessionId === run.id &&
            finished.phase === 'complete' &&
            this.stateStore.verifiedAccountId() === run.accountId
          )
            window.dispatchEvent(new CustomEvent(OPEN_ARCHIVE_EVENT, { detail: { conversationId: id } }))
          return
        }

        if (evidence.pageCount > previousPageCount) {
          previousPageCount = evidence.pageCount
          stalledAt = Date.now()
          noProgress = 0
          this.sessions.update(run, { consecutiveErrors: 0 })
        }
        requireCurrentCollection()

        if (this.#network.error !== null) {
          const status = this.#network.error
          this.#network.error = null
          // This revision's read failed; its next attempt must not be gated by the same RAM revision.
          requestedRevision = undefined
          if (status === 401 || status === 403) throw new Error('archive.error.auth')
          noProgress++
          if (noProgress >= 4) throw new Error('archive.error.network')
          this.sessions.update(run, { phase: 'backoff', consecutiveErrors: noProgress })
          await abortableDelay(historyBackoffMs(status, noProgress), signal)
          stalledAt = Date.now()
          continue
        }

        if (!this.#network.pending && requestedRevision !== revision) {
          if (!this.nativeHistory) throw Error('archive.error.nativeHistoryUnavailable')
          requestedRevision = revision
          requireCurrentCollection()
          await this.sessions.waitFor(
            run,
            this.nativeHistory.readOlder({
              conversationId: id,
              sourceReadId: run.sourceReadId ?? null,
              signal,
            }),
          )
          requireCurrentCollection()
        }
        this.sessions.update(run, { phase: 'waiting_for_load' })

        if (Date.now() - stalledAt > 12_000) {
          requestedRevision = undefined
          noProgress++
          if (noProgress >= 4) throw new Error('archive.error.noProgress')
          this.sessions.update(run, { phase: 'backoff', consecutiveErrors: noProgress })
          requireCurrentCollection()
          this.#network.pending = false
          await abortableDelay(Math.min(8_000, 1_000 * 2 ** noProgress), signal)
          stalledAt = Date.now()
          continue
        }
        await abortableDelay(100, signal)
      }
    } catch (cause) {
      if (this.sessions.owns(run))
        this.sessions.fail(run, cause instanceof Error ? cause.message : 'archive.error.unknown')
    } finally {
      // An old asynchronous read cannot release a newer collection run.
      if (this.#running === run) {
        this.#running = undefined
      }
    }
  }
  #publish = () => {
    window.dispatchEvent(
      new CustomEvent(HISTORY_LOADER_STATE_EVENT, {
        detail: this.sessions.snapshot(),
      }),
    )
  }
}
