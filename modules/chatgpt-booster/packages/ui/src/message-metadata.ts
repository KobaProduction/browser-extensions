import type { AgentActivitySnapshot, ConversationItemMetadataView } from '@chatgpt-booster/core'
import { ensureSiteDecoration, UI_PORTAL_TARGET } from '@kobaproduction/browser-ui'
import { createApp, h, shallowReactive } from 'vue'
import type { SupportedLocale } from './i18n'
import MessageMetadata from './MessageMetadata.vue'
import { createBoosterShadowSurface } from './shadow-styles'

export interface LiveMessageMetadataView extends ConversationItemMetadataView {
  raw?: unknown
  activity?: AgentActivitySnapshot | null
  summaryIntervalMs?: number | null
}

export interface MountedMessageMetadata {
  element: HTMLElement
  update(metadata: LiveMessageMetadataView): void
  updateActivity(activity: AgentActivitySnapshot | null): void
  tick(now: number): void
  unmount(): void
}

export function mountMessageMetadata(
  into: HTMLElement,
  initial: LiveMessageMetadataView,
  locale: SupportedLocale,
): MountedMessageMetadata {
  return ensureSiteDecoration({
    anchor: into,
    kind: 'chatgpt-booster:message-metadata',
    identity: locale,
    legacySelector: '[data-chatgpt-booster="message-metadata"]',
    update: (current) => current.update(initial),
    create: () => {
      const host = document.createElement('span')
      host.dataset.chatgptBooster = 'message-metadata'
      host.style.cssText =
        'display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;width:auto;min-width:0;height:28px;margin:0;'
      into.append(host)
      const { mountPoint, portal, dispose } = createBoosterShadowSurface(host)
      const state = shallowReactive({ metadata: initial, now: Date.now() })
      const app = createApp({
        render: () => h(MessageMetadata, { metadata: state.metadata, now: state.now, locale }),
      })
      app.provide(UI_PORTAL_TARGET, portal)
      app.mount(mountPoint)
      return {
        element: host,
        update(next) {
          state.metadata = { ...next, activity: next.activity ?? state.metadata.activity ?? null }
        },
        updateActivity(activity) {
          state.metadata = { ...state.metadata, activity }
        },
        tick(now) {
          if (state.metadata.activity?.active) state.now = now
        },
        unmount() {
          app.unmount()
          dispose()
          host.remove()
        },
      }
    },
  })
}
