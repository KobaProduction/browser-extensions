import type { BoosterModule } from '@chatgpt-booster/core'
import { BoosterRuntime, isChatGptPage } from '@chatgpt-booster/core'
import { ToolInspectorModule } from '@chatgpt-booster/features'
import { type MountedBoosterUi, mountBoosterUi } from '@chatgpt-booster/ui'
import { chromeSettings } from '../settings'

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

    apply((await chromeSettings.get()).enabled)
    this.#unsubscribe = chromeSettings.subscribe((settings) => apply(settings.enabled))
  }

  stop() {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#mounted?.unmount()
    this.#mounted = undefined
  }
}

if (isChatGptPage()) {
  void new BoosterRuntime([new OverlayModule(), new ToolInspectorModule(chromeSettings)]).start()
}
