import {
  HISTORY_LOADER_STATE_EVENT,
  HISTORY_LOADER_STOP_EVENT,
  type HistoryLoaderState,
  OPEN_ARCHIVE_EVENT,
} from '../../packages/core/src'
import type {
  ConversationArchiveStore,
  ConversationCoverage,
} from '../../packages/features/src/archive-store'
import { HistoryLoaderModule } from '../../packages/features/src/history-loader'

/** Browser-local delayed store responses exercise real async loader lifecycle without network. */
export async function runLoaderCancellationTests() {
  const results: { name: string; pass: boolean; detail?: string }[] = []
  for (const mode of ['stop', 'navigation'] as const) {
    const href = location.href
    const id = `loader-${mode}`
    const startedAt = Date.now()
    const ticketKey = 'chatgpt-booster:manual-collection'
    const states: HistoryLoaderState[] = []
    let archiveOpened = false
    let resolveRead: ((coverage: ConversationCoverage) => void) | undefined
    let finishes = 0
    const slowStore = {
      getCoverage: () =>
        new Promise<ConversationCoverage>((resolve) => {
          resolveRead = resolve
        }),
    }
    const capture = {
      finishCollection: () => {
        finishes++
        sessionStorage.removeItem(ticketKey)
      },
    }
    const state = (event: Event) =>
      states.push({ ...(event as CustomEvent<HistoryLoaderState>).detail })
    const open = (event: Event) => {
      if ((event as CustomEvent).detail?.conversationId === id) archiveOpened = true
    }
    const loader = new HistoryLoaderModule(slowStore, capture)
    try {
      history.replaceState(null, '', `/c/${id}`)
      sessionStorage.setItem(
        ticketKey,
        JSON.stringify({ conversationId: id, startedAt, expiresAt: startedAt + 60000 }),
      )
      window.addEventListener(HISTORY_LOADER_STATE_EVENT, state)
      window.addEventListener(OPEN_ARCHIVE_EVENT, open)
      loader.start()
      if (!resolveRead) throw new Error('loader did not await a store response')
      if (mode === 'stop') window.dispatchEvent(new Event(HISTORY_LOADER_STOP_EVENT))
      else history.replaceState(null, '', '/c/different-conversation')
      resolveRead({
        evidenceVersion: 1,
        conversationId: id,
        readStartedAt: startedAt + 1,
        completeAtLastRead: true,
        verifiedAt: startedAt + 2,
        visibleMessageCount: 2,
      } as ConversationCoverage)
      await new Promise((resolve) => setTimeout(resolve, 20))
      if (archiveOpened || states.some((item) => item.phase === 'complete'))
        throw new Error('late DB completion opened an archive after cancellation')
      if (!states.some((item) => item.phase === 'cancelled'))
        throw new Error('cancelled state missing')
      if (!finishes || sessionStorage.getItem(ticketKey))
        throw new Error('temporary permission was not cleared')
      results.push({ name: `late complete after ${mode} must not report success`, pass: true })
    } catch (error) {
      results.push({
        name: `late complete after ${mode} must not report success`,
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      loader.stop()
      window.removeEventListener(HISTORY_LOADER_STATE_EVENT, state)
      window.removeEventListener(OPEN_ARCHIVE_EVENT, open)
      sessionStorage.removeItem(ticketKey)
      history.replaceState(null, '', href)
    }
  }
  return results
}

/** Real scrollTop changes and real IndexedDB; server page events are explicit synthetic fixtures. */
export async function runLoaderScrollTest(
  store: Pick<ConversationArchiveStore, 'ingest' | 'getCoverage'>,
) {
  const href = location.href
  const id = `loader-scroll-${Date.now()}`
  const ticketKey = 'chatgpt-booster:manual-collection'
  const startedAt = Date.now()
  const scroller = document.querySelector<HTMLElement>('[class~="group/scroll-root"]')
  if (!scroller)
    return {
      name: 'scroll and wait for linked page',
      pass: false,
      detail: 'fixture scroller missing',
    }
  const states: HistoryLoaderState[] = []
  let opened = false
  const state = (event: Event) =>
    states.push({ ...(event as CustomEvent<HistoryLoaderState>).detail })
  const open = (event: Event) => {
    if ((event as CustomEvent).detail?.conversationId === id) opened = true
  }
  const capture = {
    finishCollection: () => {
      sessionStorage.removeItem(ticketKey)
    },
  }
  const loader = new HistoryLoaderModule(store, capture)
  const detail = {
    kind: 'conversation-page' as const,
    conversationId: id,
    timestamp: startedAt + 1,
    sourceUrl: 'fixture://loader',
    readId: `${id}-read`,
    readStartedAt: startedAt + 1,
    isInitial: true,
    requestedBefore: null as string | null,
    payload: {
      conversation_id: id,
      title: id,
      gizmo_id: null,
      messages: [],
      page_info: {
        start_cursor: 'middle',
        end_cursor: 'end',
        has_previous_page: true,
        has_next_page: false,
      },
    },
  }
  try {
    history.replaceState(null, '', `/c/${id}`)
    sessionStorage.setItem(
      ticketKey,
      JSON.stringify({ conversationId: id, startedAt, expiresAt: startedAt + 60000 }),
    )
    await store.ingest(detail)
    scroller.scrollTop = 900
    window.addEventListener(HISTORY_LOADER_STATE_EVENT, state)
    window.addEventListener(OPEN_ARCHIVE_EVENT, open)
    loader.start()
    await new Promise((resolve) => setTimeout(resolve, 950))
    const scrolled = scroller.scrollTop < 900
    scroller.scrollTop = 0
    await new Promise((resolve) => setTimeout(resolve, 450))
    const premature = opened || states.some((item) => item.phase === 'complete')
    await store.ingest({
      ...detail,
      timestamp: Date.now(),
      isInitial: false,
      requestedBefore: 'middle',
      payload: {
        ...detail.payload,
        page_info: {
          start_cursor: 'start',
          end_cursor: 'middle',
          has_previous_page: false,
          has_next_page: true,
        },
      },
    })
    const waitStarted = Date.now()
    while (!opened && Date.now() - waitStarted < 2500)
      await new Promise((resolve) => setTimeout(resolve, 25))
    const countedInitial = states.some(
      (item) => item.phase === 'complete' && item.pagesLoaded === 2,
    )
    if (!scrolled || premature || !opened || !countedInitial || sessionStorage.getItem(ticketKey))
      throw new Error(
        `scroll=${scrolled}, premature=${premature}, complete=${opened}, ticket=${!!sessionStorage.getItem(ticketKey)}`,
      )
    return {
      name: 'scroll and wait for linked page',
      pass: true,
      scrolled,
      noCompletionFromTop: !premature,
      completesAfterIngest: opened,
      countsInitialPage: countedInitial,
    }
  } catch (error) {
    return {
      name: 'scroll and wait for linked page',
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  } finally {
    loader.stop()
    window.removeEventListener(HISTORY_LOADER_STATE_EVENT, state)
    window.removeEventListener(OPEN_ARCHIVE_EVENT, open)
    sessionStorage.removeItem(ticketKey)
    history.replaceState(null, '', href)
  }
}
