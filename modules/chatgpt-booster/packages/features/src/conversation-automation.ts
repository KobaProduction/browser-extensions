import { currentConversationId } from '@chatgpt-booster/chatgpt'
import {
  type BoosterModule,
  type BoosterSettings,
  type ChatGptArchiveSyncStatus,
  type ChatGptAutomationControl,
  type ChatGptAutomationStatus,
  captureRuleFor,
  isChatGptPage,
  type SecretAdapter,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import {
  createRemoteSession,
  probeRemoteSession,
  type RemoteCommandHandlers,
  syncRemoteArchive,
} from '@kobaproduction/browser-adapters'
import { ARCHIVE_MESSAGE_MODEL_VERSION, encodeArchiveClone } from '@kobaproduction/browser-archive'
import {
  type ApplicationTelemetryController,
  type AutomationCommand,
  type AutomationCommandAction,
  type AutomationCommandResult,
  type AutomationConfiguration,
  type AutomationEvent,
  type AutomationEventContext,
  createAutomationEngine,
  createAutomationTriggerDraft,
  DEFAULT_AUTOMATION_CONFIGURATION,
  REMOTE_COMMAND_KINDS,
  type RemoteCommandKind,
  type RemoteCommandPayloadMap,
  reportTelemetryError,
  validateRemoteCommandPayload,
} from '@kobaproduction/browser-core'
import { assertMatchingScope, type ServiceScope } from '@kobaproduction/browser-storage'
import type {
  ChatGptCommittedSource,
  ChatGptRejectedSource,
  ChatGptRemoteSource,
  FixedChatGptCapture,
} from './archive-fixed-runtime'
import { compareSourceObservation } from './archive-observation-policy'
import { retainRawSource } from './archive-record-retention'
import {
  type ChatGptNativeCommandPort,
  createChatGptNativeCommandPort,
} from './conversation-command-port'
import { normalizedRemoteObservation, normalizedRemoteSnapshotRows } from './conversation-remote-message'
import { type ConversationTonePlayback, playConversationTone } from './conversation-sounds'
import type { ConversationStateStore } from './conversation-state'

export type {
  ChatGptArchiveSyncStatus,
  ChatGptAutomationControl,
  ChatGptAutomationStatus,
} from '@chatgpt-booster/core'
export interface ConversationTimingSnapshot {
  conversationId: string | null
  runId: string
  active: boolean
  startedAt: number
  completedAt: number | null
  lastActivityAt?: number | null
  lastSummaryAt?: number | null
  previousSummaryAt?: number | null
  phase?: 'thinking' | 'tool' | 'responding'
  phaseStartedAt?: number | null
}
export interface ConversationTimingPort {
  current(conversationId: string | null): ConversationTimingSnapshot | null
  subscribe(listener: () => void): () => void
}

type SourceFact = AutomationEvent extends infer T
  ? T extends AutomationEvent
    ? Omit<T, keyof AutomationEventContext>
    : never
  : never
type Cause = { origin: 'automation' | 'remote' | 'user'; commandId: string; ruleId?: string }
const PROVIDER = 'chatgpt-booster'
const rawText = (raw: Record<string, unknown>) => {
  const content =
    raw.content && typeof raw.content === 'object' ? (raw.content as Record<string, unknown>) : undefined
  return typeof content?.text === 'string'
    ? content.text
    : Array.isArray(content?.parts)
      ? content.parts.filter((part): part is string => typeof part === 'string').join('\n')
      : ''
}
const textSignature = (text: string, final: boolean) => {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return `${text.length}:${hash >>> 0}:${final}`
}

/** Shared engine composition. Only correlated native transport evidence supplies facts and timing. */
export class ChatGptConversationAutomation implements BoosterModule, ChatGptAutomationControl {
  readonly id = 'conversation-automation'
  private active = false
  private generation = 0
  private settingsRevision = 0
  private replayRemoteSignature = ''
  private installationEnabled = false
  private timingEnabled = false
  private soundEnabled = false
  private readonly playingSounds = new Set<ConversationTonePlayback>()
  private timingValues = new Map<string, ConversationTimingSnapshot>()
  private readonly timingListeners = new Set<() => void>()
  readonly timing: ConversationTimingPort = {
    current: (id) => {
      const value = id ? this.timingValues.get(id) : undefined
      return value ? { ...value } : null
    },
    subscribe: (listener) => {
      this.timingListeners.add(listener)
      return () => {
        this.timingListeners.delete(listener)
      }
    },
  }
  private configuration: AutomationConfiguration = structuredClone(DEFAULT_AUTOMATION_CONFIGURATION)
  private savedConfiguration: AutomationConfiguration = structuredClone(DEFAULT_AUTOMATION_CONFIGURATION)
  private readonly triggerDraft = createAutomationTriggerDraft()
  private readonly listeners = new Set<() => void>()
  private cleanup: (() => void)[] = []
  private remote: ReturnType<typeof createRemoteSession> | null = null
  private remoteOwner: string | null = null
  private remoteUnsubscribe: (() => void) | undefined
  private remoteWork = Promise.resolve()
  private lifecycleSignatures = new Map<string, string>()
  private startedRuns = new Set<string>()
  private messageSignatures = new Map<string, string>()
  private origins = new Map<string, Cause>()
  private pendingCause: Cause | undefined
  private pendingFacts: { fact: SourceFact; conversationId?: string; runId: string }[] = []
  private commandController = new AbortController()
  private lastError: string | undefined
  private syncController: AbortController | undefined
  private syncState: ChatGptArchiveSyncStatus = { state: 'idle', queuedRows: 0, totalRows: null }
  private readonly native: ChatGptNativeCommandPort
  private readonly engine = createAutomationEngine({
    handleCommand: (command) => this.handleCommand(command),
  })

  constructor(
    private readonly state: ConversationStateStore,
    private readonly settings: SettingsAdapter,
    private readonly archive: FixedChatGptCapture,
    private readonly secrets?: SecretAdapter,
    commandPort?: ChatGptNativeCommandPort,
    private readonly telemetry?: ApplicationTelemetryController,
  ) {
    this.native = commandPort ?? createChatGptNativeCommandPort(state)
  }
  status(): ChatGptAutomationStatus {
    return {
      enabled: this.active && this.configuration.enabled,
      domEvents: false,
      verifiedOwner: Boolean(this.state.verifiedAccountId()),
      remote: this.remote?.status() ?? null,
      sync: { ...this.syncState },
      triggers: this.triggerState(),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    }
  }
  triggerState() {
    return this.triggerDraft.state()
  }
  async probe(candidate: { endpoint: string; token: string; signal?: AbortSignal }) {
    const scope = this.archive.currentScope()
    if (!scope || scope.ownerId !== this.state.verifiedAccountId())
      return {
        ok: false,
        endpoint: candidate.endpoint,
        checkedAt: Date.now(),
        errorCode: 'invalid-configuration' as const,
      }
    return probeRemoteSession({ ...candidate, scope })
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private notify() {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        /* Presentation is isolated. */
      }
    }
  }
  private error(code: string) {
    if (code !== this.lastError)
      reportTelemetryError(
        this.telemetry,
        undefined,
        PROVIDER,
        code.startsWith('remote.') ? 'network' : 'internal',
      )
    this.lastError = code
    this.notify()
  }

  async start() {
    if (this.active || !isChatGptPage()) return
    this.active = true
    const epoch = ++this.generation
    this.commandController = new AbortController()
    this.cleanup.push(
      this.settings.subscribe((settings) => {
        this.settingsRevision++
        void this.applySettings(settings).catch(() => this.error('automation.configurationUnavailable'))
      }),
    )
    this.cleanup.push(
      this.state.subscribeAccount(() => {
        this.silence()
        this.cancelSync()
        this.commandController.abort()
        this.commandController = new AbortController()
        // Changing the owner invalidates commands still queued inside the engine.
        this.triggerDraft.acceptSaved(this.savedConfiguration.rules, true)
        this.configuration = { ...this.configuration, rules: this.triggerDraft.state().draftRules }
        this.engine.configure(this.configuration)
        this.pendingCause = undefined
        this.origins.clear()
        this.lifecycleSignatures.clear()
        this.startedRuns.clear()
        this.messageSignatures.clear()
        this.pendingFacts = []
        this.timingValues.clear()
        this.notifyTiming()
        void this.syncRemote().catch(() => this.error('remote.ownerUnavailable'))
        this.notify()
      }),
    )
    this.cleanup.push(
      this.state.subscribe((change) => {
        if (
          !this.active ||
          !this.state.verifiedAccountId() ||
          !['request', 'stop', 'transport'].includes(change.reason)
        )
          return
        const lifecycle = this.state.lifecycle(change.conversationId)
        if (!lifecycle?.requestId) return
        const runId = lifecycle.requestId
        this.updateTiming(change.conversationId)
        const signature = [
          runId,
          lifecycle.state,
          lifecycle.terminalCause,
          lifecycle.transportHealth,
        ].join(':')
        if (this.lifecycleSignatures.get(change.conversationId) === signature) return
        this.lifecycleSignatures.set(change.conversationId, signature)
        if (lifecycle.state === 'in_progress' && !this.startedRuns.has(runId)) {
          this.startedRuns.add(runId)
          if (this.startedRuns.size > 512) {
            const oldest = this.startedRuns.values().next().value
            if (oldest) this.startedRuns.delete(oldest)
          }
          this.fact(
            { type: 'api', name: 'request-start', status: 'start' },
            change.conversationId,
            runId,
          )
        }
        if (
          lifecycle.terminalCause &&
          /limit|too_large|exhaust|context_length/i.test(lifecycle.terminalCause)
        )
          this.fact({ type: 'limit', name: lifecycle.terminalCause }, change.conversationId, runId)
        if (['complete', 'failed', 'stopped', 'cancelled'].includes(lifecycle.state)) {
          const outcome =
            lifecycle.terminalCause && /too_large|exhaust|context_length/i.test(lifecycle.terminalCause)
              ? 'context-exhausted'
              : lifecycle.state === 'complete'
                ? 'complete'
                : lifecycle.state === 'failed'
                  ? 'failed'
                  : 'cancelled'
          this.fact(
            { type: 'api', name: 'request-done', status: outcome === 'failed' ? 'error' : 'success' },
            change.conversationId,
            runId,
          )
          this.fact({ type: 'completion', outcome }, change.conversationId, runId)
        }
        if (['interrupted', 'unavailable'].includes(lifecycle.transportHealth ?? ''))
          this.fact(
            { type: 'api', name: 'transport-interrupted', status: 'error' },
            change.conversationId,
            runId,
          )
      }),
    )
    this.cleanup.push(
      this.state.subscribeStreamMessages((detail) => {
        if (detail.accountId !== this.state.verifiedAccountId()) return
        const runId =
          detail.requestId ??
          this.state.lifecycle(detail.conversationId)?.requestId ??
          `native:${detail.conversationId}`
        const preferred =
          typeof detail.raw.id === 'string'
            ? this.state.getMessage(detail.conversationId, detail.raw.id)
            : undefined
        if (preferred && compareSourceObservation(preferred.raw, detail.raw) === 'conflict')
          this.fact({ type: 'conflict', name: 'message-source-conflict' }, detail.conversationId, runId)
        if (!detail.activeRun) return
        const author = detail.raw.author as Record<string, unknown> | undefined
        if (!['user', 'assistant', 'tool'].includes(String(author?.role))) return
        const final =
          author?.role === 'user' ||
          (detail.raw.status === 'finished_successfully' &&
            detail.raw.end_turn === true &&
            detail.raw.recipient === 'all' &&
            (!detail.raw.channel || detail.raw.channel === 'final'))
        const text = rawText(detail.raw),
          key = JSON.stringify([runId, detail.conversationId, detail.raw.id])
        const signature = textSignature(text, final)
        if (this.messageSignatures.get(key) === signature) return
        this.messageSignatures.set(key, signature)
        if (this.messageSignatures.size > 256) {
          const first = this.messageSignatures.keys().next().value
          if (first) this.messageSignatures.delete(first)
        }
        this.fact(
          { type: 'message', role: author?.role as 'user' | 'assistant' | 'tool', text, final },
          detail.conversationId,
          runId,
        )
      }),
    )
    this.cleanup.push(this.archive.subscribeCommitted((source) => this.mirror(source)))
    this.cleanup.push(this.archive.subscribeRemoteSource((source) => this.remoteObservation(source)))
    this.cleanup.push(this.archive.subscribeRejectedSource((source) => this.rejectedSource(source)))
    const settingsRevision = this.settingsRevision,
      settings = await this.settings.get()
    if (this.active && epoch === this.generation && settingsRevision === this.settingsRevision)
      await this.applySettings(settings)
  }
  private async applySettings(settings: BoosterSettings) {
    if (!this.active) return
    const next: AutomationConfiguration = {
      ...structuredClone(settings.automation),
      domEvents: false,
      rules: settings.automation.rules.map((rule) =>
        rule.trigger.type === 'dom' ? { ...rule, enabled: false } : rule,
      ),
    }
    this.savedConfiguration = structuredClone(next)
    this.triggerDraft.acceptSaved(next.rules)
    const runtime = { ...next, rules: this.triggerDraft.state().draftRules }
    if (
      !settings.enabled ||
      next.remote.enabled !== this.configuration.remote.enabled ||
      next.remote.mode !== this.configuration.remote.mode ||
      next.remote.endpoint !== this.configuration.remote.endpoint
    )
      this.cancelSync()
    this.installationEnabled = settings.enabled
    this.timingEnabled = settings.features.requestTimer
    this.soundEnabled = settings.alerts.enabled
    if (!settings.enabled || !this.soundEnabled || !next.enabled) this.silence()
    // The installation switch disables both rules and remote execution.
    this.configuration = settings.enabled
      ? runtime
      : { ...runtime, enabled: false, remote: { ...runtime.remote, enabled: false } }
    this.engine.configure(this.configuration)
    this.syncTiming()
    await this.syncRemote()
    const replaySignature = JSON.stringify([
      settings.enabled,
      next.remote.enabled,
      next.remote.mode,
      next.remote.endpoint,
      next.remote.rawEvents,
    ])
    if (replaySignature !== this.replayRemoteSignature) {
      this.replayRemoteSignature = replaySignature
      if (next.remote.enabled) this.archive.replayBuffered?.()
    }
    this.notify()
  }
  private fact(fact: SourceFact, conversationId?: string, suppliedRun?: string) {
    if (
      !this.active ||
      !this.state.verifiedAccountId() ||
      (!this.configuration.enabled && !this.configuration.remote.enabled)
    )
      return
    const runId =
      suppliedRun ??
      (conversationId ? this.state.lifecycle(conversationId)?.requestId : undefined) ??
      'source-observation'
    if (fact.type === 'dom') return
    if (this.pendingCause) {
      this.pendingFacts.push({ fact, conversationId, runId })
      return
    }
    const cause = this.origins.get(runId)
    const event = {
      ...fact,
      eventId: crypto.randomUUID(),
      providerId: PROVIDER,
      runId,
      ...(conversationId ? { conversationId } : {}),
      at: Date.now(),
      origin: cause?.origin ?? 'provider',
      ...(cause
        ? { cause: { commandId: cause.commandId, ...(cause.ruleId ? { ruleId: cause.ruleId } : {}) } }
        : {}),
    } as AutomationEvent
    void this.engine.publish(event).catch(() => this.error('automation.factUnsupported'))
    // Text stays inside the local engine. Source text is mirrored only through
    // the separate, explicitly enabled post-commit archive channel below.
    if (event.type !== 'message') void this.publishRemote('automation.fact', event)
  }
  private syncTiming() {
    if (!this.active || !this.installationEnabled || !this.timingEnabled) {
      this.timingValues.clear()
      this.notifyTiming()
      return
    }
    for (const snapshot of this.state.listSnapshots()) this.updateTiming(snapshot.conversationId)
  }
  private updateTiming(conversationId: string) {
    if (!this.active || !this.installationEnabled || !this.timingEnabled) return
    const lifecycle = this.state.lifecycle(conversationId)
    if (
      !lifecycle?.requestId ||
      lifecycle.startedAt === null ||
      !['request', 'stop', 'transport'].includes(lifecycle.source)
    )
      return
    this.timingValues.set(conversationId, {
      conversationId,
      runId: lifecycle.requestId,
      active: ['in_progress', 'stop_requested'].includes(lifecycle.state),
      startedAt: lifecycle.startedAt,
      completedAt: lifecycle.completedAt,
      lastActivityAt: lifecycle.lastActivityAt ?? null,
      lastSummaryAt: lifecycle.lastSummaryAt ?? null,
      previousSummaryAt: lifecycle.previousSummaryAt ?? null,
      phase: lifecycle.activityPhase ?? 'thinking',
      phaseStartedAt: lifecycle.phaseStartedAt ?? lifecycle.startedAt,
    })
    this.notifyTiming()
  }
  private notifyTiming() {
    for (const listener of this.timingListeners) {
      try {
        listener()
      } catch {
        /* UI timing stays isolated. */
      }
    }
  }
  private async syncRemote() {
    const task = this.remoteWork.then(async () => {
      const scope = this.active ? this.archive.currentScope() : null
      const config = this.configuration.remote
      if (!scope || !config.enabled || scope.ownerId !== this.remoteOwner) {
        const previous = this.remote
        this.remote = null
        this.remoteOwner = null
        this.remoteUnsubscribe?.()
        this.remoteUnsubscribe = undefined
        await previous?.stop()
      }
      if (
        !this.active ||
        !scope ||
        !config.enabled ||
        config !== this.configuration.remote ||
        this.state.verifiedAccountId() !== scope.ownerId
      )
        return
      if (!this.remote) {
        const execute =
          <K extends RemoteCommandKind>(kind: K) =>
          async (
            payload: RemoteCommandPayloadMap[K],
            context: { signal: AbortSignal; commandId: string; scope: { ownerId?: string } },
          ) => {
            if (context.scope.ownerId !== this.state.verifiedAccountId())
              throw Error('automation.ownerChanged')
            return this.dispatchCommand(kind, payload, 'remote', context.commandId, context.signal)
          }
        const handlers = Object.fromEntries(
          REMOTE_COMMAND_KINDS.map((kind) => [kind, execute(kind)]),
        ) as RemoteCommandHandlers
        this.remote = createRemoteSession({
          scope,
          sessionId: crypto.randomUUID(),
          config,
          handlers,
          getToken: async () => await this.secrets?.getRemoteToken?.(),
        })
        this.remoteOwner = scope.ownerId
        let online = false
        this.remoteUnsubscribe = this.remote.subscribe(() => {
          const nextOnline = this.remote?.status().state === 'online'
          if (nextOnline && !online) this.archive.replayBuffered?.()
          online = nextOnline
          this.notify()
        })
      }
      const session = this.remote
      await session.configure(config)
      if (
        !this.active ||
        config !== this.configuration.remote ||
        scope.ownerId !== this.state.verifiedAccountId()
      )
        return
      await session.start()
    })
    this.remoteWork = task.catch(() => {
      this.error('remote.sessionUnavailable')
    })
    await task
  }
  private acceptsSource(scope: ServiceScope): boolean {
    if (
      !this.active ||
      !this.installationEnabled ||
      !this.configuration.remote.enabled ||
      this.configuration.remote.mode === 'local-only' ||
      scope.ownerId !== this.state.verifiedAccountId()
    )
      return false
    const current = this.archive.currentScope()
    if (!current) return false
    try {
      assertMatchingScope(current, scope)
      return true
    } catch {
      return false
    }
  }
  private async publishRemote(
    kind: string,
    payload: unknown,
    sourceScope?: ServiceScope,
    sourceMode?: 'normalized' | 'raw',
  ) {
    const owner = this.state.verifiedAccountId()
    const epoch = this.state.accountEpoch()
    if (
      !owner ||
      !this.installationEnabled ||
      !this.configuration.remote.enabled ||
      this.configuration.remote.mode === 'local-only' ||
      (sourceScope && !this.acceptsSource(sourceScope))
    )
      return { accepted: false, durable: false, reason: 'source-unavailable' }
    await this.remoteWork
    const session = this.remote
    if (
      !this.active ||
      !this.installationEnabled ||
      !session ||
      this.state.accountEpoch() !== epoch ||
      owner !== this.state.verifiedAccountId() ||
      owner !== this.remoteOwner ||
      !this.configuration.remote.enabled ||
      (sourceScope && !this.acceptsSource(sourceScope))
    )
      return { accepted: false, durable: false, reason: 'source-unavailable' }
    if (
      (kind === 'archive.source-raw' || sourceMode === 'raw') &&
      (!this.configuration.remote.rawEvents || session.status().eventMode !== 'raw')
    )
      return { accepted: false, durable: false, reason: 'raw-not-negotiated' }
    const receipt = await session.publish(kind, payload, { sourceMode })
    if (!receipt.accepted) this.error(receipt.reason ?? 'remote.queueRejected')
    return receipt
  }
  private async mirror(source: ChatGptCommittedSource) {
    if (!this.acceptsSource(source.scope) || this.configuration.remote.mode !== 'local-and-remote')
      return { accepted: false }
    return this.publishObservation(source, 'archive.source-committed')
  }
  private async publishObservation(source: ChatGptCommittedSource, kind: string) {
    if (!this.acceptsSource(source.scope))
      return { accepted: false, durable: false, reason: 'source-unavailable' }
    const observation = source.observation
    try {
      const message = normalizedRemoteObservation(observation, source.scope, source.normalized)
      if (this.configuration.remote.rawEvents && this.remote?.status().eventMode === 'raw')
        return this.publishRemote(
          'archive.source-raw',
          { scope: source.scope, message, source: await encodeArchiveClone(observation) },
          source.scope,
          'raw',
        )
      return await this.publishRemote(kind, { scope: source.scope, message }, source.scope, 'normalized')
    } catch {
      await this.rejectedSource({
        scope: source.scope,
        source: {
          accountId: observation.accountId,
          conversationId: observation.conversationId,
          observedAt: observation.observedAtMs,
          sourceKind: observation.sourceKind === 'native-stream' ? 'stream' : 'page',
          raw: observation.raw,
        },
        reason: 'validation',
      })
      return { accepted: false, durable: false, reason: 'adapter-validation' }
    }
  }
  private async rejectedSource(source: ChatGptRejectedSource): Promise<{ accepted: boolean }> {
    reportTelemetryError(this.telemetry, undefined, PROVIDER, source.reason)
    if (
      source.reason !== 'validation' ||
      !this.acceptsSource(source.scope) ||
      source.source.accountId !== source.scope.ownerId ||
      !this.configuration.remote.rawEvents ||
      this.remote?.status().eventMode !== 'raw'
    )
      return { accepted: false }
    const revision = this.settingsRevision,
      settings = await this.settings.get()
    if (
      revision !== this.settingsRevision ||
      !settings.enabled ||
      !this.acceptsSource(source.scope) ||
      !settings.automation.remote.enabled ||
      !settings.automation.remote.rawEvents ||
      this.remote?.status().eventMode !== 'raw'
    )
      return { accepted: false }
    const header = this.state.header(source.source.conversationId)
    const rule = captureRuleFor(
      settings.archive,
      source.source.conversationId,
      header?.projectId ?? null,
    )
    if (!retainRawSource(source.source.raw, rule)) return { accepted: false }
    const receipt = await this.publishRemote(
      'archive.source-raw',
      {
        scope: source.scope,
        rejected: await encodeArchiveClone(source.source),
        reason: 'adapter-validation',
      },
      source.scope,
      'raw',
    )
    return { accepted: receipt?.accepted === true }
  }
  private async remoteObservation(source: ChatGptRemoteSource): Promise<{ accepted: boolean }> {
    if (!this.acceptsSource(source.scope) || this.configuration.remote.mode !== 'remote-only')
      return { accepted: false }
    const receipt =
      'observation' in source
        ? await this.publishObservation(source, 'archive.source-observed')
        : this.configuration.remote.rawEvents && this.remote?.status().eventMode === 'raw'
          ? await this.publishRemote(
              'archive.source-raw',
              { scope: source.scope, source: await encodeArchiveClone(source.page) },
              source.scope,
              'raw',
            )
          : await this.publishRemote(
              'archive.page-observed',
              {
                scope: source.scope,
                page: {
                  conversationId: source.page.conversationId,
                  observedAtMs: source.page.timestamp,
                },
              },
              source.scope,
              'normalized',
            )
    if (!receipt?.accepted) {
      this.error(receipt?.reason ?? 'remote.sourceUnavailable')
      return { accepted: false }
    }
    return { accepted: true }
  }
  private silence() {
    for (const playback of this.playingSounds) playback.stop()
    this.playingSounds.clear()
  }
  private async handleCommand(command: AutomationCommand): Promise<AutomationCommandResult | undefined> {
    if (!this.active || !this.installationEnabled || !this.state.verifiedAccountId())
      throw Error('automation.commandUnavailable')
    const cause: Cause = {
      origin: command.origin,
      commandId: command.commandId,
      ...(command.ruleId ? { ruleId: command.ruleId } : {}),
    }
    const context = {
      signal: this.commandController.signal,
      ...(command.conversationId ? { conversationId: command.conversationId } : {}),
      beforeAction: () => {
        this.pendingCause = cause
      },
      correlateRun: (runId: string) => {
        this.origins.set(runId, cause)
        if (this.origins.size > 256) {
          const oldest = this.origins.keys().next().value
          if (oldest) this.origins.delete(oldest)
        }
      },
    }
    try {
      const action = command.action
      if (action.type === 'send-message') await this.native.send(action.text, context)
      else if (action.type === 'stop') await this.native.stop(context)
      else if (action.type === 'continue') await this.native.continue(action.text, context)
      else if (action.type === 'new-chat') await this.native.newChat(action, context)
      else if (action.type === 'archive-sync') await this.syncArchiveWithSignal(context.signal)
      else if (action.type === 'play-sound') {
        if (!this.soundEnabled) return { status: 'ignored', reason: 'disabled' }
        let playback: ConversationTonePlayback | undefined
        playback = playConversationTone(action.tone, false, () => {
          if (playback) this.playingSounds.delete(playback)
        })
        if (playback) this.playingSounds.add(playback)
      } else if (action.type === 'remote-event')
        await this.publishRemote('automation.custom', { name: action.name, runId: command.runId })
      else throw Error('automation.commandUnsupported')
    } finally {
      if (this.pendingCause?.commandId === command.commandId) {
        this.pendingCause = undefined
        const facts = this.pendingFacts.splice(0)
        for (const { fact, conversationId, runId } of facts) this.fact(fact, conversationId, runId)
      }
    }
  }
  private async dispatchCommand<K extends RemoteCommandKind>(
    kind: K,
    input: RemoteCommandPayloadMap[K],
    origin: 'user' | 'remote',
    commandId: string = crypto.randomUUID(),
    signal?: AbortSignal,
  ) {
    if (
      !this.active ||
      signal?.aborted ||
      ((!this.installationEnabled || !this.state.verifiedAccountId()) &&
        (origin === 'remote' || !kind.startsWith('triggers-')))
    )
      throw Error('automation.commandUnavailable')
    if (
      origin === 'remote' &&
      (!this.configuration.remote.enabled ||
        this.configuration.remote.mode === 'local-only' ||
        !this.configuration.remote.allowedCommands.includes(kind))
    )
      throw Error('automation.remoteCommandDisabled')
    const payload = validateRemoteCommandPayload(kind, input)
    const incomingRules =
      kind === 'triggers-set' || kind === 'triggers-draft-set'
        ? (payload as RemoteCommandPayloadMap['triggers-set']).rules
        : kind === 'triggers-draft-upsert'
          ? [(payload as RemoteCommandPayloadMap['triggers-draft-upsert']).rule]
          : []
    if (incomingRules.some((rule) => rule.trigger.type === 'dom'))
      throw Error('automation.domTriggerUnsupported')
    if (kind === 'triggers-list') {
      const state = this.triggerState()
      return {
        saved: state.savedRules.map(({ id, label, enabled }) => ({ id, label, enabled })),
        draft: state.draftRules.map(({ id, label, enabled }) => ({ id, label, enabled })),
        unsaved: state.unsaved,
        revision: state.revision,
      }
    }
    if (kind === 'triggers-get-config') {
      const { rules: _saved, ...saved } = this.savedConfiguration
      const { rules: _draft, ...runtime } = this.configuration
      return { saved, runtime, triggers: this.triggerState() }
    }
    if (kind === 'triggers-get-unsaved') return this.triggerState()
    if (kind === 'triggers-get') {
      const id = (payload as RemoteCommandPayloadMap['triggers-get']).id,
        state = this.triggerState()
      return {
        saved: state.savedRules.find((rule) => rule.id === id) ?? null,
        draft: state.draftRules.find((rule) => rule.id === id) ?? null,
        unsaved: state.unsaved,
        revision: state.revision,
      }
    }
    if (
      [
        'triggers-draft-set',
        'triggers-draft-upsert',
        'triggers-draft-remove',
        'triggers-draft-reset',
        'triggers-draft-discard',
      ].includes(kind)
    ) {
      if (kind === 'triggers-draft-set')
        this.triggerDraft.set((payload as RemoteCommandPayloadMap['triggers-draft-set']).rules)
      else if (kind === 'triggers-draft-upsert')
        this.triggerDraft.upsert((payload as RemoteCommandPayloadMap['triggers-draft-upsert']).rule)
      else if (kind === 'triggers-draft-remove')
        this.triggerDraft.remove((payload as RemoteCommandPayloadMap['triggers-draft-remove']).id)
      else if (kind === 'triggers-draft-reset') this.triggerDraft.reset()
      else this.triggerDraft.discard()
      this.configuration = { ...this.configuration, rules: this.triggerDraft.state().draftRules }
      this.engine.configure(this.configuration)
      this.notify()
      return { status: 'executed', persisted: false, triggers: this.triggerState() }
    }
    if (kind === 'archive-sync') return this.syncArchiveWithSignal(signal)
    if (kind === 'triggers-set' || kind === 'triggers-reset' || kind === 'triggers-draft-save') {
      const owner = this.state.verifiedAccountId(),
        epoch = this.state.accountEpoch()
      const rules =
        kind === 'triggers-set'
          ? (payload as RemoteCommandPayloadMap['triggers-set']).rules
          : kind === 'triggers-draft-save'
            ? this.triggerState().draftRules
            : []
      const saved = await this.settings.update({ automation: { rules } })
      if (
        !this.active ||
        signal?.aborted ||
        owner !== this.state.verifiedAccountId() ||
        epoch !== this.state.accountEpoch()
      )
        throw Error('automation.commandCancelled')
      // Cached adapters need not synchronously echo their own write through subscribe.
      await this.applySettings(saved)
      if (kind !== 'triggers-draft-save') {
        this.triggerDraft.acceptSaved(saved.automation.rules, true)
        this.configuration = { ...this.configuration, rules: this.triggerState().draftRules }
        this.engine.configure(this.configuration)
        this.notify()
      }
      return { status: 'executed', persisted: true, triggers: this.triggerState() }
    }
    const abort = () => this.commandController.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const id = currentConversationId()
      const result = await this.engine.dispatch({
        commandId,
        providerId: PROVIDER,
        runId: (id ? this.state.lifecycle(id)?.requestId : undefined) ?? 'explicit-command',
        ...(id ? { conversationId: id } : {}),
        origin,
        at: Date.now(),
        action: { type: kind, ...payload } as AutomationCommandAction,
      })
      if (result.status !== 'executed') throw Error(`automation.${result.reason ?? result.status}`)
      return result
    } finally {
      signal?.removeEventListener('abort', abort)
      if (this.commandController.signal.aborted && this.active)
        this.commandController = new AbortController()
    }
  }
  dispatch<K extends RemoteCommandKind>(kind: K, payload: RemoteCommandPayloadMap[K]) {
    return this.dispatchCommand(kind, payload, 'user')
  }
  async reconnect() {
    await this.remoteWork
    if (this.remote) await this.remote.reconnect()
    else await this.syncRemote()
  }
  async retryPending() {
    await this.remote?.retryDeadLetters()
  }
  syncArchive() {
    return this.syncArchiveWithSignal()
  }
  cancelSync() {
    if (!this.syncController) return
    this.syncController.abort()
    this.syncState = { ...this.syncState, state: 'cancelled', errorCode: 'cancelled' }
    this.notify()
  }
  private async syncArchiveWithSignal(signal?: AbortSignal): Promise<{ queuedRows: number }> {
    if (this.syncController) throw Error('remote.syncBusy')
    const controller = new AbortController(),
      epoch = this.state.accountEpoch()
    const owner = this.state.verifiedAccountId()
    this.syncController = controller
    this.lastError = undefined
    this.syncState = { state: 'preparing', queuedRows: 0, totalRows: null }
    this.notify()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    let unsubscribeSource: (() => void) | undefined
    try {
      const authorize = () => {
        if (controller.signal.aborted) throw Error('cancelled')
        if (
          !this.active ||
          !this.installationEnabled ||
          !owner ||
          this.state.accountEpoch() !== epoch ||
          this.state.verifiedAccountId() !== owner
        )
          throw Error('owner-unavailable')
        if (!this.configuration.remote.enabled || this.configuration.remote.mode === 'local-only')
          throw Error('remote-disabled')
      }
      authorize()
      await this.syncRemote()
      authorize()
      const session = this.remote,
        scope = this.archive.currentScope()
      if (!session || !scope || scope.ownerId !== owner || this.remoteOwner !== owner)
        throw Error('remote-unavailable')
      const port = this.archive.backupPort()
      let sourceChanged = false
      unsubscribeSource = this.archive.subscribeSaved(() => {
        sourceChanged = true
      })
      const counts = await port.countRows()
      authorize()
      sourceChanged = false
      const totalSourceRows = Object.values(counts).reduce((total, count) => total + count, 0)
      if (
        !Number.isSafeInteger(totalSourceRows) ||
        totalSourceRows < 0 ||
        !Number.isSafeInteger(counts.snapshots) ||
        (counts.snapshots ?? -1) < 0
      )
        throw Error('source-changed')
      const rawCompanions = this.configuration.remote.rawEvents && session.status().eventMode === 'raw'
      this.syncState = { ...this.syncState, totalRows: null }
      this.notify()
      let observedSourceRows = 0,
        preferredRows = 0,
        wireRows = 0,
        sourceFinished = false
      const validate = async () => {
        authorize()
        if (sourceChanged || this.remote !== session || !this.acceptsSource(scope))
          throw Error('source-changed')
        if (
          rawCompanions &&
          (!this.configuration.remote.rawEvents || session.status().eventMode !== 'raw')
        )
          throw Error('raw-not-negotiated')
        if (sourceFinished) {
          if (
            observedSourceRows !== totalSourceRows ||
            preferredRows !== counts.snapshots ||
            !port.assertSnapshotCurrent
          )
            throw Error('source-changed')
          await port.assertSnapshotCurrent()
          authorize()
          if (sourceChanged || this.remote !== session) throw Error('source-changed')
        }
      }
      const readSavedProjectId = async (conversationId: string) => {
        const projectId = await this.archive.readSavedProjectId(conversationId)
        await validate()
        return projectId
      }
      const readRows = async function* () {
        for await (const row of port.readRows(128)) {
          observedSourceRows++
          for await (const normalized of normalizedRemoteSnapshotRows(row, scope, readSavedProjectId)) {
            if (normalized.store === 'messages') preferredRows++
            wireRows++
            yield normalized
          }
          if (rawCompanions) {
            wireRows++
            yield { ...row, store: `source-${row.store}` }
          }
          if (!Number.isSafeInteger(wireRows)) throw Error('source-changed')
        }
        sourceFinished = true
      }
      const result = await syncRemoteArchive({
        session,
        scope,
        schema: {
          schema: 'koba.normalized-archive',
          schemaVersion: 1,
          messageSchema: 'koba.message',
          messageModelVersion: ARCHIVE_MESSAGE_MODEL_VERSION,
          stores: [
            'messages',
            'message-variants',
            ...(rawCompanions ? port.stores.map((store) => `source-${store}`) : []),
          ],
          source: {
            schemaVersion: port.schemaVersion,
            stores: [...port.stores],
            schema: port.schema,
            expectedRows: totalSourceRows,
          },
          rawCompanions,
        },
        valueEncoding: 'koba-message-envelope-v1',
        sourceMode: rawCompanions ? 'raw' : 'normalized',
        readRows,
        validate,
        signal: controller.signal,
        onProgress: (progress) => {
          if (this.syncController !== controller || controller.signal.aborted) return
          this.syncState = {
            state: progress.phase === 'queued' ? 'queued' : 'queuing',
            generationId: progress.syncId,
            queuedRows: progress.queuedRows,
            totalRows: sourceFinished ? wireRows : null,
          }
          this.notify()
        },
      })
      authorize()
      if (result.queuedRows !== wireRows) throw Error('source-changed')
      this.syncState = {
        state: 'queued',
        generationId: result.syncId,
        queuedRows: result.queuedRows,
        totalRows: wireRows,
      }
      this.notify()
      return { queuedRows: result.queuedRows }
    } catch (error) {
      const detail = error as {
        code?: unknown
        queuedRows?: unknown
        syncId?: unknown
        message?: unknown
      }
      const known = [
        'cancelled',
        'owner-unavailable',
        'source-changed',
        'remote-disabled',
        'remote-unavailable',
      ]
      const code = controller.signal.aborted
        ? 'cancelled'
        : typeof detail?.code === 'string'
          ? detail.code
          : typeof detail?.message === 'string' && known.includes(detail.message)
            ? detail.message
            : 'remote-unavailable'
      this.syncState = {
        ...this.syncState,
        state: code === 'cancelled' ? 'cancelled' : 'failed',
        errorCode: code,
        ...(typeof detail?.queuedRows === 'number' ? { queuedRows: detail.queuedRows } : {}),
        ...(typeof detail?.syncId === 'string' ? { generationId: detail.syncId } : {}),
      }
      this.lastError = code
      this.notify()
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      unsubscribeSource?.()
      if (this.syncController === controller) this.syncController = undefined
    }
  }
  async stop() {
    this.cancelSync()
    this.silence()
    this.active = false
    this.generation++
    this.commandController.abort()
    for (const unsubscribe of this.cleanup.splice(0)) unsubscribe()
    this.configuration = structuredClone(DEFAULT_AUTOMATION_CONFIGURATION)
    this.savedConfiguration = structuredClone(DEFAULT_AUTOMATION_CONFIGURATION)
    this.triggerDraft.acceptSaved([], true)
    this.engine.configure(this.configuration)
    this.syncTiming()
    await this.syncRemote()
    this.lifecycleSignatures.clear()
    this.startedRuns.clear()
    this.messageSignatures.clear()
    this.origins.clear()
    this.pendingCause = undefined
    this.pendingFacts = []
    this.notify()
  }
}
