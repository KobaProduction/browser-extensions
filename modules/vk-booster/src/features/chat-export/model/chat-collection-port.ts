import type { ChatCollectionPort, ChatCollectionSnapshot } from '@kobaproduction/browser-archive'
import type { ArchiveApi, ArchiveStatus } from './types'

/** Adapter only. VK owns authenticated peer selection, limits and paging. */
export function vkChatCollectionPort(api: ArchiveApi, limit: () => number | 'all'): ChatCollectionPort {
  const map = (s: ArchiveStatus): ChatCollectionSnapshot => ({
    phase: s.busy
      ? 'running'
      : s.progress.phase === 'Dexie: ошибка' || s.progress.phase === 'Ошибка'
        ? 'error'
        : s.progress.phase === 'Dexie: остановлено'
          ? 'cancelled'
          : s.progress.phase === 'Dexie: сохранено' ||
              s.progress.phase === 'Dexie: частично' ||
              s.progress.phase === 'Готово'
            ? 'completed'
            : 'idle',
    processed: s.progress.done,
    total: s.progress.total > 0 ? s.progress.total : null,
    saved: s.progress.newCount ?? null,
  })
  return {
    start: async () => {
      await api.captureFixed(limit())
    },
    stop: () => api.stop(),
    snapshot: () => map(api.status()),
    subscribe(listener) {
      return api.subscribe((status) => listener(map(status)))
    },
  }
}
