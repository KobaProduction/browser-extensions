import { currentConversationId, findConversationScrollContainer } from '@chatgpt-booster/chatgpt'
import type { BoosterModule } from '@chatgpt-booster/core'
import {
  ARCHIVE_UPDATED_EVENT,
  type ArchiveIngestSummary,
  ConversationArchiveStore,
  type ConversationCoverage,
} from './archive-store'

export const HISTORY_LOADER_START_EVENT = 'chatgpt-booster:history-loader-start'
export const HISTORY_LOADER_STOP_EVENT = 'chatgpt-booster:history-loader-stop'
export const HISTORY_LOADER_STATE_EVENT = 'chatgpt-booster:history-loader-state'

export type HistoryLoaderPhase =
  | 'idle'
  | 'preparing'
  | 'scrolling'
  | 'waiting_for_load'
  | 'backoff'
  | 'complete'
  | 'cancelled'
  | 'error'

export interface HistoryLoaderState {
  phase: HistoryLoaderPhase
  conversationId: string | null
  knownMessageCount: number
  hasOlderServerHistory: boolean | null
  pagesLoaded: number
  consecutiveErrors: number
  message?: string | undefined
}

const MAX_CONSECUTIVE_ERRORS = 4
const LOAD_TIMEOUT_MS = 12_000

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function jitter(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min))
}

export class HistoryLoaderModule implements BoosterModule {
  readonly id = 'history-loader'
  readonly #store: ConversationArchiveStore
  #abort: AbortController | undefined
  #state: HistoryLoaderState = {
    phase: 'idle',
    conversationId: null,
    knownMessageCount: 0,
    hasOlderServerHistory: null,
    pagesLoaded: 0,
    consecutiveErrors: 0,
  }

  constructor(store = new ConversationArchiveStore()) {
    this.#store = store
  }

  start() {
    window.addEventListener(HISTORY_LOADER_START_EVENT, this.#onStart)
    window.addEventListener(HISTORY_LOADER_STOP_EVENT, this.#onStop)
    this.#publish()
  }

  stop() {
    window.removeEventListener(HISTORY_LOADER_START_EVENT, this.#onStart)
    window.removeEventListener(HISTORY_LOADER_STOP_EVENT, this.#onStop)
    this.#abort?.abort()
    this.#abort = undefined
  }

  #onStart = () => {
    if (this.#abort) return
    const conversationId = currentConversationId()
    if (!conversationId) {
      this.#set({ phase: 'error', conversationId: null, message: 'No conversation is open.' })
      return
    }
    this.#abort = new AbortController()
    void this.#run(conversationId, this.#abort.signal).finally(() => {
      this.#abort = undefined
    })
  }

  #onStop = () => {
    this.#abort?.abort()
  }

  async #run(conversationId: string, signal: AbortSignal) {
    try {
      this.#set({
        phase: 'preparing',
        conversationId,
        pagesLoaded: 0,
        consecutiveErrors: 0,
        message: undefined,
      })

      let coverage = await this.#store.getCoverage(conversationId)
      this.#applyCoverage(coverage)
      if (coverage?.hasOlderServerHistory === false && coverage.completeAtLastRead) {
        this.#set({ phase: 'complete' })
        return
      }

      let errors = 0
      while (!signal.aborted) {
        const container = findConversationScrollContainer()
        if (!container) throw new Error('Conversation scroll container not found')

        coverage = await this.#store.getCoverage(conversationId)
        this.#applyCoverage(coverage)
        if (coverage?.hasOlderServerHistory === false) {
          this.#set({ phase: 'complete', consecutiveErrors: 0 })
          return
        }

        const before = coverage
        const beforeTop = container.scrollTop
        const step = Math.max(
          180,
          Math.round(container.clientHeight * (0.35 + Math.random() * 0.3)),
        )
        this.#set({ phase: 'scrolling', consecutiveErrors: errors })
        container.scrollBy({ top: -step, behavior: 'smooth' })
        await delay(jitter(380, 760), signal)

        if (container.scrollTop <= 96 || container.scrollTop >= beforeTop - 4) {
          this.#set({ phase: 'waiting_for_load' })
          const progressed = await this.#waitForArchiveProgress(conversationId, before, signal)
          const next = await this.#store.getCoverage(conversationId)
          this.#applyCoverage(next)

          if (next?.hasOlderServerHistory === false) {
            this.#set({ phase: 'complete', consecutiveErrors: 0 })
            return
          }

          if (progressed) {
            errors = 0
            this.#set({
              pagesLoaded: this.#state.pagesLoaded + 1,
              consecutiveErrors: 0,
            })
            await delay(jitter(520, 1_150), signal)
            continue
          }

          errors += 1
          if (errors >= MAX_CONSECUTIVE_ERRORS) {
            throw new Error('No history-loading progress after repeated retries')
          }

          this.#set({ phase: 'backoff', consecutiveErrors: errors })
          container.scrollBy({ top: jitter(80, 180), behavior: 'smooth' })
          await delay(Math.min(4_000, 650 * 2 ** (errors - 1)) + jitter(120, 420), signal)
          continue
        }

        await delay(jitter(220, 560), signal)
      }
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        this.#set({ phase: 'cancelled' })
        return
      }
      this.#set({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  #waitForArchiveProgress(
    conversationId: string,
    before: ConversationCoverage | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(false), LOAD_TIMEOUT_MS)

      const onAbort = () => {
        cleanup()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      const onUpdate = (event: Event) => {
        const detail = (event as CustomEvent<ArchiveIngestSummary>).detail
        if (!detail || detail.conversationId !== conversationId) return
        if (
          detail.insertedMessages > 0 ||
          detail.updatedMessages > 0 ||
          detail.complete ||
          detail.knownMessageCount > (before?.knownMessageCount ?? 0)
        ) {
          finish(true)
        }
      }
      const cleanup = () => {
        window.clearTimeout(timeout)
        window.removeEventListener(ARCHIVE_UPDATED_EVENT, onUpdate)
        signal.removeEventListener('abort', onAbort)
      }
      const finish = (value: boolean) => {
        cleanup()
        resolve(value)
      }

      window.addEventListener(ARCHIVE_UPDATED_EVENT, onUpdate)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  #applyCoverage(coverage: ConversationCoverage | undefined) {
    this.#set({
      knownMessageCount: coverage?.knownMessageCount ?? 0,
      hasOlderServerHistory: coverage?.hasOlderServerHistory ?? null,
    })
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
