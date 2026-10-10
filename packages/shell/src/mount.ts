import { type FeatureRuntime, instanceKey } from '@kobaproduction/browser-core'
import { type App, type Component, createApp, h } from 'vue'
import Overlay from './Overlay.vue'
import styles from './styles.css?inline'

export interface ControlCenterOptions {
  runtime: FeatureRuntime
  title?: string
  launcher?: boolean
  views?: Record<string, Component>
}
export interface ControlCenter {
  open(): void
  close(): void
  destroy(): void
}

export function mountControlCenter(options: ControlCenterOptions): ControlCenter {
  document.getElementById(instanceKey('koba-browser-tools-root'))?.remove()
  const host = document.createElement('div')
  host.id = instanceKey('koba-browser-tools-root')
  host.style.cssText =
    'position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;overflow:visible!important'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)
  const node = document.createElement('div')
  shadow.append(node)
  document.documentElement.append(host)

  type PanelController = { openPanel(): void; closePanel(): void }
  const component = { current: null as PanelController | null }
  const app: App = createApp({
    render: () =>
      h(Overlay, {
        ref: (instance: unknown) => {
          component.current = instance as PanelController | null
        },
        runtime: options.runtime,
        title: options.title || 'Browser Tools',
        launcher: options.launcher ?? true,
        views: options.views || {},
      }),
  })
  app.mount(node)
  return {
    open() {
      component.current?.openPanel?.()
    },
    close() {
      component.current?.closePanel?.()
    },
    destroy() {
      app.unmount()
      host.remove()
    },
  }
}
