import { APPLICATION_LOCALE, type ApplicationLocaleController } from '@kobaproduction/browser-core'
import { createApp } from 'vue'
import type { ApplicationIdentity } from './application'
import BrowserToolsPopup from './BrowserToolsPopup.vue'
import styles from './popup.css?inline'

export interface BrowserToolsPopupOptions {
  openSettings(): Promise<void>
  openMenu(): Promise<void>
  application?: Pick<ApplicationIdentity, 'title' | 'version'>
  locale?: ApplicationLocaleController
}
/** Target commands are supplied by composition; shared presentation owns its registry and theme. */
export function mountBrowserToolsPopup(
  host: HTMLElement,
  options: BrowserToolsPopupOptions,
): { destroy(): void } {
  const previousMargin = host.style.margin
  host.style.margin = '0'
  const container = document.createElement('div')
  const shadow = container.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  const node = document.createElement('div')
  shadow.append(style, node)
  host.replaceChildren(container)
  const { locale, ...presentation } = options
  const app = createApp(BrowserToolsPopup, presentation)
  if (locale) app.provide(APPLICATION_LOCALE, locale)
  app.mount(node)
  return {
    destroy() {
      app.unmount()
      container.remove()
      host.style.margin = previousMargin
    },
  }
}
