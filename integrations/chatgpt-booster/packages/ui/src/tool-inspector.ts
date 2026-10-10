import type { ToolInvocationView } from '@chatgpt-booster/core'
import { type App, createApp, h, reactive } from 'vue'
import type { SupportedLocale } from './i18n'
import { installBoosterShadowStyles } from './shadow-styles'
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

export function mountToolInspector(
  into: HTMLElement,
  model: ToolCallViewModel,
): MountedToolInspector {
  const host = document.createElement('span')
  host.dataset.chatgptBooster = 'tool-inspector'
  host.style.cssText =
    'display:inline-flex;flex:0 0 auto;align-items:center;position:relative;z-index:2;pointer-events:auto;margin-inline-start:2px;'
  into.append(host)

  const shadow = host.attachShadow({ mode: 'open' })
  installBoosterShadowStyles(shadow)
  const mountPoint = document.createElement('span')
  shadow.append(mountPoint)

  const state = reactive<{ model: ToolCallViewModel; now: number }>({ model, now: 0 })
  const app: App = createApp({
    render: () => h(ToolInspector, { model: state.model, now: state.now }),
  })
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
}
