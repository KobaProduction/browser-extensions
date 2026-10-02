import {
  type BoosterModule,
  BoosterRuntime,
  isChatGptPage,
  OPEN_SETTINGS_EVENT,
} from '@chatgpt-booster/core'
import { ToolInspectorModule } from '@chatgpt-booster/features'
import {
  type MountedBoosterUi,
  mountBoosterUi,
  resolveLocale,
  translate,
} from '@chatgpt-booster/ui'
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

async function registerUserscriptMenu() {
  if (typeof GM_registerMenuCommand !== 'function') return

  const settings = await userscriptSettings.get()
  const locale = resolveLocale(settings.language)

  GM_registerMenuCommand(
    translate(locale, 'menu.openSettings'),
    () => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT)),
    {
      accessKey: 's',
      autoClose: true,
      title: translate(locale, 'menu.openSettingsTitle'),
    },
  )
}

if (isChatGptPage()) {
  void registerUserscriptMenu()
  void new BoosterRuntime([
    new OverlayModule(),
    new ToolInspectorModule(userscriptSettings),
  ]).start()
}
