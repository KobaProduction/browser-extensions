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

type TicketRef = { conversationId: string; startedAt: number }
function finishTicket(ticketKey: string, expected?: TicketRef) {
  if (expected) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(ticketKey) ?? 'null') as TicketRef | null
      if (
        stored &&
        (stored.conversationId !== expected.conversationId ||
          stored.startedAt !== expected.startedAt)
      )
        return
    } catch {
      // Invalid fixture state is cleared below.
    }
  }
  sessionStorage.removeItem(ticketKey)
}

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
      getPreloadSnapshot: async () => undefined,
    }
    const capture = {
      finishCollection: (expected?: TicketRef) => {
        finishes++
        finishTicket(ticketKey, expected)
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
  store: Pick<ConversationArchiveStore, 'ingest' | 'getCoverage' | 'getPreloadSnapshot'>,
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
  const firstMessageId = `${id}-first`
  const lastMessageId = `${id}-last`
  const firstVisible = document.createElement('div')
  firstVisible.dataset.messageId = firstMessageId
  firstVisible.dataset.messageAuthorRole = 'user'
  firstVisible.textContent = 'First fixture message'
  const lastVisible = document.createElement('div')
  lastVisible.dataset.messageId = lastMessageId
  lastVisible.dataset.messageAuthorRole = 'assistant'
  lastVisible.textContent = 'Latest fixture message'
  const surface = scroller.firstElementChild ?? scroller
  surface.prepend(firstVisible)
  surface.append(lastVisible)

  const states: HistoryLoaderState[] = []
  let opened = false
  const state = (event: Event) =>
    states.push({ ...(event as CustomEvent<HistoryLoaderState>).detail })
  const open = (event: Event) => {
    if ((event as CustomEvent).detail?.conversationId === id) opened = true
  }
  const capture = {
    finishCollection: (expected?: TicketRef) => {
      finishTicket(ticketKey, expected)
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
      messages: [
        {
          id: lastMessageId,
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['Latest fixture message'] },
          create_time: 2,
        },
      ],
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
        messages: [
          {
            id: firstMessageId,
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['First fixture message'] },
            create_time: 1,
          },
        ],
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
    firstVisible.remove()
    lastVisible.remove()
    history.replaceState(null, '', href)
  }
}

export async function runLoaderIsolationTests() {
  const results: { name: string; pass: boolean; detail?: string }[] = []
  const ticketKey = 'chatgpt-booster:manual-collection'
  const scroller = document.querySelector<HTMLElement>('[class~="group/scroll-root"]')

  async function run(
    name: string,
    body: (context: {
      id: string
      states: HistoryLoaderState[]
      setHidden(value: boolean): void
      scroller: HTMLElement
    }) => Promise<void>,
  ) {
    const href = location.href
    const id = `loader-isolation-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const startedAt = Date.now()
    const states: HistoryLoaderState[] = []
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    const store = {
      async getCoverage(): Promise<ConversationCoverage> {
        return {
          evidenceVersion: 1,
          conversationId: id,
          readId: `${id}-read`,
          readStartedAt: startedAt + 1,
          verifiedAt: null,
          historyPageCount: 1,
          visibleMessageCount: 2,
          internalRecordCount: 0,
          oldestKnownMessageId: null,
          newestKnownMessageId: null,
          oldestKnownCursor: 'middle',
          newestKnownCursor: 'end',
          hasOlderServerHistory: true,
          hasNewerServerHistory: false,
          knownMessageCount: 2,
          knownBranchConversationIds: [],
          lastObservedAt: startedAt + 1,
          lastFullReadAt: null,
          completeAtLastRead: false,
        }
      },
      getPreloadSnapshot: async () => undefined,
    }
    const capture = {
      finishCollection: (expected?: TicketRef) => finishTicket(ticketKey, expected),
    }
    const loader = new HistoryLoaderModule(store, capture)
    const state = (event: Event) =>
      states.push({ ...(event as CustomEvent<HistoryLoaderState>).detail })
    try {
      if (!scroller) throw new Error('fixture scroller missing')
      history.replaceState(null, '', `/c/${id}`)
      sessionStorage.setItem(
        ticketKey,
        JSON.stringify({ conversationId: id, startedAt, expiresAt: startedAt + 60_000 }),
      )
      window.addEventListener(HISTORY_LOADER_STATE_EVENT, state)
      loader.start()
      await body({
        id,
        states,
        setHidden: (value) => {
          hidden = value
        },
        scroller,
      })
      results.push({ name, pass: true })
    } catch (error) {
      results.push({
        name,
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      loader.stop()
      window.removeEventListener(HISTORY_LOADER_STATE_EVENT, state)
      sessionStorage.removeItem(ticketKey)
      history.replaceState(null, '', href)
      if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor)
      else Reflect.deleteProperty(document, 'hidden')
    }
  }

  await run(
    'unrelated network errors are ignored; current auth errors are scoped',
    async ({ id, states }) => {
      const emit = (conversationId: string, status: number) =>
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: location.origin,
            source: window,
            data: {
              channel: 'chatgpt-booster:transport',
              type: 'chatgpt-booster:archive-network',
              detail: { conversationId, phase: 'error', status },
            },
          }),
        )
      emit('different-conversation', 401)
      await new Promise((resolve) => setTimeout(resolve, 700))
      if (states.some((item) => item.phase === 'error')) throw new Error('foreign error leaked')
      emit(id, 401)
      const started = Date.now()
      while (!states.some((item) => item.phase === 'error') && Date.now() - started < 2500)
        await new Promise((resolve) => setTimeout(resolve, 25))
      const error = [...states].reverse().find((item) => item.phase === 'error')
      if (error?.message !== 'archive.error.auth')
        throw new Error(`wrong scoped error: ${error?.message}`)
    },
  )

  await run(
    'background tab pauses scrolling and resumes when visible',
    async ({ states, setHidden, scroller }) => {
      scroller.scrollTop = 900
      setHidden(true)
      const before = scroller.scrollTop
      await new Promise((resolve) => setTimeout(resolve, 750))
      if (scroller.scrollTop !== before) throw new Error('background tab scrolled')
      setHidden(false)
      const started = Date.now()
      while (scroller.scrollTop >= before && Date.now() - started < 2000)
        await new Promise((resolve) => setTimeout(resolve, 25))
      if (scroller.scrollTop >= before) throw new Error('visible tab did not resume scrolling')
      if (!states.some((item) => item.phase === 'scrolling'))
        throw new Error('scrolling state missing')
    },
  )

  await run('storage error is scoped to the active conversation', async ({ id, states }) => {
    window.dispatchEvent(
      new CustomEvent('chatgpt-booster:archive-storage-error', {
        detail: { conversationId: 'different-conversation' },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 600))
    if (states.some((item) => item.phase === 'error'))
      throw new Error('foreign storage error leaked')
    window.dispatchEvent(
      new CustomEvent('chatgpt-booster:archive-storage-error', { detail: { conversationId: id } }),
    )
    const started = Date.now()
    while (!states.some((item) => item.phase === 'error') && Date.now() - started < 2500)
      await new Promise((resolve) => setTimeout(resolve, 25))
    const error = [...states].reverse().find((item) => item.phase === 'error')
    if (error?.message !== 'archive.error.storage')
      throw new Error(`wrong storage error: ${error?.message}; states=${JSON.stringify(states)}`)
  })

  return results
}
