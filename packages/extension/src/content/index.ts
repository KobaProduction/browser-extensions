import {
  type BoosterModule,
  BoosterRuntime,
  BOOSTER_VERSION,
  createDiagnosticsStore,
  isChatGptPage,
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

const CONTENT_RUNTIME_MARKER = '__chatgptBoosterContentRuntime__'

interface ContentRuntimeHandle {
  version: string
  runtime?: BoosterRuntime
}

const runtimeWindow = window as unknown as Window & Record<string, unknown>

function cleanupStaleBoosterDom() {
  for (const element of document.querySelectorAll(
    '#chatgpt-booster-root, [data-chatgpt-booster]',
  ))
    element.remove()
}

async function startRuntime(handle: ContentRuntimeHandle) {
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
      new ConversationDecoratorsModule(chromeSettings, archiveStore),
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
  handle.runtime = runtime
  await runtime.start()
}

async function bootstrapContentRuntime() {
  if (!isChatGptPage()) return
  const existing = runtimeWindow[CONTENT_RUNTIME_MARKER] as ContentRuntimeHandle | undefined
  if (existing?.version === BOOSTER_VERSION) return

  if (existing?.runtime)
    try {
      await existing.runtime.stop()
    } catch {
      // A previous extension context may already be invalid after an update/reload.
    }

  cleanupStaleBoosterDom()
  const handle: ContentRuntimeHandle = { version: BOOSTER_VERSION }
  runtimeWindow[CONTENT_RUNTIME_MARKER] = handle

  // Publish archive policy as early as possible, before the UI waits for document.body.
  await archiveCapture.start()

  const launch = () => {
    if (runtimeWindow[CONTENT_RUNTIME_MARKER] !== handle) return
    void startRuntime(handle)
  }
  if (document.body) launch()
  else window.addEventListener('DOMContentLoaded', launch, { once: true })
}

void bootstrapContentRuntime()
