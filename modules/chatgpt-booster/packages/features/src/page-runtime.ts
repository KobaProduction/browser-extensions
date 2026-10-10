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
import { ArchiveCollectionSession } from './archive-collection-session'
import { ArchiveScopeControlsModule } from './archive-scope-controls'
import { ArchiveSourceGate, NATIVE_HISTORY_CONTRACT_VERSION } from './archive-source-contract'
import { ArchiveV4CaptureModule } from './archive-v4-capture'
import { ArchiveV4Reader } from './archive-v4-reader'
import { ArchiveV4Store } from './archive-v4-store'
import { createArchiveV4UiAdapter } from './archive-v4-ui-adapter'
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
  archiveV4Store?: ArchiveV4Store
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
  // An injected store owns its gate. Reject conflicting composition instead of
  // writing provenance for an adapter different from the one that validated RAM.
  if (
    options.archiveV4Store &&
    options.nativeHistoryContractVersion !== undefined &&
    options.archiveV4Store.sourceGate.version !== selectedContract
  )
    throw new Error('Archive source adapter configuration mismatch')
  const archiveStore =
    options.archiveV4Store ?? new ArchiveV4Store(new ArchiveSourceGate(false, selectedContract))
  const archiveWarmup = archiveStore.warmup().catch((error) => {
    console.warn(
      '[ChatGPT Booster] Archive v4 database warmup failed',
      error instanceof Error ? error.name : 'unknown',
    )
  })
  const conversationState = new ConversationStateStore(pageBridgeWindow, archiveStore.sourceGate)
  const settings = createCachedSettingsAdapter(target.settings)
  const runtimeTarget: BoosterTargetAdapter = { ...target, settings }
  const collectionSession = new ArchiveCollectionSession()
  const archiveCapture = new ArchiveV4CaptureModule(
    archiveStore,
    conversationState,
    settings,
    collectionSession,
  )
  const archiveReader = new ArchiveV4Reader(archiveStore, conversationState)
  const archiveAdapter = createArchiveV4UiAdapter(
    archiveStore,
    archiveCapture,
    archiveReader,
    conversationState,
    settings,
  )

  const modules: BoosterModule[] = [
    conversationState,
    ...(options.mountUi === false ? [] : [new OverlayModule(runtimeTarget, archiveAdapter)]),
    archiveCapture,
    new ArchiveScopeControlsModule(settings, archiveAdapter, conversationState),
    new HistoryLoaderModule(conversationState, archiveCapture, pageBridgeWindow, settings, false),
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
      void archiveWarmup
      await archiveCapture.start()
    },
    settings,
    archiveAdapter,
  }
}
