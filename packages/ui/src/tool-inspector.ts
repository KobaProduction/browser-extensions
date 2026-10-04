import type { ToolInvocationView } from '@chatgpt-booster/core'
import { type App, createApp } from 'vue'
import type { SupportedLocale } from './i18n'
import styles from './styles.css?inline'
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
}

export interface MountedToolInspector {
  element: HTMLElement
  unmount(): void
}

export function mountToolInspector(
  after: HTMLElement,
  model: ToolCallViewModel,
): MountedToolInspector {
  const host = document.createElement('div')
  host.dataset.chatgptBooster = 'tool-inspector'
  host.style.display = 'block'
  host.style.width = '100%'
  after.insertAdjacentElement('afterend', host)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)

  const mountPoint = document.createElement('div')
  shadow.append(mountPoint)

  const app: App = createApp(ToolInspector, { model })
  app.mount(mountPoint)

  return {
    element: host,
    unmount() {
      app.unmount()
      host.remove()
    },
  }
}
