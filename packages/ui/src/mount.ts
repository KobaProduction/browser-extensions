import { type App, createApp } from 'vue'
import BoosterOverlay from './BoosterOverlay.vue'
import styles from './styles.css?inline'

const ROOT_ID = 'chatgpt-booster-root'

export interface MountedBoosterUi {
  unmount(): void
}

export function mountBoosterUi(): MountedBoosterUi {
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

  const app: App = createApp(BoosterOverlay)
  app.mount(mountPoint)

  return {
    unmount() {
      app.unmount()
      host.remove()
    },
  }
}
