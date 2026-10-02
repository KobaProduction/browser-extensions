import type { BoosterModule } from '@chatgpt-booster/core'
import { BoosterRuntime, isChatGptPage } from '@chatgpt-booster/core'
import { ToolInspectorModule } from '@chatgpt-booster/features'
import { type MountedBoosterUi, mountBoosterUi } from '@chatgpt-booster/ui'
import { chromeSettings } from '../settings'

class OverlayModule implements BoosterModule {
  readonly id = 'overlay'
  #mounted: MountedBoosterUi | undefined

  start() {
    if (!isChatGptPage() || this.#mounted) return
    this.#mounted = mountBoosterUi({
      settingsAdapter: chromeSettings,
      target: 'extension',
    })
  }

  stop() {
    this.#mounted?.unmount()
    this.#mounted = undefined
  }
}

if (isChatGptPage()) {
  void new BoosterRuntime([new OverlayModule(), new ToolInspectorModule(chromeSettings)]).start()
}
