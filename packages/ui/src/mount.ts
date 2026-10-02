import type { SettingsAdapter } from '@chatgpt-booster/core'
import { type App, createApp } from 'vue'
import BoosterOverlay from './BoosterOverlay.vue'
import styles from './styles.css?inline'

const ROOT_ID = 'chatgpt-booster-root'

export interface MountedBoosterUi {
  unmount(): void
}

export interface BoosterUiOptions {
  settingsAdapter: SettingsAdapter
  target: 'extension' | 'userscript'
}

export function mountBoosterUi(options: BoosterUiOptions): MountedBoosterUi {
  document.getElementById(ROOT_ID)?.remove()

  const host = document.createElement('div')
  host.id = ROOT_ID
  document.documentElement.append(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)

  const mountPoint = document.createElement('div')
  shadow.append(mountPoint)

  const app: App = createApp(BoosterOverlay, { ...options })
  app.mount(mountPoint)

  return {
    unmount() {
      app.unmount()
      host.remove()
    },
  }
}
