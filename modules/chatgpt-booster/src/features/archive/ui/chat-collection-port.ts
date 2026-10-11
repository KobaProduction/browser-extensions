import type { ChatCollectionPort, ChatCollectionSnapshot } from '@kobaproduction/browser-archive'
import { HISTORY_LOADER_STATE_EVENT } from '@chatgpt-booster/core'
import type { HistoryLoaderState } from '@chatgpt-booster/core'
import type { ArchiveDataAdapter } from '../../../../packages/ui/src/mount'

/** ChatGPT owner/context checks and source paging remain inside ArchiveDataAdapter. */
export function chatGptCollectionPort(adapter: ArchiveDataAdapter): ChatCollectionPort {
  const map = (s: Readonly<HistoryLoaderState> | undefined): ChatCollectionSnapshot => {
    if (!s) return { phase: 'idle', processed: 0, total: null, saved: null }
    const running = ['preparing', 'scrolling', 'waiting_for_load', 'backoff', 'saving'].includes(s.phase)
    return {
      phase: running ? 'running' : s.phase === 'error' ? 'error' : s.phase === 'complete' ? 'completed' : s.phase === 'cancelled' ? 'cancelled' : 'idle',
      processed: s.knownMessageCount,
      total: null, // The source does not prove complete history count.
      saved: null,
    }
  }
  return {
    completion: 'by-event',
    start: () => adapter.collectCurrent(),
    stop: () => {
      const state = adapter.getCollectionState?.()
      adapter.stopCollection?.({
        ...(state?.conversationId ? { conversationId: state.conversationId } : {}),
        ...(state?.sessionId !== undefined ? { sessionId: state.sessionId } : {}),
        reason: 'user',
      })
    },
    snapshot: () => map(adapter.getCollectionState?.()),
    subscribe(listener) {
      const handler = (event: Event) => listener(map((event as CustomEvent<HistoryLoaderState>).detail))
      window.addEventListener(HISTORY_LOADER_STATE_EVENT, handler)
      return () => window.removeEventListener(HISTORY_LOADER_STATE_EVENT, handler)
    },
  }
}
