import {
  type BoosterModule,
  BoosterRuntime,
  createDiagnosticsStore,
  isChatGptPage,
} from '@chatgpt-booster/core'
import {
  ArchiveScopeControlsModule,
  ConversationArchiveModule,
  ConversationArchiveStore,
  createArchiveUiAdapter,
  HistoryLoaderModule,
  ToolInspectorModule,
  TransportObserverModule,
} from '@chatgpt-booster/features'
import { type MountedBoosterUi, mountBoosterUi } from '@chatgpt-booster/ui'
import { chromeAnalytics } from '../analytics'
import { chromeSettings } from '../settings'
import { chromeSecrets, createChromeTelemetry, createChromeTelemetryControl } from '../telemetry'

const diagnostics = createDiagnosticsStore()
const archiveStore = new ConversationArchiveStore()
const archiveCapture = new ConversationArchiveModule(archiveStore, chromeSettings)
const archiveUiAdapter = createArchiveUiAdapter(archiveStore, archiveCapture)
const telemetry = createChromeTelemetry(chromeSettings)
const telemetryControl = createChromeTelemetryControl(telemetry)

class OverlayModule implements BoosterModule {
  readonly id = 'overlay'
  #mounted: MountedBoosterUi | undefined

  start() {
    if (!isChatGptPage() || this.#mounted) return
    this.#mounted = mountBoosterUi({
      settingsAdapter: chromeSettings,
      diagnosticsAdapter: diagnostics,
      persistentDiagnosticsAdapter: chromeAnalytics,
      secretAdapter: chromeSecrets,
      telemetryControlAdapter: telemetryControl,
      archiveAdapter: archiveUiAdapter,
      target: 'extension',
    })
  }

  stop() {
    this.#mounted?.unmount()
    this.#mounted = undefined
  }
}

function startRuntime() {
  const runtime = new BoosterRuntime(
    [
      new OverlayModule(),
      archiveCapture,
      new ArchiveScopeControlsModule(chromeSettings, archiveStore),
      new HistoryLoaderModule(archiveStore, archiveCapture),
      new TransportObserverModule({
        settings: chromeSettings,
        diagnostics,
        persistentDiagnostics: chromeAnalytics,
        telemetry,
      }),
      new ToolInspectorModule(chromeSettings),
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
  void archiveCapture.start()
  if (document.body) startRuntime()
  else window.addEventListener('DOMContentLoaded', startRuntime, { once: true })
}
