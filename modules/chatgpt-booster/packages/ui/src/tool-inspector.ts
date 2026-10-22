import type { ToolInvocationView } from '@chatgpt-booster/core'
import { ensureSiteDecoration, UI_PORTAL_TARGET } from '@kobaproduction/browser-ui'
import { type App, createApp, h, reactive } from 'vue'
import type { SupportedLocale } from './i18n'
import { createBoosterShadowSurface } from './shadow-styles'
import ToolInspector from './ToolInspector.vue'

export interface ToolCallViewModel {
  id: string
  tool: ToolInvocationView
  locale: SupportedLocale
  structuredPayloads: string[]
  attributes: Record<string, string>
  visibleText: string
  score: number
  signals: string[]
  active: boolean
}

export interface MountedToolInspector {
  element: HTMLElement
  update(model: ToolCallViewModel): void
  tick(now: number): void
  unmount(): void
}

export function mountToolInspector(into: HTMLElement, model: ToolCallViewModel): MountedToolInspector {
  return ensureSiteDecoration({
    anchor: into,
    kind: 'chatgpt-booster:tool-inspector',
    identity: `${model.locale}:${model.id}`,
    legacySelector: '[data-chatgpt-booster="tool-inspector"]',
    update: (current) => current.update(model),
    create: () => {
      const host = document.createElement('span')
      host.dataset.chatgptBooster = 'tool-inspector'
      host.dataset.sourceMessageId = model.id
      host.style.cssText =
        'display:inline-flex;flex:0 0 auto;align-items:center;pointer-events:auto;margin-inline-start:2px;'
      into.append(host)

      const { mountPoint, portal } = createBoosterShadowSurface(host)

      const state = reactive<{ model: ToolCallViewModel; now: number }>({ model, now: 0 })
      const app: App = createApp({
        render: () => h(ToolInspector, { model: state.model, now: state.now }),
      })
      app.provide(UI_PORTAL_TARGET, portal)
      app.mount(mountPoint)

      return {
        element: host,
        update(next) {
          state.model = next
        },
        tick(now) {
          state.now = now
        },
        unmount() {
          app.unmount()
          host.remove()
        },
      }
    },
  })
}
