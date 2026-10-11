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
import { type ArchiveDataAdapter, type MountedBoosterUi, mountBoosterUi } from '@chatgpt-booster/ui'
import { FixedChatGptCapture } from './archive-fixed-runtime'
import { ArchiveCollectionSession } from './archive-collection-session'
import { ArchiveScopeControlsModule } from './archive-scope-controls'
import { ArchiveSourceGate, NATIVE_HISTORY_CONTRACT_VERSION } from './archive-source-contract'
import { createFixedArchiveUiAdapter } from './archive-fixed-ui-adapter'
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
  /** Shared platform shell owns the launcher and modal for embedded modules. */
  mountUi?: boolean
  /** Explicit release configuration; unknown versions block archive operations, never fall back. */
  nativeHistoryContractVersion?: string
}

class OverlayModule implements BoosterModule {
  readonly id = 'overlay'
  #mounted: MountedBoosterUi | undefined
  #scheduled: ScheduledIdleTask | undefined

  constructor(
    private readonly target: BoosterTargetAdapter,
    private readonly archiveAdapter: ArchiveDataAdapter,
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
  const selectedContract = options.nativeHistoryContractVersion ?? NATIVE_HISTORY_CONTRACT_VERSION
  const conversationState = new ConversationStateStore(
    pageBridgeWindow, new ArchiveSourceGate(false, selectedContract),
  )
  const settings = createCachedSettingsAdapter(target.settings)
  const runtimeTarget: BoosterTargetAdapter = { ...target, settings }
  const collectionSession = new ArchiveCollectionSession()
  const fixedArchive = new FixedChatGptCapture(
    conversationState, settings, target.label, collectionSession,
  )
  const archiveAdapter = createFixedArchiveUiAdapter(fixedArchive, conversationState)

  const modules: BoosterModule[] = [
    conversationState,
    ...(options.mountUi === false ? [] : [new OverlayModule(runtimeTarget, archiveAdapter)]),
    fixedArchive,
    new ArchiveScopeControlsModule(settings, archiveAdapter, conversationState),
    new HistoryLoaderModule(conversationState, fixedArchive, pageBridgeWindow, settings, false),
    new TransportObserverModule({
      settings,
      diagnostics: target.diagnostics,
      ...(target.persistentDiagnostics
        ? { persistentDiagnostics: target.persistentDiagnostics }
        : {}),
      ...(target.telemetry ? { telemetry: target.telemetry } : {}),
    }),
    new ConversationDecoratorsModule(settings, undefined, conversationState),
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
      await fixedArchive.start()
    },
    settings,
    archiveAdapter,
    fixedArchive,
  }
}
