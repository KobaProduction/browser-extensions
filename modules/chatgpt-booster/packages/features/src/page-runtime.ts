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
import { bindNativeAccountSource } from '@chatgpt-booster/observer'
import type { OtlpTelemetryClient } from '@chatgpt-booster/telemetry'
import { type ArchiveDataAdapter, type MountedBoosterUi, mountBoosterUi } from '@chatgpt-booster/ui'
import { ArchiveCollectionSession } from './archive-collection-session'
import { FixedChatGptCapture } from './archive-fixed-runtime'
import { createFixedArchiveUiAdapter } from './archive-fixed-ui-adapter'
import { ArchiveScopeControlsModule } from './archive-scope-controls'
import { ArchiveSourceGate, NATIVE_HISTORY_CONTRACT_VERSION } from './archive-source-contract'
import { ConversationArchiveWorkspace } from './archive-workspace'
import { ChatGptConversationAutomation } from './conversation-automation'
import {
  type ChatGptNativeMethodAdapter,
  createChatGptNativeCommandPort,
  createChatGptNativeMethodRegistry,
} from './conversation-command-port'
import { ConversationDecoratorsModule } from './conversation-decorators'
import { normalizeConversationMessage } from './conversation-records'
import { ConversationSoundsModule } from './conversation-sounds'
import { ConversationStateStore } from './conversation-state'
import { type ChatGptNativeHistoryPort, HistoryLoaderModule } from './history-loader'
import {
  type ChatGptNativeAccountBindingOptions,
  createChatGptNativeAccountSource,
} from './native-account-binding'
import {
  type ChatGptNativeBindingOptions,
  createChatGptNativeApplicationBinding,
} from './native-binding'
import { NativeHistoryBinding } from './native-history-binding'
import { TransportObserverModule } from './transport-observer'

/**
 * Browser-target HAL. The shared page runtime owns feature composition; targets provide only
 * persistence, diagnostics/telemetry capabilities and the page-world bridge when required.
 */
