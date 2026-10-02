import { type BoosterModule, BoosterRuntime, isChatGptPage } from '@chatgpt-booster/core'
import { type MountedBoosterUi, mountBoosterUi } from '@chatgpt-booster/ui'
import { userscriptSettings } from './settings'

class OverlayModule implements BoosterModule {
  readonly id = 'overlay'
  #mounted: MountedBoosterUi | undefined
  #unsubscribe: (() => void) | undefined

  async start() {
    if (!isChatGptPage()) return

    const apply = (enabled: boolean) => {
      if (enabled && !this.#mounted) this.#mounted = mountBoosterUi()
      if (!enabled && this.#mounted) {
        this.#mounted.unmount()
        this.#mounted = undefined
      }
    }

    apply((await userscriptSettings.get()).enabled)
    this.#unsubscribe = userscriptSettings.subscribe((settings) => apply(settings.enabled))
  }

  stop() {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#mounted?.unmount()
    this.#mounted = undefined
  }
}

void new BoosterRuntime([new OverlayModule()]).start()
