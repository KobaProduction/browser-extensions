import type { BoosterModule } from '@chatgpt-booster/core'
import {
  ARCHIVE_EVENT,
  type ConversationArchiveEventDetail,
  TRANSPORT_CHANNEL,
} from '@chatgpt-booster/observer'
import { ConversationArchiveStore } from './archive-store'

function visibleProjectTitle(projectId: string): string | null {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/g/"]')) {
    if (!link.href.includes(projectId)) continue
    if (!new URL(link.href, location.href).pathname.endsWith('/project')) continue
    const title = link.textContent?.trim()
    if (title) return title
  }
  return null
}

export class ConversationArchiveModule implements BoosterModule {
  readonly id = 'conversation-archive'
  readonly store: ConversationArchiveStore

  constructor(store = new ConversationArchiveStore()) {
    this.store = store
  }

  start() {
    window.addEventListener('message', this.#onMessage)
  }

  stop() {
    window.removeEventListener('message', this.#onMessage)
  }

  #onMessage = (event: MessageEvent) => {
    if (event.origin && event.origin !== window.location.origin) return
    const data = event.data as {
      channel?: string
      type?: string
      detail?: ConversationArchiveEventDetail
    }
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== ARCHIVE_EVENT) return
    const detail = data.detail
    if (detail?.kind !== 'conversation-page') return

    void this.store
      .ingest(detail)
      .then(async (summary) => {
        if (!summary.projectId) return
        await this.store.upsertProject(summary.projectId, visibleProjectTitle(summary.projectId))
      })
      .catch((error) => {
        console.warn('[ChatGPT Booster] Conversation archive ingest failed', error)
      })
  }
}
