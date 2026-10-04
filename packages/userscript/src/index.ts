import {
  BOOSTER_VERSION,
  type BoosterModule,
  BoosterRuntime,
  createDiagnosticsStore,
  isChatGptPage,
  OPEN_SETTINGS_EVENT,
} from '@chatgpt-booster/core'
import {
  ArchiveScopeControlsModule,
  ConversationArchiveModule,
  ConversationArchiveStore,
  ConversationDecoratorsModule,
  createArchiveUiAdapter,
  HistoryLoaderModule,
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
const archiveCapture = new ConversationArchiveModule(archiveStore, userscriptSettings)
const archiveUiAdapter = createArchiveUiAdapter(archiveStore, archiveCapture)
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
      archiveCapture,
      new ArchiveScopeControlsModule(userscriptSettings, archiveStore),
      new HistoryLoaderModule(archiveStore, archiveCapture),
      new TransportObserverModule({
        settings: userscriptSettings,
        diagnostics,
        persistentDiagnostics: userscriptAnalytics,
        telemetry,
      }),
      new ConversationDecoratorsModule(userscriptSettings, archiveStore),
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
  document.documentElement.dataset.chatgptBoosterUserscriptVersion = BOOSTER_VERSION

  // Tampermonkey and the extension have different injection mechanics. A failure to
  // acquire the page window for transport interception must not prevent the UI and
  // DOM-based archive fallback from starting.
  try {
    installTransportObserver(unsafeWindow as Window & typeof globalThis)
    document.documentElement.dataset.chatgptBoosterUserscriptObserver = 'installed'
  } catch (error) {
    document.documentElement.dataset.chatgptBoosterUserscriptObserver = 'failed'
    console.error('[ChatGPT Booster] Tampermonkey transport observer failed', error)
  }

  void archiveCapture.start().catch((error) => {
    console.error('[ChatGPT Booster] Early archive capture bootstrap failed', error)
  })
  void registerUserscriptMenu().catch((error) => {
    console.error('[ChatGPT Booster] Tampermonkey menu registration failed', error)
  })

  if (document.body) startRuntime()
  else window.addEventListener('DOMContentLoaded', startRuntime, { once: true })
}