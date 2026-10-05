import {
  BOOSTER_VERSION,
  createDiagnosticsStore,
  isChatGptPage,
  OPEN_SETTINGS_EVENT,
} from '@chatgpt-booster/core'
import { createBoosterPageRuntime } from '@chatgpt-booster/features'
import { installTransportObserver } from '@chatgpt-booster/observer'
import { resolveLocale, translate } from '@chatgpt-booster/ui'
import { userscriptAnalytics } from './analytics'
import { userscriptSettings } from './settings'
import {
  createUserscriptTelemetry,
  createUserscriptTelemetryControl,
  userscriptSecrets,
} from './telemetry'

declare const unsafeWindow: Window
declare function GM_registerMenuCommand(
  name: string,
  callback: (event?: MouseEvent | KeyboardEvent) => void,
  options?: {
    accessKey?: string
    autoClose?: boolean
    title?: string
  },
): number | string

const pageWindow = unsafeWindow as Window & typeof globalThis
const diagnostics = createDiagnosticsStore()
const telemetry = createUserscriptTelemetry(userscriptSettings)
const pageRuntime = createBoosterPageRuntime({
  target: 'userscript',
  settings: userscriptSettings,
  diagnostics,
  persistentDiagnostics: userscriptAnalytics,
  secrets: userscriptSecrets,
  telemetry,
  telemetryControl: createUserscriptTelemetryControl(telemetry),
  pageBridgeWindow: pageWindow,
})

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

function startRuntime() {
  void pageRuntime.runtime.start()
}

if (isChatGptPage()) {
  document.documentElement.dataset.chatgptBoosterUserscriptVersion = BOOSTER_VERSION

  // Tampermonkey owns page-world access directly; the native extension installs the same
  // observer from its MAIN-world content-script entry instead. Everything after this HAL
  // boundary uses the shared page runtime.
  try {
    installTransportObserver(pageWindow)
    document.documentElement.dataset.chatgptBoosterUserscriptObserver = 'installed'
  } catch (error) {
    document.documentElement.dataset.chatgptBoosterUserscriptObserver = 'failed'
    console.error('[ChatGPT Booster] Tampermonkey transport observer failed', error)
  }

  void pageRuntime.archiveCapture.start().catch((error) => {
    console.error('[ChatGPT Booster] Early archive capture bootstrap failed', error)
  })
  void registerUserscriptMenu().catch((error) => {
    console.error('[ChatGPT Booster] Tampermonkey menu registration failed', error)
  })

  if (document.body) startRuntime()
  else window.addEventListener('DOMContentLoaded', startRuntime, { once: true })
}