export interface BoosterTargetAdapter {
  /** Optional verified native method binding. Without it native commands are unsupported. */
  nativeMethods?: ChatGptNativeMethodAdapter
  nativeHistory?: ChatGptNativeHistoryPort
  applicationTelemetry?: import('@kobaproduction/browser-core').ApplicationTelemetryController
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
  externalSounds?: boolean
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
    pageBridgeWindow,
    new ArchiveSourceGate(false, selectedContract),
  )
  const settings = createCachedSettingsAdapter(target.settings)
  const runtimeTarget: BoosterTargetAdapter = { ...target, settings }
  // Legacy transport/export settings are retained for backup compatibility;
  // application composition owns the single shared telemetry opt-in and delivery.
  delete runtimeTarget.telemetry
  delete runtimeTarget.telemetryControl
  const collectionSession = new ArchiveCollectionSession()
  const fixedArchive = new FixedChatGptCapture(
    conversationState,
    settings,
    target.label,
    collectionSession,
  )
  const workspace = new ConversationArchiveWorkspace(conversationState, fixedArchive)
  const archiveAdapter = createFixedArchiveUiAdapter(fixedArchive, conversationState, workspace)
  const sounds = new ConversationSoundsModule(settings, conversationState)
  const nativeBindings = createChatGptNativeMethodRegistry()
  let nativeAccountBinding: ReturnType<typeof bindNativeAccountSource> | undefined
  if (target.nativeMethods) nativeBindings.register(target.nativeMethods)
  const automation = new ChatGptConversationAutomation(
    conversationState,
    settings,
    fixedArchive,
    target.secrets,
    createChatGptNativeCommandPort(conversationState, nativeBindings.adapter),
    target.applicationTelemetry,
  )
  let unsubscribeSignals: (() => void) | undefined
  const signalStates = new Map<string, string>()
  const notifications: BoosterModule = {
    id: 'technical-notifications',
    start() {
      unsubscribeSignals = conversationState.subscribe((change) => {
        const lifecycle = conversationState.lifecycle(change.conversationId)
        if (lifecycle?.source !== 'transport') return
        const signature = [
          lifecycle.requestId ?? lifecycle.startedAt,
          lifecycle.userMessageId,
          lifecycle.state,
          lifecycle.terminalCause,
          lifecycle.transportHealth,
        ].join(':')
        if (signalStates.get(change.conversationId) === signature) return
        signalStates.set(change.conversationId, signature)
        const error =
          lifecycle.state === 'failed' ||
          ['interrupted', 'unavailable'].includes(lifecycle.transportHealth ?? '')
        if (error || lifecycle.state === 'complete')
          void target.applicationTelemetry?.record(
            error ? 'application.error' : 'application.notification',
            1,
            undefined,
            { providerId: 'chatgpt-booster', ...(error ? { errorClass: 'network' as const } : {}) },
          )
      })
    },
    stop() {
      unsubscribeSignals?.()
      unsubscribeSignals = undefined
      signalStates.clear()
    },
  }

  const nativeHistory = target.nativeHistory ?? new NativeHistoryBinding(conversationState)
  const modules: BoosterModule[] = [
    ...(nativeHistory instanceof NativeHistoryBinding ? [nativeHistory] : []),
    conversationState,
    {
      id: 'native-binding',
      start() {
        // Configured capabilities participate in every activation. Explicit late bindings
        // are scoped to their activation and must be supplied again after stop.
        if (!nativeBindings.hasBinding() && target.nativeMethods)
          nativeBindings.register(target.nativeMethods)
      },
      stop() {
        nativeBindings.clear()
        nativeAccountBinding?.dispose()
        nativeAccountBinding = undefined
      },
    },
    notifications,
    ...(options.mountUi === false ? [] : [new OverlayModule(runtimeTarget, archiveAdapter)]),
    fixedArchive,
    workspace,
    new ArchiveScopeControlsModule(settings, archiveAdapter, conversationState),
    new HistoryLoaderModule(
      conversationState,
      fixedArchive,
      pageBridgeWindow,
      settings,
      false,
      nativeHistory,
    ),
    new TransportObserverModule({
      settings,
      diagnostics: target.diagnostics,
      ...(target.persistentDiagnostics ? { persistentDiagnostics: target.persistentDiagnostics } : {}),
    }),
    new ConversationDecoratorsModule(
      settings,
      {
        // Reuse canonical owner-fenced originals in the background after reload.
        // Saved records supply presentation, never a new request/lifecycle event.
        listMessages: async (id) =>
          (await fixedArchive.windowConversation(id, 'older')).flatMap((source) => {
            const record = normalizeConversationMessage(source.raw, id, null, source.observedAtMs)
            return record ? [record] : []
          }),
        listMessagesAround: async (id, messageId) =>
          (await fixedArchive.windowAroundMessage(id, messageId)).flatMap((source) => {
            const record = normalizeConversationMessage(source.raw, id, null, source.observedAtMs)
            return record ? [record] : []
          }),
      },
      conversationState,
      automation.timing,
    ),
    automation,
    ...(options.externalSounds ? [] : [sounds]),
  ]

  const runtime = new BoosterRuntime(modules, (module, error) => {
    console.error('[ChatGPT Booster] Module failed:', module.id, error)
    void target.applicationTelemetry?.record('application.error', 1, undefined, {
      providerId: 'chatgpt-booster',
      errorClass: 'internal',
    })
  })
  let earlyGeneration = 0
  let earlyStopping: Promise<void> | undefined
  const stopEarly = () => {
    earlyGeneration++
    if (earlyStopping) return earlyStopping
    const errors: unknown[] = []
    // Revoke source authority synchronously, before waiting for archive persistence.
    for (const stop of [
      () => conversationState.stop(),
      () => workspace.stop(),
      () => nativeBindings.clear(),
      () => {
        nativeAccountBinding?.dispose()
        nativeAccountBinding = undefined
      },
    ]) {
      try {
        stop()
      } catch (error) {
        errors.push(error)
      }
    }
    const pending = Promise.allSettled([
      Promise.resolve().then(() => automation.stop()),
      Promise.resolve().then(() => fixedArchive.stop()),
    ]).then((stopped) => {
      for (const result of stopped) if (result.status === 'rejected') errors.push(result.reason)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'ChatGPT early runtime teardown failed')
    })
    earlyStopping = pending
    const finished = () => {
      if (earlyStopping === pending) earlyStopping = undefined
    }
    void pending.then(finished, finished)
    return pending
  }

  return {
    stopEarly,
    /** Genuine native registry refresh plus independently observed catalog selection. */
    bindNativeAccounts: (binding: ChatGptNativeAccountBindingOptions) => {
      nativeAccountBinding?.dispose()
      nativeAccountBinding = bindNativeAccountSource(
        pageBridgeWindow,
        createChatGptNativeAccountSource(binding),
      )
      return nativeAccountBinding
    },
    /** Explicit verified native references only; no automatic discovery or global registry. */
    bindNativeApplication: (binding: ChatGptNativeBindingOptions) =>
      nativeBindings.register(createChatGptNativeApplicationBinding(conversationState, binding)),
    runtime,
    startEarly: async () => {
      const generation = ++earlyGeneration
      if (earlyStopping) await earlyStopping
      if (generation !== earlyGeneration) return
      conversationState.start()
      workspace.start()
      await automation.start()
      if (generation !== earlyGeneration) return
      await fixedArchive.start()
      if (generation !== earlyGeneration) return
    },
    settings,
    observations: conversationState.observations,
    workspace,
    archiveAdapter,
    fixedArchive,
    sounds,
    automation,
  }
}
