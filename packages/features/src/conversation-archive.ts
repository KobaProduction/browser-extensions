import type { BoosterModule } from '@chatgpt-booster/core'
import {
  ARCHIVE_EVENT,
  type ConversationArchiveEventDetail,
  TRANSPORT_CHANNEL,
} from '@chatgpt-booster/observer'
import { ConversationArchiveStore } from './archive-store'

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

    void this.store.ingest(detail).catch((error) => {
      console.warn('[ChatGPT Booster] Conversation archive ingest failed', error)
    })
  }
}
