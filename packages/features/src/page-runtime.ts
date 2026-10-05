import { type ScheduledIdleTask, scheduleIdleTask } from '@chatgpt-booster/chatgpt'
import {
  type BoosterModule,
  BoosterRuntime,
  createCachedSettingsAdapter,
  isChatGptPage,
  type PersistentDiagnosticsAdapter,
  type SecretAdapter,
  type SettingsAdapter,
  type TelemetryControlAdapter,
  type TransportDiagnosticsAdapter,
} from '@chatgpt-booster/core'
import type { OtlpTelemetryClient } from '@chatgpt-booster/telemetry'
import { type MountedBoosterUi, mountBoosterUi } from '@chatgpt-booster/ui'
import { ArchiveScopeControlsModule } from './archive-scope-controls'
import { ConversationArchiveStore } from './archive-store'
import { createArchiveUiAdapter } from './archive-ui-adapter'
import { ConversationArchiveModule } from './conversation-archive'
import { ConversationDecoratorsModule } from './conversation-decorators'
import { HistoryLoaderModule } from './history-loader'
import { TransportObserverModule } from './transport-observer'

export interface BoosterPageRuntimeOptions {
  target: 'extension' | 'userscript'
  settings: SettingsAdapter
  diagnostics: TransportDiagnosticsAdapter
  persistentDiagnostics?: PersistentDiagnosticsAdapter
  secrets?: SecretAdapter
  telemetry?: OtlpTelemetryClient
  telemetryControl?: TelemetryControlAdapter
  pageBridgeWindow?: Window
  archiveStore?: ConversationArchiveStore
}

class OverlayModule implements BoosterModule {
  readonly id = 'overlay'
  #mounted: MountedBoosterUi | undefined
  #scheduled: ScheduledIdleTask | undefined

  constructor(
    private readonly options: BoosterPageRuntimeOptions,
    private readonly archiveAdapter: ReturnType<typeof createArchiveUiAdapter>,
  ) {}

  start() {
    if (!isChatGptPage() || this.#mounted || this.#scheduled) return
    this.#scheduled = scheduleIdleTask(() => {
      this.#scheduled = undefined
      if (this.#mounted || !isChatGptPage()) return
      this.#mounted = mountBoosterUi({
        settingsAdapter: this.options.settings,
        diagnosticsAdapter: this.options.diagnostics,
        archiveAdapter: this.archiveAdapter,
        target: this.options.target,
        ...(this.options.persistentDiagnostics
          ? { persistentDiagnosticsAdapter: this.options.persistentDiagnostics }
          : {}),
        ...(this.options.secrets ? { secretAdapter: this.options.secrets } : {}),
        ...(this.options.telemetryControl
          ? { telemetryControlAdapter: this.options.telemetryControl }
          : {}),
      })
    }, 300)
  }

  stop() {
    this.#scheduled?.cancel()
    this.#scheduled = undefined
    this.#mounted?.unmount()
    this.#mounted = undefined
  }
}

export function createBoosterPageRuntime(options: BoosterPageRuntimeOptions) {
  const pageBridgeWindow = options.pageBridgeWindow ?? window
  const archiveStore = options.archiveStore ?? new ConversationArchiveStore()
  const settings = createCachedSettingsAdapter(options.settings)
  const runtimeOptions: BoosterPageRuntimeOptions = { ...options, settings }
  const archiveCapture = new ConversationArchiveModule(archiveStore, settings, pageBridgeWindow)
  const archiveAdapter = createArchiveUiAdapter(archiveStore, archiveCapture, {
    assetFetchTarget: pageBridgeWindow,
  })

  const modules: BoosterModule[] = [
    new OverlayModule(runtimeOptions, archiveAdapter),
    archiveCapture,
    new ArchiveScopeControlsModule(settings, archiveStore),
    new HistoryLoaderModule(archiveStore, archiveCapture, pageBridgeWindow),
    new TransportObserverModule({
      settings,
      diagnostics: options.diagnostics,
      ...(options.persistentDiagnostics
        ? { persistentDiagnostics: options.persistentDiagnostics }
        : {}),
      ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    }),
    new ConversationDecoratorsModule(settings, archiveStore),
  ]

  const runtime = new BoosterRuntime(modules, (module, error) => {
    console.error('[ChatGPT Booster] Module failed:', module.id, error)
    void options.telemetry
      ?.emit({
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
  })

  return {
    runtime,
    archiveStore,
    archiveCapture,
    archiveAdapter,
    pageBridgeWindow,
    settings,
  }
}
