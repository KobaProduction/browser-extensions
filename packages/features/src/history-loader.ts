import {
  buildArchiveThread,
  cancelConversationScroll,
  currentConversationId,
  currentConversationMessageBounds,
  findConversationScrollContainer,
  scrollConversationTowardStart,
} from '@chatgpt-booster/chatgpt'
import {
  type BoosterModule,
  DEFAULT_SETTINGS,
  HISTORY_LOADER_STATE_EVENT,
  type HistoryLoaderSettings,
  OPEN_ARCHIVE_EVENT,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { ARCHIVE_NETWORK_EVENT, TRANSPORT_CHANNEL } from '@chatgpt-booster/observer'
import type { ArchiveCollectionRun, ArchiveCollectionSession } from './archive-collection-session'
import { type HistoryPageEvidence, historyCoverage } from './archive-coverage'
import type { ArchiveV4CaptureModule } from './archive-v4-capture'
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
/** Browser driver only: the injected session owns consent, state and terminal transitions. */
export class HistoryLoaderModule implements BoosterModule {
  readonly id = 'history-loader'
  #active = false
  #epoch = 0
  #running: ArchiveCollectionRun | undefined
  #sessionUnsubscribe: (() => void) | undefined
  #stateUnsubscribe: (() => void) | undefined
  #scrollTarget: HTMLElement | undefined
  #network: { pending: boolean; error: number | null } = { pending: false, error: null }
  #evidenceCache:
    | {
        accountId: string
        conversationId: string
        revision: number
        evidence: ReturnType<typeof historyCoverage>
        visibleMessageCount: number
        oldestVisibleMessageId: string | null
        newestVisibleMessageId: string | null
      }
    | undefined
  #scrollSettings: HistoryLoaderSettings = { ...DEFAULT_SETTINGS.historyLoader }
  #settingsUnsubscribe: (() => void) | undefined
  private readonly sessions: ArchiveCollectionSession

  constructor(
    private readonly stateStore: ConversationStateStore,
    private readonly capture: Pick<
      ArchiveV4CaptureModule,
      'collectionSession' | 'completeCollection'
    >,
    private readonly messageSource: Window = window,
    private readonly settingsAdapter?: SettingsAdapter,
    private readonly openArchiveOnComplete = true,
  ) {
    this.sessions = capture.collectionSession
  }

  start() {
    if (this.#active) return
    this.#active = true
    const epoch = ++this.#epoch
    if (this.settingsAdapter) {
      void this.settingsAdapter
        .get()
        .then((settings) => {
          if (this.#active && epoch === this.#epoch)
            this.#scrollSettings = { ...settings.historyLoader }
        })
        .catch(() => undefined)
      this.#settingsUnsubscribe = this.settingsAdapter.subscribe((settings) => {
        this.#scrollSettings = { ...settings.historyLoader }
      })
    }
    window.addEventListener('chatgpt-booster:history-loader-query', this.#publish)
    this.#stateUnsubscribe = this.stateStore.subscribe(this.#onStateChange)
    this.#sessionUnsubscribe = this.sessions.subscribe(this.#onSessionChange)
    window.addEventListener('message', this.#onNetwork)
    window.addEventListener('wheel', this.#onUserTakeover, { capture: true, passive: true })
    window.addEventListener('touchstart', this.#onUserTakeover, { capture: true, passive: true })
    window.addEventListener('pointerdown', this.#onUserTakeover, true)
    window.addEventListener('keydown', this.#onUserTakeover, true)
    this.#onSessionChange()
  }

  stop() {
    if (!this.#active) return
    this.sessions.pause('runtime_stopped')
    this.#active = false
    this.#epoch++
    this.#settingsUnsubscribe?.()
    this.#stateUnsubscribe?.()
    this.#sessionUnsubscribe?.()
    this.#settingsUnsubscribe = undefined
    this.#stateUnsubscribe = undefined
    this.#sessionUnsubscribe = undefined
    cancelConversationScroll(this.#scrollTarget)
    this.#scrollTarget = undefined
    this.#running = undefined
    this.#evidenceCache = undefined
    window.removeEventListener('chatgpt-booster:history-loader-query', this.#publish)
    window.removeEventListener('message', this.#onNetwork)
    window.removeEventListener('wheel', this.#onUserTakeover, true)
    window.removeEventListener('touchstart', this.#onUserTakeover, true)
    window.removeEventListener('pointerdown', this.#onUserTakeover, true)
    window.removeEventListener('keydown', this.#onUserTakeover, true)
  }

  #onSessionChange = () => {
    if (!this.#active) return
    const run = this.sessions.current()
    if (this.#running && this.#running !== run) {
      this.#evidenceCache = undefined
      cancelConversationScroll(this.#scrollTarget)
      this.#scrollTarget = undefined
      this.#running = undefined
    }
    this.#publish()
    // Read the in-memory service only. Reloading the page never restores consent.
    if (!run || !this.sessions.owns(run) || this.#running === run) return
    this.#running = run
    this.#network = { pending: false, error: null }
    this.#scrollTarget = findConversationScrollContainer(document)
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
    if (data.detail.phase === 'error')
      this.#network = { pending: false, error: data.detail.status ?? 0 }
  }
  #onUserTakeover = (event: Event) => {
    const run = this.#running
    if (!event.isTrusted || !run || !this.sessions.owns(run)) return
    if (
      event.type === 'keydown' &&
      !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(
        (event as KeyboardEvent).key,
      )
    )
      return
    const target = this.#scrollTarget ?? findConversationScrollContainer(document)
    if (!target) return
    const focusedOnPage =
      event.type === 'keydown' &&
      (document.activeElement === document.body || document.activeElement === target)
    if (event.composedPath().includes(target) || focusedOnPage)
      this.sessions.pause('user_takeover', run)
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
    const pages: HistoryPageEvidence[] = this.stateStore.pages(id).map((page) => {
      const info =
        page.payload.page_info && typeof page.payload.page_info === 'object'
          ? (page.payload.page_info as Record<string, unknown>)
          : {}
      return {
        readId: page.readId,
        readStartedAt: page.readStartedAt,
        isInitial: page.isInitial,
        requestedBefore: page.requestedBefore,
        startCursor: typeof info.start_cursor === 'string' ? info.start_cursor : null,
        endCursor: typeof info.end_cursor === 'string' ? info.end_cursor : null,
        hasPreviousPage:
          typeof info.has_previous_page === 'boolean' ? info.has_previous_page : null,
        hasNextPage: typeof info.has_next_page === 'boolean' ? info.has_next_page : null,
        observedAt: page.timestamp,
      }
    })
    const thread = buildArchiveThread(this.stateStore.listMessages(id))
    let oldestVisibleMessageId: string | null = null
    let newestVisibleMessageId: string | null = null
    for (const turn of thread.turns) {
      for (const message of turn.messages) {
        oldestVisibleMessageId ??= message.record.messageId
        newestVisibleMessageId = message.record.messageId
      }
    }
    const result = {
      accountId,
      conversationId: id,
      revision,
      evidence: historyCoverage(pages),
      visibleMessageCount: thread.messageCount,
      oldestVisibleMessageId,
      newestVisibleMessageId,
    }
    this.#evidenceCache = result
    return result
  }

  async #run(run: ArchiveCollectionRun) {
    const { conversationId: id, startedAt, signal } = run
    let stalledAt = Date.now()
    let noProgress = 0
    let previousPageCount = 0
    const requireCurrentCollection = () => {
      this.sessions.requireCurrent(run)
      if (this.stateStore.verifiedAccountId() !== run.accountId)
        this.sessions.pause('account_changed', run)
      else if (currentConversationId() !== id) this.sessions.pause('navigation', run)
      else if (document.hidden) this.sessions.pause('tab_hidden', run)
      this.sessions.requireCurrent(run)
    }
    try {
      const expectedLatestMessageId = currentConversationMessageBounds().lastMessageId
      while (true) {
        requireCurrentCollection()

        const { evidence, visibleMessageCount, oldestVisibleMessageId, newestVisibleMessageId } =
          this.#memoryEvidence(id, run.accountId)
        requireCurrentCollection()
        const bounds = currentConversationMessageBounds()
        // A selected already-loaded native read is reusable evidence, not a fresh
        // response. Without one, wait for an actual read started during this run.
        const selectedRead = run.sourceReadId
          ? evidence.readId === run.sourceReadId &&
            evidence.readStartedAt === run.sourceReadStartedAt
          : (evidence.readStartedAt ?? 0) >= startedAt
        const startMatches =
          !bounds.firstMessageId || oldestVisibleMessageId === bounds.firstMessageId
        const latestMatches =
          !expectedLatestMessageId || newestVisibleMessageId === expectedLatestMessageId

        this.sessions.update(run, {
          knownMessageCount: visibleMessageCount,
          pagesLoaded: evidence.pageCount,
          hasOlderServerHistory: !evidence.startReached,
        })
        requireCurrentCollection()

        if (selectedRead && evidence.verified && startMatches && latestMatches) {
          cancelConversationScroll(this.#scrollTarget)
          this.#scrollTarget = undefined
          // Native collection is done, but manual persistence permission stays
          // owned by this run until Capture settles its already queued pages.
          await this.capture.completeCollection(run)
          const finished = this.sessions.snapshot()
          if (
            this.openArchiveOnComplete &&
            finished.sessionId === run.id &&
            finished.phase === 'complete' &&
            currentConversationId() === id &&
            this.stateStore.verifiedAccountId() === run.accountId
          )
            window.dispatchEvent(
              new CustomEvent(OPEN_ARCHIVE_EVENT, { detail: { conversationId: id } }),
            )
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
          if (status === 401 || status === 403) throw new Error('archive.error.auth')
          noProgress++
          if (noProgress >= 4) throw new Error('archive.error.network')
          this.sessions.update(run, { phase: 'backoff', consecutiveErrors: noProgress })
          await abortableDelay(historyBackoffMs(status, noProgress), signal)
          stalledAt = Date.now()
          continue
        }

        if (this.#network.pending) {
          this.sessions.update(run, { phase: 'waiting_for_load' })
        } else {
          const scroll = scrollConversationTowardStart(document, {
            speedPxPerSecond: this.#scrollSettings.speedPxPerSecond,
            burstDurationMs: this.#scrollSettings.burstDurationMs,
          })
          if (scroll.container) this.#scrollTarget = scroll.container
          if (scroll.requested) {
            this.sessions.update(run, { phase: 'scrolling' })
          } else {
            this.sessions.update(run, { phase: 'waiting_for_load' })
          }
        }

        if (Date.now() - stalledAt > 12_000) {
          noProgress++
          if (noProgress >= 4) throw new Error('archive.error.noProgress')
          this.sessions.update(run, { phase: 'backoff', consecutiveErrors: noProgress })
          requireCurrentCollection()
          this.#network.pending = false
          await abortableDelay(Math.min(8_000, 1_000 * 2 ** noProgress), signal)
          stalledAt = Date.now()
          continue
        }
        await abortableDelay(this.#scrollSettings.pauseMs, signal)
      }
    } catch (cause) {
      if (this.sessions.owns(run))
        this.sessions.fail(run, cause instanceof Error ? cause.message : 'archive.error.unknown')
    } finally {
      // Ending an old async loop must never cancel the new run's scroll target.
      if (this.#running === run) {
        cancelConversationScroll(this.#scrollTarget)
        this.#scrollTarget = undefined
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
