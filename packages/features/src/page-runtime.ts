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
import { ConversationStateStore } from './conversation-state'
import { HistoryLoaderModule } from './history-loader'
import { TransportObserverModule } from './transport-observer'

/**
 * Browser-target HAL. The shared page runtime owns feature composition; targets provide only
 * persistence, diagnostics/telemetry capabilities and the page-world bridge when required.
 */
export interface BoosterTargetAdapter {
  label: string
  settings: SettingsAdapter
  diagnostics: TransportDiagnosticsAdapter
  persistentDiagnostics?: PersistentDiagnosticsAdapter
  secrets?: SecretAdapter
  telemetry?: OtlpTelemetryClient
  telemetryControl?: TelemetryControlAdapter
  pageBridgeWindow?: Window
}

export interface BoosterPageRuntimeOptions {
  target: BoosterTargetAdapter
  archiveStore?: ConversationArchiveStore
}

class OverlayModule implements BoosterModule {
  readonly id = 'overlay'
  #mounted: MountedBoosterUi | undefined
  #scheduled: ScheduledIdleTask | undefined

  constructor(
    private readonly target: BoosterTargetAdapter,
    private readonly archiveAdapter: ReturnType<typeof createArchiveUiAdapter>,
  ) {}

  start() {
    if (!isChatGptPage() || this.#mounted || this.#scheduled) return
    this.#scheduled = scheduleIdleTask(() => {
      this.#scheduled = undefined
      if (this.#mounted || !isChatGptPage()) return
      this.#mounted = mountBoosterUi({
        settingsAdapter: this.target.settings,
        diagnosticsAdapter: this.target.diagnostics,
        archiveAdapter: this.archiveAdapter,
        targetLabel: this.target.label,
        ...(this.target.persistentDiagnostics
          ? { persistentDiagnosticsAdapter: this.target.persistentDiagnostics }
          : {}),
        ...(this.target.secrets ? { secretAdapter: this.target.secrets } : {}),
        ...(this.target.telemetryControl
          ? { telemetryControlAdapter: this.target.telemetryControl }
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
  const target = options.target
  const pageBridgeWindow = target.pageBridgeWindow ?? window
  const archiveStore = options.archiveStore ?? new ConversationArchiveStore()
  const archiveWarmup = archiveStore.warmup().catch((error) => {
    console.warn(
      '[ChatGPT Booster] Archive database warmup failed',
      error instanceof Error ? error.name : 'unknown',
    )
  })
  const conversationState = new ConversationStateStore(pageBridgeWindow, archiveStore.sourceGate)
  const settings = createCachedSettingsAdapter(target.settings)
  const runtimeTarget: BoosterTargetAdapter = { ...target, settings }
  const archiveCapture = new ConversationArchiveModule(
    archiveStore,
    settings,
    conversationState,
    pageBridgeWindow,
  )
  const archiveAdapter = createArchiveUiAdapter(archiveStore, archiveCapture, {
    assetFetchTarget: pageBridgeWindow,
    stateStore: conversationState,
  })

  const modules: BoosterModule[] = [
    conversationState,
    new OverlayModule(runtimeTarget, archiveAdapter),
    archiveCapture,
    new ArchiveScopeControlsModule(settings, archiveStore, conversationState),
    new HistoryLoaderModule(conversationState, archiveCapture, pageBridgeWindow, settings),
    new TransportObserverModule({
      settings,
      diagnostics: target.diagnostics,
      ...(target.persistentDiagnostics
        ? { persistentDiagnostics: target.persistentDiagnostics }
        : {}),
      ...(target.telemetry ? { telemetry: target.telemetry } : {}),
    }),
    new ConversationDecoratorsModule(settings, archiveStore, conversationState),
  ]

  const runtime = new BoosterRuntime(modules, (module, error) => {
    console.error('[ChatGPT Booster] Module failed:', module.id, error)
    void target.telemetry
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
    startEarly: async () => {
      conversationState.start()
      void archiveWarmup
      await archiveCapture.start()
    },
    settings,
  }
}
