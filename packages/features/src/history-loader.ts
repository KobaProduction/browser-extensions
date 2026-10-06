import {
  buildArchiveThread,
  currentConversationId,
  currentConversationMessageBounds,
  scrollConversationTowardStart,
} from '@chatgpt-booster/chatgpt'
import {
  type BoosterModule,
  DEFAULT_SETTINGS,
  HISTORY_LOADER_START_EVENT,
  HISTORY_LOADER_STATE_EVENT,
  HISTORY_LOADER_STOP_EVENT,
  type HistoryLoaderSettings,
  type HistoryLoaderState,
  OPEN_ARCHIVE_EVENT,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { ARCHIVE_NETWORK_EVENT, TRANSPORT_CHANNEL } from '@chatgpt-booster/observer'
import { type HistoryPageEvidence, historyCoverage } from './archive-coverage'
import {
  type CollectionTicket,
  type ConversationArchiveModule,
  collectionTicket,
} from './conversation-archive'
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
export class HistoryLoaderModule implements BoosterModule {
  readonly id = 'history-loader'
  #abort: AbortController | undefined
  #stateUnsubscribe: (() => void) | undefined
  #startedAt = 0
  #ticket: CollectionTicket | undefined
  #network: { pending: boolean; error: number | null } = { pending: false, error: null }
  #scrollSettings: HistoryLoaderSettings = { ...DEFAULT_SETTINGS.historyLoader }
  #settingsUnsubscribe: (() => void) | undefined
  #state: HistoryLoaderState = {
    phase: 'idle',
    conversationId: null,
    knownMessageCount: 0,
    hasOlderServerHistory: null,
    pagesLoaded: 0,
    consecutiveErrors: 0,
  }
  constructor(
    private stateStore: ConversationStateStore,
    private capture: Pick<ConversationArchiveModule, 'finishCollection'>,
    private messageSource: Window = window,
    private settingsAdapter?: SettingsAdapter,
  ) {}
  start() {
    if (this.settingsAdapter) {
      void this.settingsAdapter.get().then((settings) => {
        this.#scrollSettings = { ...settings.historyLoader }
      })
      this.#settingsUnsubscribe = this.settingsAdapter.subscribe((settings) => {
        this.#scrollSettings = { ...settings.historyLoader }
      })
    }
    window.addEventListener('chatgpt-booster:history-loader-query', this.#onQuery)
    window.addEventListener(HISTORY_LOADER_START_EVENT, this.#onStart)
    window.addEventListener(HISTORY_LOADER_STOP_EVENT, this.#onStop)
    this.#stateUnsubscribe = this.stateStore.subscribe(this.#onStateChange)
    window.addEventListener('message', this.#onNetwork)
    this.#publish()
    if (collectionTicket()) this.#onStart()
  }
  stop() {
    this.#onStop()
    this.#settingsUnsubscribe?.()
    this.#settingsUnsubscribe = undefined
    window.removeEventListener('chatgpt-booster:history-loader-query', this.#onQuery)
    window.removeEventListener(HISTORY_LOADER_START_EVENT, this.#onStart)
    window.removeEventListener(HISTORY_LOADER_STOP_EVENT, this.#onStop)
    this.#stateUnsubscribe?.()
    this.#stateUnsubscribe = undefined
    window.removeEventListener('message', this.#onNetwork)
  }
  #onQuery = () => this.#publish()
  #onStateChange = (change: { conversationId: string; reason: string }) => {
    if (!this.#abort || this.#abort.signal.aborted) return
    if (change.conversationId !== this.#state.conversationId) return
    if (change.reason === 'page') this.#network.pending = false
  }
  #onNetwork = (event: MessageEvent) => {
    if (!this.#abort || this.#abort.signal.aborted) return
    if (event.origin !== location.origin || event.source !== this.messageSource) return
    const data = event.data
    if (
      data?.channel !== TRANSPORT_CHANNEL ||
      data.type !== ARCHIVE_NETWORK_EVENT ||
      data.detail?.conversationId !== this.#state.conversationId
    )
      return
    if (data.detail.phase === 'request') this.#network = { pending: true, error: null }
    if (data.detail.phase === 'response') this.#network.pending = false
    if (data.detail.phase === 'error')
      this.#network = { pending: false, error: data.detail.status ?? 0 }
  }
  #onStop = () => {
    const running = this.#abort && !this.#abort.signal.aborted
    const ticket = this.#ticket
    this.#abort?.abort()
    this.capture.finishCollection(ticket)
    if (running) this.#set({ phase: 'cancelled', message: undefined })
  }
  #onStart = () => {
    if (this.#abort) return
    const ticket = collectionTicket()
    if (!ticket) return
    const controller = new AbortController()
    this.#abort = controller
    this.#ticket = ticket
    this.#startedAt = ticket.startedAt
    this.#network = { pending: false, error: null }
    this.#set({
      phase: 'preparing',
      conversationId: ticket.conversationId,
      pagesLoaded: 0,
      consecutiveErrors: 0,
      message: undefined,
    })
    void this.#run(ticket.conversationId, ticket.startedAt, controller.signal).finally(() => {
      if (this.#abort === controller) this.#abort = undefined
      if (
        this.#ticket?.conversationId === ticket.conversationId &&
        this.#ticket.startedAt === ticket.startedAt
      )
        this.#ticket = undefined
      this.capture.finishCollection(ticket)
    })
  }
  #memoryEvidence(id: string): {
    evidence: ReturnType<typeof historyCoverage>
    records: ReturnType<ConversationStateStore['listMessages']>
  } {
    const snapshot = this.stateStore.snapshot(id)
    const pages: HistoryPageEvidence[] = (snapshot?.pages ?? []).map((page) => {
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
    return { evidence: historyCoverage(pages), records: snapshot?.records ?? [] }
  }

  async #run(id: string, startedAt: number, signal: AbortSignal) {
    let stalledAt = Date.now()
    let noProgress = 0
    let previousPageCount = 0
    const expectedLatestMessageId = currentConversationMessageBounds().lastMessageId
    const requireCurrentCollection = () => {
      if (Date.now() - startedAt > 30 * 60_000) throw new Error('archive.error.timeout')
      if (signal.aborted)
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError')
      if (currentConversationId() !== id || collectionTicket()?.startedAt !== startedAt)
        throw new DOMException('Aborted', 'AbortError')
    }
    try {
      while (true) {
        requireCurrentCollection()
        if (document.hidden) {
          await abortableDelay(500, signal)
          stalledAt = Date.now()
          continue
        }

        const { evidence, records } = this.#memoryEvidence(id)
        requireCurrentCollection()
        if (document.hidden) {
          stalledAt = Date.now()
          continue
        }
        const bounds = currentConversationMessageBounds()
        const thread = buildArchiveThread(records)
        const visible = thread.turns.flatMap((turn) => turn.messages.map((item) => item.record))
        const oldestVisibleMessageId = visible[0]?.messageId ?? null
        const newestVisibleMessageId = visible.at(-1)?.messageId ?? null
        const fresh = (evidence.readStartedAt ?? 0) >= startedAt
        const startMatches =
          !bounds.firstMessageId || oldestVisibleMessageId === bounds.firstMessageId
        const latestMatches =
          !expectedLatestMessageId || newestVisibleMessageId === expectedLatestMessageId

        this.#set({
          knownMessageCount: thread.messageCount,
          pagesLoaded: evidence.pageCount,
          hasOlderServerHistory: !evidence.startReached,
        })

        if (fresh && evidence.verified && startMatches && latestMatches) {
          this.#set({ phase: 'complete', hasOlderServerHistory: false })
          window.dispatchEvent(
            new CustomEvent(OPEN_ARCHIVE_EVENT, { detail: { conversationId: id } }),
          )
          return
        }

        if (evidence.pageCount > previousPageCount) {
          previousPageCount = evidence.pageCount
          stalledAt = Date.now()
          noProgress = 0
          this.#set({ consecutiveErrors: 0 })
        }

        if (this.#network.error !== null) {
          const status = this.#network.error
          this.#network.error = null
          if (status === 401 || status === 403) throw new Error('archive.error.auth')
          noProgress++
          if (noProgress >= 4) throw new Error('archive.error.network')
          this.#set({ phase: 'backoff', consecutiveErrors: noProgress })
          await abortableDelay(historyBackoffMs(status, noProgress), signal)
          stalledAt = Date.now()
          continue
        }

        if (this.#network.pending) {
          this.#set({ phase: 'waiting_for_load' })
        } else {
          const scroll = scrollConversationTowardStart(document, {
            speedPxPerSecond: this.#scrollSettings.speedPxPerSecond,
            burstDurationMs: this.#scrollSettings.burstDurationMs,
          })
          if (scroll.requested) {
            this.#set({ phase: 'scrolling' })
          } else {
            this.#set({ phase: 'waiting_for_load' })
          }
        }

        if (Date.now() - stalledAt > 12_000) {
          noProgress++
          if (noProgress >= 4) throw new Error('archive.error.noProgress')
          this.#set({ phase: 'backoff', consecutiveErrors: noProgress })
          this.#network.pending = false
          await abortableDelay(Math.min(8_000, 1_000 * 2 ** noProgress), signal)
          stalledAt = Date.now()
          continue
        }
        await abortableDelay(this.#scrollSettings.pauseMs, signal)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'archive.error.unknown'
      const fatalAbort = signal.aborted && message.startsWith('archive.error.')
      this.#set({
        phase:
          !fatalAbort &&
          (signal.aborted ||
            currentConversationId() !== id ||
            (error instanceof DOMException && error.name === 'AbortError'))
            ? 'cancelled'
            : 'error',
        message,
      })
    }
  }
  #set(patch: Partial<HistoryLoaderState>) {
    this.#state = { ...this.#state, ...patch }
    this.#publish()
  }
  #publish() {
    window.dispatchEvent(
      new CustomEvent(HISTORY_LOADER_STATE_EVENT, { detail: { ...this.#state } }),
    )
  }
}
