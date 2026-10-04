import {
  currentConversationId,
  currentConversationMessageBounds,
  findConversationScrollContainer,
} from '@chatgpt-booster/chatgpt'
import {
  ARCHIVE_UPDATED_EVENT,
  type BoosterModule,
  HISTORY_LOADER_START_EVENT,
  HISTORY_LOADER_STATE_EVENT,
  HISTORY_LOADER_STOP_EVENT,
  type HistoryLoaderState,
  OPEN_ARCHIVE_EVENT,
} from '@chatgpt-booster/core'
import { ARCHIVE_NETWORK_EVENT, TRANSPORT_CHANNEL } from '@chatgpt-booster/observer'
import type { ArchiveIngestSummary, ConversationArchiveStore } from './archive-store'
import {
  type CollectionTicket,
  type ConversationArchiveModule,
  collectionTicket,
} from './conversation-archive'

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
  #pages = new Set<string>()
  #startedAt = 0
  #ticket: CollectionTicket | undefined
  #network: { pending: boolean; error: number | null } = { pending: false, error: null }
  #state: HistoryLoaderState = {
    phase: 'idle',
    conversationId: null,
    knownMessageCount: 0,
    hasOlderServerHistory: null,
    pagesLoaded: 0,
    consecutiveErrors: 0,
  }
  constructor(
    private store: Pick<ConversationArchiveStore, 'getCoverage'>,
    private capture: Pick<ConversationArchiveModule, 'finishCollection'>,
  ) {}
  start() {
    window.addEventListener('chatgpt-booster:history-loader-query', this.#onQuery)
    window.addEventListener(HISTORY_LOADER_START_EVENT, this.#onStart)
    window.addEventListener(HISTORY_LOADER_STOP_EVENT, this.#onStop)
    window.addEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchive)
    window.addEventListener('message', this.#onNetwork)
    window.addEventListener('chatgpt-booster:archive-storage-error', this.#onStorageError)
    this.#publish()
    if (collectionTicket()) this.#onStart()
  }
  stop() {
    this.#onStop()
    window.removeEventListener('chatgpt-booster:history-loader-query', this.#onQuery)
    window.removeEventListener(HISTORY_LOADER_START_EVENT, this.#onStart)
    window.removeEventListener(HISTORY_LOADER_STOP_EVENT, this.#onStop)
    window.removeEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchive)
    window.removeEventListener('message', this.#onNetwork)
    window.removeEventListener('chatgpt-booster:archive-storage-error', this.#onStorageError)
  }
  #onQuery = () => this.#publish()
  #onArchive = (event: Event) => {
    if (!this.#abort || this.#abort.signal.aborted) return
    const detail = (event as CustomEvent<ArchiveIngestSummary>).detail
    if (
      detail?.conversationId !== this.#state.conversationId ||
      typeof detail.readStartedAt !== 'number' ||
      detail.readStartedAt < this.#startedAt
    )
      return
    if (detail.pageKey) this.#pages.add(detail.pageKey)
    this.#network.pending = false
  }
  #onNetwork = (event: MessageEvent) => {
    if (!this.#abort || this.#abort.signal.aborted) return
    if (event.origin !== location.origin || event.source !== window) return
    const data = event.data
    if (
      data?.channel !== TRANSPORT_CHANNEL ||
      data.type !== ARCHIVE_NETWORK_EVENT ||
      data.detail?.conversationId !== this.#state.conversationId
    )
      return
    if (data.detail.phase === 'request') this.#network = { pending: true, error: null }
    if (data.detail.phase === 'error')
      this.#network = { pending: false, error: data.detail.status ?? 0 }
  }
  #onStorageError = (event: Event) => {
    if ((event as CustomEvent).detail?.conversationId !== this.#state.conversationId) return
    const controller = this.#abort
    if (!controller || controller.signal.aborted) return
    controller.abort(new Error('archive.error.storage'))
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
    this.#pages.clear()
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

        const coverage = await this.store.getCoverage(id)
        requireCurrentCollection()
        if (document.hidden) {
          stalledAt = Date.now()
          continue
        }
        const container = findConversationScrollContainer()
        const bounds = currentConversationMessageBounds()
        const fresh = coverage?.evidenceVersion === 1 && (coverage.readStartedAt ?? 0) >= startedAt
        const atStart = !container || container.scrollTop <= 1
        const startMatches =
          !!bounds.firstMessageId && coverage?.oldestKnownVisibleMessageId === bounds.firstMessageId
        const latestMatches =
          !expectedLatestMessageId ||
          coverage?.newestKnownVisibleMessageId === expectedLatestMessageId

        this.#set({
          knownMessageCount: coverage?.visibleMessageCount ?? 0,
          pagesLoaded: fresh ? (coverage?.historyPageCount ?? this.#pages.size) : this.#pages.size,
          hasOlderServerHistory: coverage?.hasOlderServerHistory ?? null,
        })

        if (fresh && coverage?.completeAtLastRead && atStart && startMatches && latestMatches) {
          this.#set({ phase: 'complete', hasOlderServerHistory: false })
          window.dispatchEvent(
            new CustomEvent(OPEN_ARCHIVE_EVENT, { detail: { conversationId: id } }),
          )
          return
        }

        if (this.#pages.size > previousPageCount) {
          previousPageCount = this.#pages.size
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
        } else if (container) {
          const before = container.scrollTop
          container.scrollBy({
            top: -Math.min(260, Math.max(120, container.clientHeight * 0.4)),
            behavior: 'instant',
          })
          if (container.scrollTop < before - 1) {
            this.#set({ phase: 'scrolling' })
            stalledAt = Date.now()
          } else {
            this.#set({ phase: 'waiting_for_load' })
          }
        } else {
          this.#set({ phase: 'waiting_for_load' })
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
        await abortableDelay(360, signal)
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
