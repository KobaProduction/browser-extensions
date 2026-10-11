import type { ArchiveManagerState } from '@kobaproduction/browser-widgets'
import type { ArchiveStatus } from './types'

export interface VkArchiveSummary {
  folder: string
  messages: number
}

/** Projection at the UI boundary. The engine keeps its own private archive
 * state for pause/resume, but the page must never render it for another peer
 * or while permission/folder selection is pending.
 *
 * This is deliberately fail-closed and does not mutate the v1 archive. */
export function presentVkArchive(status: ArchiveStatus): {
  summary: VkArchiveSummary | null
  canRead: boolean
  manager: ArchiveManagerState
} {
  const allowed =
    !status.blockedReason &&
    !status.folderPending &&
    status.folder !== null &&
    status.activePeerId !== null &&
    status.options.peerId === status.activePeerId

  if (!allowed || status.folder === null) {
    return {
      summary: null,
      canRead: false,
      manager: {
        context: 'Диалог недоступен',
        folder: null,
        messages: 0,
        busy: status.busy,
        folderPending: status.folderPending,
        paused: false,
        blockedReason: status.blockedReason || 'Открой соответствующий диалог VK.',
        phase: 'Архив недоступен',
        done: 0,
        total: 0,
        newCount: 0,
        downloaded: 0,
        failed: 0,
      },
    }
  }

  const progress = status.progress
  return {
    summary: { folder: status.folder, messages: status.messages },
    canRead: status.messages > 0,
    manager: {
      context: 'Диалог ' + status.options.peerId,
      folder: status.folder,
      messages: status.messages,
      busy: status.busy,
      folderPending: status.folderPending,
      paused: status.checkpoint?.status === 'paused',
      blockedReason: status.blockedReason,
      phase: progress.phase,
      done: progress.done,
      total: progress.total,
      newCount: progress.newCount ?? 0,
      downloaded: progress.downloaded ?? 0,
      failed: progress.failed ?? 0,
      error: progress.error,
    },
  }
}
