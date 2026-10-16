import {
  APPLICATION_BACKUP,
  APPLICATION_LOCALE,
  APPLICATION_TELEMETRY,
  type ApplicationBackupController,
  type ApplicationTelemetryController,
  type FeatureRuntime,
  shellInstanceKey,
} from '@kobaproduction/browser-core'
import { UI_PORTAL_TARGET } from '@kobaproduction/browser-ui'
import { type App, type Component, createApp, h } from 'vue'
import type { ApplicationIdentity } from './application'
import Overlay from './Overlay.vue'
import styles from './styles.css?inline'

export interface ControlCenterOptions {
  runtime: FeatureRuntime
  title?: string
  application?: ApplicationIdentity
  launcher?: boolean
  views?: Record<string, Component>
  telemetry?: ApplicationTelemetryController
  backup?: ApplicationBackupController
}
export interface ControlCenter {
  open(): void
  openSettings(categoryId?: string): void
  openMenu(): void
  close(): void
  destroy(): void
}

export function mountControlCenter(options: ControlCenterOptions): ControlCenter {
  document.getElementById(shellInstanceKey('koba-browser-tools-root'))?.remove()
  const host = document.createElement('div')
  host.id = shellInstanceKey('koba-browser-tools-root')
  host.style.cssText =
    'position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;overflow:visible!important'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)
  const node = document.createElement('div')
  shadow.append(node)
  const portal = document.createElement('div')
  portal.style.cssText =
    'position:fixed;inset:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:auto'
  shadow.append(portal)
  document.documentElement.append(host)

  type PanelController = {
    openPanel(): void
    closePanel(): void
    openSettings(categoryId?: string): void
    openMenu(): void
  }
  const component = { current: null as PanelController | null }
  const app: App = createApp({
    render: () =>
      h(Overlay, {
        ref: (instance: unknown) => {
          component.current = instance as PanelController | null
        },
        runtime: options.runtime,
        title: options.title || 'Browser Tools',
        application: options.application,
        launcher: options.launcher ?? true,
        views: options.views || {},
      }),
  })
  app.provide(APPLICATION_TELEMETRY, options.telemetry ?? null)
  app.provide(APPLICATION_BACKUP, options.backup ?? null)
  app.provide(APPLICATION_LOCALE, {
    current: () => options.runtime.shellPreferences().language,
    subscribe: (listener: () => void) => options.runtime.subscribe(listener),
  })
  app.provide(UI_PORTAL_TARGET, portal)
  app.mount(node)
  return {
    open() {
      component.current?.openSettings?.()
    },
    openSettings(categoryId) {
      component.current?.openSettings?.(categoryId)
    },
    openMenu() {
      component.current?.openMenu?.()
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
