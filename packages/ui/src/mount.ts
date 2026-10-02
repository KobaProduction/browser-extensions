import type { SettingsAdapter } from '@chatgpt-booster/core'
import { type App, createApp } from 'vue'
import BoosterOverlay from './BoosterOverlay.vue'
import ControlCenterPanel from './ControlCenterPanel.vue'
import styles from './styles.css?inline'

const ROOT_ID = 'chatgpt-booster-root'

export interface MountedBoosterUi {
  unmount(): void
}

export interface BoosterUiOptions {
  settingsAdapter: SettingsAdapter
  target: 'extension' | 'userscript'
}

function createIsolatedMount(host: HTMLElement) {
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)

  const mountPoint = document.createElement('div')
  shadow.append(mountPoint)
  return mountPoint
}

export function mountBoosterUi(options: BoosterUiOptions): MountedBoosterUi {
  document.getElementById(ROOT_ID)?.remove()

  const host = document.createElement('div')
  host.id = ROOT_ID
  host.style.cssText =
    'position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;overflow:visible!important;'
  document.documentElement.append(host)

  const mountPoint = createIsolatedMount(host)
  const app: App = createApp(BoosterOverlay, { ...options })
  app.mount(mountPoint)

  return {
    unmount() {
      app.unmount()
      host.remove()
    },
  }
}

export function mountControlCenter(host: HTMLElement, options: BoosterUiOptions): MountedBoosterUi {
  const mountPoint = createIsolatedMount(host)
  const app: App = createApp(ControlCenterPanel, {
    ...options,
    showClose: false,
  })
  app.mount(mountPoint)

  return {
    unmount() {
      app.unmount()
      host.replaceChildren()
    },
  }
}
