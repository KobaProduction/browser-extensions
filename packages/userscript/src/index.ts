import {
  type BoosterModule,
  BoosterRuntime,
  isChatGptPage,
  OPEN_SETTINGS_EVENT,
} from '@chatgpt-booster/core'
import { ToolInspectorModule } from '@chatgpt-booster/features'
import { type MountedBoosterUi, mountBoosterUi } from '@chatgpt-booster/ui'
import { userscriptSettings } from './settings'

declare function GM_registerMenuCommand(
  name: string,
  callback: (event?: MouseEvent | KeyboardEvent) => void,
  options?: {
    accessKey?: string
    autoClose?: boolean
    title?: string
  },
): number | string

class OverlayModule implements BoosterModule {
  readonly id = 'overlay'
  #mounted: MountedBoosterUi | undefined

  start() {
    if (!isChatGptPage() || this.#mounted) return
    this.#mounted = mountBoosterUi({
      settingsAdapter: userscriptSettings,
      target: 'userscript',
    })
  }

  stop() {
    this.#mounted?.unmount()
    this.#mounted = undefined
  }
}

function registerUserscriptMenu() {
  if (typeof GM_registerMenuCommand !== 'function') return

  GM_registerMenuCommand(
    'ChatGPT Booster: Open settings',
    () => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT)),
    {
      accessKey: 's',
      autoClose: true,
      title: 'Open ChatGPT Booster Control Center',
    },
  )
}

if (isChatGptPage()) {
  registerUserscriptMenu()
  void new BoosterRuntime([
    new OverlayModule(),
    new ToolInspectorModule(userscriptSettings),
  ]).start()
}
