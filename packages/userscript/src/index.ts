import {
  type BoosterModule,
  BoosterRuntime,
  createDiagnosticsStore,
  isChatGptPage,
  OPEN_SETTINGS_EVENT,
} from '@chatgpt-booster/core'
import {
  ConversationArchiveModule,
  ConversationArchiveStore,
  createArchiveUiAdapter,
  HistoryLoaderModule,
  ToolInspectorModule,
  TransportObserverModule,
} from '@chatgpt-booster/features'
import { installTransportObserver } from '@chatgpt-booster/observer'
import {
  type MountedBoosterUi,
  mountBoosterUi,
  resolveLocale,
  translate,
} from '@chatgpt-booster/ui'
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

const diagnostics = createDiagnosticsStore()
const archiveStore = new ConversationArchiveStore()
const archiveUiAdapter = createArchiveUiAdapter(archiveStore)
const telemetry = createUserscriptTelemetry(userscriptSettings)
const telemetryControl = createUserscriptTelemetryControl(telemetry)

class OverlayModule implements BoosterModule {
  readonly id = 'overlay'
  #mounted: MountedBoosterUi | undefined

  start() {
    if (!isChatGptPage() || this.#mounted) return
    this.#mounted = mountBoosterUi({
      settingsAdapter: userscriptSettings,
      diagnosticsAdapter: diagnostics,
      persistentDiagnosticsAdapter: userscriptAnalytics,
      secretAdapter: userscriptSecrets,
      telemetryControlAdapter: telemetryControl,
      archiveAdapter: archiveUiAdapter,
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

function startRuntime() {
  const runtime = new BoosterRuntime(
    [
      new OverlayModule(),
      new ConversationArchiveModule(archiveStore),
      new HistoryLoaderModule(archiveStore),
      new TransportObserverModule({
        settings: userscriptSettings,
        diagnostics,
        persistentDiagnostics: userscriptAnalytics,
        telemetry,
      }),
      new ToolInspectorModule(userscriptSettings),
    ],
    (module, error) => {
      console.error('[ChatGPT Booster] Module failed:', module.id, error)
      void telemetry
        .emit({
          scope: 'runtime',
          name: 'module.error',
          timestamp: Date.now(),
          severity: 'ERROR',
          attributes: {
            'module.id': module.id,
            'error.type': error instanceof Error ? error.name : 'unknown',
          },
          body: error instanceof Error ? error.message : 'Module failed',
        })
        .catch(() => undefined)
    },
  )

  void runtime.start()
}

if (isChatGptPage()) {
  installTransportObserver(unsafeWindow as Window & typeof globalThis)
  void registerUserscriptMenu()

  if (document.body) startRuntime()
  else window.addEventListener('DOMContentLoaded', startRuntime, { once: true })
}
