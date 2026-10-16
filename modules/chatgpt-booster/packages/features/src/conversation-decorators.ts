import {
  archiveRecordMetadata,
  archiveRecordText,
  asRecord,
  type ConversationMessageTarget,
  chatGptRequestStatusAnchor,
  chatGptToolActivityRows,
  chatGptTurnId,
  chatGptTurnMessageIds,
  currentConversationId,
  findChatGptToolActionSlots,
  findChatGptTurnRoots,
  findConversationMessageTargets,
  isChatGptPlacementVisible,
  isChatGptWorkConversationOrigin,
  observeConversationActivity,
  observeConversationDecorations,
  toolInvocationFromRecord,
} from '@chatgpt-booster/chatgpt'
import {
  type AgentActivitySnapshot,
  type BoosterModule,
  type BoosterSettings,
  type SettingsAdapter,
  serverTimeMs,
} from '@chatgpt-booster/core'
import {
  type MountedAgentActivity,
  type MountedMessageMetadata,
  type MountedRequestStatus,
  type MountedToolInspector,
  type MountedWorkModeWarning,
  mountAgentActivity,
  mountMessageMetadata,
  mountRequestStatus,
  mountToolInspector,
  mountWorkModeWarning,
  resolveLocale,
  type ToolCallViewModel,
} from '@chatgpt-booster/ui'
import type { ArchivedMessage, ConversationArchiveStore } from './archive-store'
import type { ConversationTimingPort } from './conversation-automation'
import { ConversationStateStore } from './conversation-state'

function sourceTime(value: number | null | undefined): number | null {
  const normalized = serverTimeMs(value, 0)
  return normalized > 0 ? normalized : null
}

function sourceMetadata(record: ArchivedMessage) {
  return asRecord(record.raw.metadata)
}

function sourceSummaryLabels(record: ArchivedMessage): string[] {
  const content = asRecord(record.raw.content)
  const thoughts = Array.isArray(content?.thoughts) ? content.thoughts : []
  return [
    sourceMetadata(record)?.reasoning_title,
    ...thoughts.map((thought) => asRecord(thought)?.summary),
  ]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.replace(/\s+/g, ' ').trim())
}

type SavedDecorationSource = Pick<ConversationArchiveStore, 'listMessages'> & {
  listMessagesAround?: (id: string, messageId: string) => Promise<readonly ArchivedMessage[]>
}

function isFinalAnswer(record: ArchivedMessage) {
  return (
    record.role === 'assistant' &&
    (!record.channel || record.channel === 'final') &&
    ['text', 'multimodal_text'].includes(record.contentType ?? '')
  )
}

function hasConcreteConnectorPayload(record: ArchivedMessage) {
  const payload = sourceMetadata(record)?.connector_tool_payload
  if (typeof payload === 'string' && payload.trim()) return true
  const text = asRecord(record.raw.content)?.text
  if (typeof text !== 'string') return false
  try {
    return Boolean(asRecord(JSON.parse(text))?.path)
  } catch {
    return false
  }
}

export class ConversationDecoratorsModule implements BoosterModule {
  readonly id = 'conversation-decorators'

  #observer: ReturnType<typeof observeConversationDecorations> | undefined
  #activityObserver: ReturnType<typeof observeConversationActivity> | undefined
  #activityMounts = new Map<HTMLElement, MountedAgentActivity>()
  #activitySnapshots = new Map<HTMLElement, AgentActivitySnapshot>()
  #requestStatus: MountedRequestStatus | undefined
  #workWarning: MountedWorkModeWarning | undefined
  #latestActivity: AgentActivitySnapshot | null = null
  #ticker: ReturnType<typeof setInterval> | undefined
  #unsubscribe: (() => void) | undefined
  #stateUnsubscribe: (() => void) | undefined
  #accountUnsubscribe: (() => void) | undefined
  #timingUnsubscribe: (() => void) | undefined
  #settings: BoosterSettings | undefined
  #records = new Map<string, ArchivedMessage>()
  #turnRecords = new Map<string, ArchivedMessage[]>()
  #recordConversationId: string | null = null
  #messageMounts = new Map<HTMLElement, MountedMessageMetadata>()
  #summaryMounts = new Map<HTMLElement, MountedMessageMetadata>()
  #toolMounts = new Map<HTMLElement, MountedToolInspector>()
  #toolIdentities = new Map<HTMLElement, string>()
  #lastCleanupAt = 0
  #savedWindows = new Map<string, Promise<void>>()

  constructor(
    private settingsAdapter: SettingsAdapter,
    private store: SavedDecorationSource | undefined,
    private stateStore: ConversationStateStore = new ConversationStateStore(),
    private timing?: ConversationTimingPort,
  ) {}

  async start() {
    this.#timingUnsubscribe = this.timing?.subscribe(() => this.#refreshRequestStatus())
    this.#settings = await this.settingsAdapter.get()
    this.#unsubscribe = this.settingsAdapter.subscribe((next) => {
      const previous = this.#settings
      const languageChanged = next.language !== previous?.language
      const enabledChanged = next.enabled !== previous?.enabled
      const messageMetadataChanged = next.features.messageMetadata !== previous?.features.messageMetadata
      const activityIndicatorChanged =
        next.features.activityIndicator !== previous?.features.activityIndicator
      const toolInspectorChanged = next.features.toolInspector !== previous?.features.toolInspector
      const requestTimerChanged = next.features.requestTimer !== previous?.features.requestTimer
      const monitoringChanged = next.monitoring.intervalMs !== previous?.monitoring.intervalMs
      this.#settings = next
      if (
        !enabledChanged &&
        !languageChanged &&
        !messageMetadataChanged &&
        !activityIndicatorChanged &&
        !toolInspectorChanged &&
        !requestTimerChanged &&
        !monitoringChanged
      )
        return

      if (!next.enabled) {
        this.#stopObserver()
        this.#clear()
        return
      }

      if (languageChanged) {
        this.#clear()
        this.#activityObserver?.scan()
      }
      if (messageMetadataChanged && !next.features.messageMetadata) this.#clearMessageMetadata()
      if (toolInspectorChanged && !next.features.toolInspector) this.#clearToolInspectors()
      if (activityIndicatorChanged && !next.features.activityIndicator) this.#clearActivity()
      if (requestTimerChanged && !next.features.requestTimer) this.#clearRequestStatus()
      else if (requestTimerChanged || languageChanged) this.#refreshRequestStatus()
      if (monitoringChanged) this.#restartTicker()
      if (!this.#observer) {
        this.#syncRecordsFromState()
        this.#startObserver()
        this.#hydrateCurrentInBackground()
        return
      }
      this.#observer.scan()
    })
    this.#stateUnsubscribe = this.stateStore.subscribe((change) => {
      if (!this.#settings?.enabled) return
      const current = currentConversationId() ?? null
      if (change.conversationId !== current) return
      this.#syncRecordsFromState()
      this.#refreshWorkWarning()
      this.#refreshRequestStatus()
      this.#observer?.scan()
      this.#activityObserver?.scan()
    })
    this.#accountUnsubscribe = this.stateStore.subscribeAccount(() => {
      this.#records.clear()
      this.#turnRecords.clear()
      this.#recordConversationId = null
      this.#latestActivity = null
      this.#activitySnapshots.clear()
      this.#clear()
      if (this.#settings?.enabled) {
        this.#syncRecordsFromState()
        this.#observer?.scan()
        this.#hydrateCurrentInBackground()
      }
    })
    this.#restartTicker()
    if (this.#settings.enabled) {
      this.#syncRecordsFromState()
      this.#refreshWorkWarning()
      this.#refreshRequestStatus()
      this.#startObserver()
      this.#hydrateCurrentInBackground()
    }
  }

  #startObserver() {
    if (!this.#observer)
      this.#observer = observeConversationDecorations((targets, root) => {
        void this.#scan(targets, root)
      })
    if (!this.#activityObserver) this.#activityObserver = observeConversationActivity(this.#onActivity)
  }

  #stopObserver() {
    this.#observer?.stop()
    this.#observer = undefined
    this.#activityObserver?.stop()
    this.#activityObserver = undefined
    this.#clearActivity()
  }

  #onActivity = ({
    snapshot: observed,
    section,
    mount,
  }: {
    snapshot: AgentActivitySnapshot
    section: HTMLElement | null
    mount: HTMLElement | null
  }) => {
    const settings = this.#settings
    if (!settings?.enabled) return
    const snapshot = section ? this.#sourceActivity(section, observed) : this.#requestLifecycleSnapshot()
    if (!snapshot) return
    this.#latestActivity = snapshot

    this.#refreshWorkWarning()
    this.#refreshRequestStatus()

    if (!section) return
    if (snapshot.startedAt || snapshot.reasoningStartedAt || snapshot.completedAt)
      this.#activitySnapshots.set(section, snapshot)
    const assistantTarget = findConversationMessageTargets(section).find(
      (target) => target.role === 'assistant',
    )
    if (assistantTarget) this.#messageMounts.get(assistantTarget.message)?.updateActivity(snapshot)

    if (!settings.features.activityIndicator || !snapshot.active || !mount || !snapshot.phaseStartedAt) {
      const mounted = this.#activityMounts.get(section)
      mounted?.unmount()
      this.#activityMounts.delete(section)
      return
    }

    const locale = resolveLocale(settings.language)
    const mounted = this.#activityMounts.get(section)
    if (mounted?.element.isConnected && mount.contains(mounted.element)) {
      mounted.update(snapshot)
      return
    }
    mounted?.unmount()
    this.#activityMounts.set(section, mountAgentActivity(mount, snapshot, locale))
  }

  #tick = () => {
    const settings = this.#settings
    if (!settings?.enabled) return
    const now = Date.now()
    this.#refreshWorkWarning()
    this.#refreshRequestStatus()
    this.#requestStatus?.tick(now)
    for (const mounted of this.#activityMounts.values()) mounted.tick(now)
    for (const mounted of this.#messageMounts.values()) mounted.tick(now)
    for (const mounted of this.#summaryMounts.values()) mounted.tick(now)
    for (const mounted of this.#toolMounts.values()) mounted.tick(now)
  }

  #requestLifecycleSnapshot(): AgentActivitySnapshot | null {
    const conversationId = currentConversationId() ?? null
    if (!conversationId) return null
    const lifecycle = this.stateStore.lifecycle(conversationId)
    if (!lifecycle?.startedAt || !lifecycle.userMessageId) return null
    const active = lifecycle.state === 'in_progress' || lifecycle.state === 'stop_requested'
    const terminal = ['complete', 'stopped', 'cancelled', 'failed'].includes(lifecycle.state)
    const activity =
      this.#latestActivity?.turnId === lifecycle.userMessageId ? this.#latestActivity : null
    const review = this.stateStore.safetyReview(conversationId)
    const russian = resolveLocale(this.#settings?.language ?? 'auto') === 'ru'
    const transportLabel =
      lifecycle.transportHealth === 'interrupted'
        ? russian
          ? 'Поток прерван'
          : 'Stream interrupted'
        : lifecycle.transportHealth === 'unavailable'
          ? russian
            ? 'Восстановление потока недоступно'
            : 'Stream recovery unavailable'
          : null
    const phase = active
      ? (lifecycle.activityPhase ?? activity?.phase ?? 'thinking')
      : terminal
        ? 'complete'
        : 'idle'
    return {
      conversationId,
      turnId: lifecycle.userMessageId,
      active,
      phase,
      startedAt: lifecycle.startedAt,
      reasoningStartedAt: activity?.reasoningStartedAt ?? null,
      phaseStartedAt: lifecycle.phaseStartedAt ?? activity?.phaseStartedAt ?? lifecycle.startedAt,
      completedAt: lifecycle.completedAt ?? activity?.completedAt ?? null,
      lastActivityAt: lifecycle.lastActivityAt ?? activity?.lastActivityAt ?? null,
      lastSummaryAt: lifecycle.lastSummaryAt ?? null,
      previousSummaryAt: lifecycle.previousSummaryAt ?? null,
      durationMs:
        lifecycle.completedAt !== null ? Math.max(0, lifecycle.completedAt - lifecycle.startedAt) : null,
      reasoningDurationMs: activity?.reasoningDurationMs ?? null,
      label: review?.active ? review.message : (transportLabel ?? activity?.label ?? null),
      tool: activity?.tool ?? null,
    }
  }

  #refreshWorkWarning() {
    const settings = this.#settings
    const conversationId = currentConversationId() ?? null
    if (
      !settings?.enabled ||
      !conversationId ||
      !isChatGptWorkConversationOrigin(this.stateStore.conversationOrigin(conversationId))
    ) {
      this.#workWarning?.unmount()
      this.#workWarning = undefined
      return
    }
    const anchor = chatGptRequestStatusAnchor(document)
    if (!anchor) return
    const subagents = this.stateStore.subagents(conversationId).map((agent) => ({
      displayName: agent.displayName,
      status: agent.status,
    }))
    if (this.#workWarning?.element.isConnected) {
      this.#workWarning.update(subagents)
      return
    }
    this.#workWarning?.unmount()
    this.#workWarning = mountWorkModeWarning(anchor, subagents, resolveLocale(settings.language))
  }

  #refreshRequestStatus() {
    const settings = this.#settings
    if (!settings?.enabled || !settings.features.requestTimer) {
      this.#clearRequestStatus()
      return
    }
    const source = this.#requestLifecycleSnapshot()
    const conversationId = currentConversationId() ?? null
    const timing = this.timing?.current(conversationId)
    const snapshot: AgentActivitySnapshot | null = timing
      ? {
          conversationId,
          turnId: source?.turnId ?? timing.runId,
          active: timing.active,
          phase: timing.active ? (timing.phase ?? source?.phase ?? 'thinking') : 'complete',
          startedAt: source?.startedAt ?? timing.startedAt,
          completedAt: timing.completedAt,
          reasoningStartedAt: source?.reasoningStartedAt ?? null,
          phaseStartedAt: timing.phaseStartedAt ?? source?.phaseStartedAt ?? timing.startedAt,
          lastActivityAt: timing.lastActivityAt ?? source?.lastActivityAt ?? null,
          lastSummaryAt: timing.lastSummaryAt ?? source?.lastSummaryAt ?? null,
          previousSummaryAt: timing.previousSummaryAt ?? source?.previousSummaryAt ?? null,
          durationMs:
            timing.completedAt !== null
              ? Math.max(0, timing.completedAt - (source?.startedAt ?? timing.startedAt))
              : null,
          reasoningDurationMs: source?.reasoningDurationMs ?? null,
          label: source?.label ?? null,
          tool: source?.tool ?? null,
        }
      : source
    if (!snapshot?.active || !snapshot.startedAt) {
      this.#clearRequestStatus()
      return
    }
    const anchor = chatGptRequestStatusAnchor(document)
    if (!anchor) return
    const locale = resolveLocale(settings.language)
    if (this.#requestStatus?.element.isConnected) {
      this.#requestStatus.update(snapshot)
      return
    }
    this.#requestStatus?.unmount()
    this.#requestStatus = mountRequestStatus(anchor, snapshot, locale)
  }

  #restartTicker() {
    if (this.#ticker) clearInterval(this.#ticker)
    this.#ticker = undefined
    const interval = this.#settings?.monitoring.intervalMs
    if (!interval) return
    this.#ticker = setInterval(this.#tick, interval)
    this.#tick()
  }

  #clearRequestStatus() {
    this.#requestStatus?.unmount()
    this.#requestStatus = undefined
  }

  #clearWorkWarning() {
    this.#workWarning?.unmount()
    this.#workWarning = undefined
  }

  #clearMessageMetadata() {
    for (const mounted of this.#messageMounts.values()) mounted.unmount()
    this.#messageMounts.clear()
    for (const mounted of this.#summaryMounts.values()) mounted.unmount()
    this.#summaryMounts.clear()
  }

  #clearToolInspectors() {
    for (const mounted of this.#toolMounts.values()) mounted.unmount()
    this.#toolMounts.clear()
    this.#toolIdentities.clear()
  }

  #clearActivity() {
    for (const mounted of this.#activityMounts.values()) mounted.unmount()
    this.#activityMounts.clear()
  }

  stop() {
    this.#stopObserver()
    this.#clearRequestStatus()
    this.#clearWorkWarning()
    if (this.#ticker) clearInterval(this.#ticker)
    this.#ticker = undefined
    this.#latestActivity = null
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#stateUnsubscribe?.()
    this.#stateUnsubscribe = undefined
    this.#accountUnsubscribe?.()
    this.#accountUnsubscribe = undefined
    this.#timingUnsubscribe?.()
    this.#timingUnsubscribe = undefined
    this.#records.clear()
    this.#turnRecords.clear()
    this.#recordConversationId = null
    this.#activitySnapshots.clear()
    this.#lastCleanupAt = 0
    this.#clear()
  }

  #syncRecordsFromState() {
    const conversationId = currentConversationId() ?? null
    if (!conversationId || !this.stateStore.verifiedAccountId()) {
      this.#records.clear()
      this.#turnRecords.clear()
      this.#recordConversationId = null
      return
    }
    const records = this.stateStore
      .listMessages(conversationId)
      .filter((record) => asRecord(record.raw.metadata)?.booster_dom_snapshot !== true)
    this.#records = new Map(records.map((record) => [record.messageId, record]))
    this.#turnRecords.clear()
    for (const record of records)
      for (const [kind, id] of [
        ['exchange', record.turnExchangeId],
        ['working', record.workingTurnId],
      ]) {
        if (!id) continue
        const key = `${kind}:${id}`
        const items = this.#turnRecords.get(key) ?? []
        items.push(record)
        this.#turnRecords.set(key, items)
      }
    for (const items of this.#turnRecords.values())
      items.sort(
        (a, b) =>
          (sourceTime(a.createTime) ?? Number.POSITIVE_INFINITY) -
          (sourceTime(b.createTime) ?? Number.POSITIVE_INFINITY),
      )
    this.#recordConversationId = conversationId
  }

  #hydrateCurrentInBackground() {
    const conversationId = currentConversationId() ?? null
    if (!conversationId) return
    if (!this.store || !this.stateStore.verifiedAccountId()) return
    void this.stateStore.hydrate(conversationId, this.store).catch((error) => {
      console.warn('[ChatGPT Booster] Conversation state hydration failed', error)
    })
  }

  #turnItemsForSection(section: HTMLElement): ArchivedMessage[] {
    const conversationId = currentConversationId() ?? null
    if (!conversationId) return []
    return this.stateStore.recordsForMessageIds(conversationId, chatGptTurnMessageIds(section))
  }

  #networkPhase(items: ArchivedMessage[]): AgentActivitySnapshot['phase'] {
    const latest = items.filter((item) => item.role !== 'user').at(-1)
    if (!latest) return 'thinking'
    if (latest.role === 'tool' || (latest.recipient && latest.recipient !== 'all')) return 'tool'
    return isFinalAnswer(latest) ? 'responding' : 'thinking'
  }

  #sourceActivity(section: HTMLElement, observed: AgentActivitySnapshot): AgentActivitySnapshot {
    const items = this.#turnItemsForSection(section)
    const conversationId = currentConversationId() ?? null
    const lifecycle = conversationId ? this.stateStore.lifecycle(conversationId) : undefined
    const lifecycleMatchesTurn = Boolean(
      lifecycle &&
        (items.some((item) => item.messageId === lifecycle.userMessageId) ||
          observed.turnId === lifecycle.userMessageId),
    )
    const lifecycleActive = lifecycle
      ? (lifecycle.state === 'in_progress' || lifecycle.state === 'stop_requested') &&
        lifecycleMatchesTurn
      : false
    const ownFinal = items.some((item) => isFinalAnswer(item) && item.status === 'finished_successfully')
    const lifecyclePhase = lifecycleActive
      ? this.#networkPhase(items)
      : (lifecycleMatchesTurn &&
            ['complete', 'stopped', 'cancelled', 'failed'].includes(lifecycle?.state ?? '')) ||
          ownFinal
        ? 'complete'
        : 'idle'
    if (!items.length)
      return {
        ...observed,
        active: lifecycleActive,
        phase: lifecyclePhase,
        startedAt: lifecycle?.startedAt ?? null,
        reasoningStartedAt: null,
        phaseStartedAt: null,
        completedAt: null,
        lastActivityAt: null,
        durationMs: null,
        reasoningDurationMs: null,
        label: null,
        tool: null,
      }
    const ordered = [...items].sort(
      (a, b) =>
        (sourceTime(a.createTime) ?? Number.POSITIVE_INFINITY) -
        (sourceTime(b.createTime) ?? Number.POSITIVE_INFINITY),
    )
    const user = ordered.find((item) => item.role === 'user')
    const startedAt =
      sourceTime(user?.createTime) ?? (lifecycleMatchesTurn ? lifecycle?.startedAt : null) ?? null

    const reasoningStarts: number[] = []
    const reasoningEnds: number[] = []
    let recapLabel: string | null = null
    let explicitReasoningDuration: number | null = null
    for (const item of ordered) {
      const metadata = sourceMetadata(item)
      if (typeof metadata?.reasoning_start_time === 'number') {
        const value = sourceTime(metadata.reasoning_start_time)
        if (value) reasoningStarts.push(value)
      }
      if (typeof metadata?.reasoning_end_time === 'number') {
        const value = sourceTime(metadata.reasoning_end_time)
        if (value) reasoningEnds.push(value)
      }
      if (item.contentType === 'thoughts' || item.contentType === 'reasoning_recap') {
        const value = sourceTime(item.createTime)
        if (value) {
          if (!reasoningStarts.length) reasoningStarts.push(value)
          reasoningEnds.push(value)
        }
      }
      if (item.contentType === 'reasoning_recap') {
        recapLabel = archiveRecordText(item) || recapLabel
        if (typeof metadata?.finished_duration_sec === 'number')
          explicitReasoningDuration = Math.max(0, metadata.finished_duration_sec * 1000)
      }
    }
    if (!reasoningStarts.length) {
      const firstAgentEvent = ordered.find(
        (item) =>
          item.role === 'assistant' &&
          (!isFinalAnswer(item) || Boolean(item.recipient && item.recipient !== 'all')),
      )
      const fallback = sourceTime(firstAgentEvent?.createTime)
      if (fallback) reasoningStarts.push(fallback)
    }
    const reasoningStartedAt = reasoningStarts.length ? Math.min(...reasoningStarts) : null

    const toolPairs = this.#toolCallRecords(section)
    const latestToolPair = toolPairs.at(-1)
    const latestTool = latestToolPair
      ? toolInvocationFromRecord(latestToolPair.call, latestToolPair.result)
      : null
    const final = [...ordered].reverse().find(isFinalAnswer)
    const finalStartedAt = sourceTime(final?.createTime)
    const finalCompletedAt =
      final && final.status === 'finished_successfully'
        ? (sourceTime(final.updateTime) ?? finalStartedAt)
        : null
    const recapCompletedAt = [...ordered]
      .reverse()
      .find((item) => item.contentType === 'reasoning_recap')
    const completedAt =
      (lifecycleMatchesTurn ? lifecycle?.completedAt : null) ??
      (lifecyclePhase === 'complete'
        ? (finalCompletedAt ?? sourceTime(recapCompletedAt?.createTime))
        : null)

    const eventTimes = ordered
      .filter((item) => item.role !== 'user')
      .flatMap((item) => {
        const created = sourceTime(item.createTime)
        const finalUpdated = isFinalAnswer(item) ? sourceTime(item.updateTime) : null
        return [created, finalUpdated].filter((value): value is number => value !== null)
      })
    const lastActivityAt =
      (lifecycleMatchesTurn ? lifecycle?.lastActivityAt : null) ??
      (eventTimes.length ? Math.max(...eventTimes) : null)

    let phaseStartedAt: number | null = null
    if (lifecyclePhase === 'thinking')
      phaseStartedAt = reasoningStartedAt ?? lifecycle?.startedAt ?? null
    else if (lifecyclePhase === 'tool')
      phaseStartedAt = latestTool?.timestamp ? sourceTime(latestTool.timestamp) : null
    else if (lifecyclePhase === 'responding') phaseStartedAt = finalStartedAt
    else if (lifecyclePhase === 'complete') phaseStartedAt = completedAt

    let reasoningCompletedAt = reasoningEnds.length ? Math.max(...reasoningEnds) : null
    if (!reasoningCompletedAt && completedAt) reasoningCompletedAt = finalStartedAt ?? completedAt
    const reasoningDurationMs =
      explicitReasoningDuration ??
      (reasoningStartedAt && reasoningCompletedAt
        ? Math.max(0, reasoningCompletedAt - reasoningStartedAt)
        : null)

    return {
      ...observed,
      active: lifecycleActive,
      phase: lifecyclePhase,
      startedAt,
      reasoningStartedAt,
      phaseStartedAt,
      completedAt,
      lastActivityAt,
      lastSummaryAt: lifecycleMatchesTurn ? (lifecycle?.lastSummaryAt ?? null) : null,
      previousSummaryAt: lifecycleMatchesTurn ? (lifecycle?.previousSummaryAt ?? null) : null,
      durationMs: startedAt && completedAt ? Math.max(0, completedAt - startedAt) : null,
      reasoningDurationMs,
      label: recapLabel,
      tool: lifecyclePhase === 'tool' ? latestTool : null,
    }
  }

  #historicalActivity(target: ConversationMessageTarget): AgentActivitySnapshot | null {
    if (target.role !== 'assistant') return null
    const snapshot = this.#sourceActivity(target.section, {
      conversationId: currentConversationId() ?? null,
      turnId: chatGptTurnId(target.section),
      active: false,
      phase: 'complete',
      startedAt: null,
      reasoningStartedAt: null,
      phaseStartedAt: null,
      completedAt: null,
      lastActivityAt: null,
      durationMs: null,
      reasoningDurationMs: null,
      label: null,
      tool: null,
    })
    return snapshot.startedAt || snapshot.reasoningStartedAt || snapshot.completedAt ? snapshot : null
  }

  #toolCallRecords(section: HTMLElement): Array<{
    call: ArchivedMessage
    result: ArchivedMessage | null
  }> {
    const anchors = chatGptTurnMessageIds(section)
      .map((id) => this.#records.get(id))
      .filter((record): record is ArchivedMessage => Boolean(record))
    const members = new Map(anchors.map((record) => [record.messageId, record]))
    for (const anchor of anchors) {
      const key = anchor.turnExchangeId
        ? `exchange:${anchor.turnExchangeId}`
        : anchor.workingTurnId
          ? `working:${anchor.workingTurnId}`
          : null
      if (!key) continue
      for (const record of this.#turnRecords.get(key) ?? []) members.set(record.messageId, record)
      if (anchor.turnExchangeId && anchor.workingTurnId) {
        for (const record of this.#turnRecords.get(`working:${anchor.workingTurnId}`) ?? []) {
          if (record.turnExchangeId && record.turnExchangeId !== anchor.turnExchangeId) continue
          members.set(record.messageId, record)
        }
      }
    }
    const items = [...members.values()].sort(
      (a, b) =>
        (sourceTime(a.createTime) ?? Number.POSITIVE_INFINITY) -
        (sourceTime(b.createTime) ?? Number.POSITIVE_INFINITY),
    )
    const candidates = items.filter(
      (item) =>
        item.role === 'assistant' &&
        Boolean(item.recipient && item.recipient !== 'all') &&
        Boolean(toolInvocationFromRecord(item)),
    )
    // Preserve the legacy source graph rule: a concrete connector child
    // represents its execution wrapper; neither labels nor DOM order decide it.
    const wrappers = new Set(
      candidates
        .filter(hasConcreteConnectorPayload)
        .map((call) => call.parentId)
        .filter(Boolean),
    )
    return candidates
      .filter((call) => !wrappers.has(call.messageId))
      .map((call) => ({
        call,
        // Time/order is not a correlation key, even within one native turn.
        result:
          [...this.#records.values()].find(
            (record) => record.role === 'tool' && record.parentId === call.messageId,
          ) ?? null,
      }))
  }

  #toolModel(
    pair: { call: ArchivedMessage; result: ArchivedMessage | null },
    section: HTMLElement,
    locale: ReturnType<typeof resolveLocale>,
  ): ToolCallViewModel | null {
    const tool = toolInvocationFromRecord(pair.call, pair.result)
    if (!tool) return null
    return {
      id: pair.call.messageId,
      tool,
      locale,
      structuredPayloads: [],
      attributes: {},
      visibleText: '',
      score: 0,
      signals: ['source-record'],
      active: Boolean(
        this.#latestActivity?.active &&
          this.#latestActivity.phase === 'tool' &&
          this.#latestActivity.turnId === chatGptTurnId(section) &&
          !tool.finishedAt,
      ),
    }
  }

  async #scan(targets: ConversationMessageTarget[], root: ParentNode) {
    const settings = this.#settings
    if (!settings?.enabled) {
      this.#clear()
      return
    }
    const current = currentConversationId() ?? null
    if (current !== this.#recordConversationId) {
      this.#syncRecordsFromState()
      this.#hydrateCurrentInBackground()
    }
    const readAround = this.store?.listMessagesAround
    const epoch = this.stateStore.accountEpoch()
    if (current && readAround && this.stateStore.verifiedAccountId()) {
      const missing = [...new Set(targets.map((target) => target.messageId))]
        .filter((id) => !this.#records.has(id))
        .slice(0, 16)
      await Promise.all(
        missing.map((id) => {
          const key = JSON.stringify([epoch, current, id])
          let pending = this.#savedWindows.get(key)
          if (!pending) {
            pending = this.stateStore
              .hydrateSavedWindow(current, () => readAround(current, id))
              .catch(() => {
                this.#savedWindows.delete(key)
              })
            this.#savedWindows.set(key, pending)
            if (this.#savedWindows.size > 128) {
              const oldest = this.#savedWindows.keys().next().value
              if (oldest !== undefined) this.#savedWindows.delete(oldest)
            }
          }
          return pending
        }),
      )
      if (
        !this.#settings?.enabled ||
        current !== currentConversationId() ||
        epoch !== this.stateStore.accountEpoch()
      )
        return
      this.#syncRecordsFromState()
    }
    const locale = resolveLocale(settings.language)

    for (const target of targets) {
      const record = this.#records.get(target.messageId)
      if (
        !this.stateStore.verifiedAccountId() ||
        !record ||
        record.conversationId !== current ||
        record.role !== target.role
      ) {
        this.#messageMounts.get(target.message)?.unmount()
        this.#messageMounts.delete(target.message)
        continue
      }
      const metadata = archiveRecordMetadata(record)
      if (settings.features.messageMetadata) {
        const activity =
          target.role === 'assistant'
            ? (this.#activitySnapshots.get(target.section) ?? this.#historicalActivity(target))
            : null
        const view = { ...metadata, raw: record?.raw ?? null, activity }
        const mounted = this.#messageMounts.get(target.message)
        if (mounted?.element.isConnected && target.metadataMount.contains(mounted.element)) {
          mounted.update(view)
        } else {
          mounted?.unmount()
          this.#messageMounts.set(
            target.message,
            mountMessageMetadata(target.metadataMount, view, locale),
          )
        }
      }
    }

    if (
      (settings.features.toolInspector || settings.features.messageMetadata) &&
      this.stateStore.verifiedAccountId()
    ) {
      const sections = findChatGptTurnRoots(root)
      const exactSlots = findChatGptToolActionSlots(root)
      const retainedSlots = new Set<HTMLElement>()
      const retainedSummaries = new Set<HTMLElement>()
      for (const section of sections) {
        const pairs = this.#toolCallRecords(section)
        const records = this.#turnItemsForSection(section)
        // Reuse the legacy native row placement. An exact, unique source title
        // locates presentation only; source IDs own all models and result links.
        const summarySlots = chatGptToolActivityRows(section).flatMap((element) => {
          if (!isChatGptPlacementVisible(element)) return []
          const title = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
          const matches = records.filter((record) => sourceSummaryLabels(record).includes(title))
          const source = matches.length === 1 ? matches[0] : undefined
          if (!source) return []
          const direct = pairs.filter(
            (pair) =>
              pair.call.messageId === source.messageId ||
              pair.result?.messageId === source.messageId ||
              pair.call.messageId === source.parentId,
          )
          const wrapper = source.parentId ? this.#records.get(source.parentId) : undefined
          const linked = direct.length
            ? direct
            : wrapper?.role === 'assistant' && wrapper.recipient && wrapper.recipient !== 'all'
              ? pairs.filter((pair) => pair.call.parentId === wrapper.messageId)
              : []
          return [
            {
              element,
              section,
              source,
              sourceId: linked.length === 1 ? linked[0]?.call.messageId : undefined,
            },
          ]
        })
        for (const slot of summarySlots) {
          if (!settings.features.messageMetadata) continue
          const time = sourceTime(slot.source.createTime)
          const previousTime =
            records
              .filter((record) => sourceSummaryLabels(record).length)
              .map((record) => sourceTime(record.createTime))
              .filter((value): value is number => value !== null && value < (time ?? -Infinity))
              .sort((a, b) => a - b)
              .at(-1) ?? null
          const view = {
            ...archiveRecordMetadata(slot.source),
            raw: slot.source.raw,
            summaryIntervalMs: time !== null && previousTime !== null ? time - previousTime : null,
          }
          const metadata = this.#summaryMounts.get(slot.element)
          if (
            metadata?.element.isConnected &&
            metadata.element.dataset.sourceMessageId === slot.source.messageId
          )
            metadata.update(view)
          else {
            metadata?.unmount()
            const next = mountMessageMetadata(slot.element, view, locale)
            next.element.dataset.sourceMessageId = slot.source.messageId
            this.#summaryMounts.set(slot.element, next)
          }
          retainedSummaries.add(slot.element)
        }
        const placed = new Set<string>()
        for (const slot of [
          ...exactSlots.filter((candidate) => candidate.section === section),
          ...summarySlots,
        ]) {
          // Neither a DOM label nor a neighboring call is a source identity.
          const pair = pairs.find(
            (candidate) =>
              candidate.call.messageId === slot.sourceId ||
              candidate.result?.messageId === slot.sourceId,
          )
          if (!pair || placed.has(pair.call.messageId)) continue
          const model = this.#toolModel(pair, section, locale)
          if (!model) continue
          placed.add(pair.call.messageId)
          if (!settings.features.toolInspector) continue
          retainedSlots.add(slot.element)
          const mounted = this.#toolMounts.get(slot.element)
          if (
            mounted?.element.isConnected &&
            slot.element.contains(mounted.element) &&
            this.#toolIdentities.get(slot.element) === pair.call.messageId
          )
            mounted.update(model)
          else {
            mounted?.unmount()
            this.#toolMounts.set(slot.element, mountToolInspector(slot.element, model))
            this.#toolIdentities.set(slot.element, pair.call.messageId)
          }
        }
      }
      for (const [slot, mounted] of this.#toolMounts) {
        if ((root !== document && !root.contains(slot)) || retainedSlots.has(slot)) continue
        mounted.unmount()
        this.#toolMounts.delete(slot)
        this.#toolIdentities.delete(slot)
      }
      for (const [slot, mounted] of this.#summaryMounts) {
        if ((root !== document && !root.contains(slot)) || retainedSummaries.has(slot)) continue
        mounted.unmount()
        this.#summaryMounts.delete(slot)
      }
    } else this.#clearToolInspectors()

    this.#cleanupDisconnected(root === document)
  }

  #cleanupDisconnected(force = false) {
    const now = Date.now()
    if (!force && now - this.#lastCleanupAt < 2_000) return
    this.#lastCleanupAt = now
    for (const [target, mounted] of this.#messageMounts) {
      if (target.isConnected && mounted.element.isConnected && isChatGptPlacementVisible(target))
        continue
      mounted.unmount()
      this.#messageMounts.delete(target)
    }
    for (const [target, mounted] of this.#summaryMounts) {
      if (target.isConnected && mounted.element.isConnected && isChatGptPlacementVisible(target))
        continue
      mounted.unmount()
      this.#summaryMounts.delete(target)
    }
    for (const [target, mounted] of this.#toolMounts) {
      if (target.isConnected && mounted.element.isConnected && isChatGptPlacementVisible(target))
        continue
      mounted.unmount()
      this.#toolMounts.delete(target)
      this.#toolIdentities.delete(target)
    }
    for (const [section, mounted] of this.#activityMounts) {
      if (
        section.isConnected &&
        mounted.element.isConnected &&
        isChatGptPlacementVisible(mounted.element)
      )
        continue
      mounted.unmount()
      this.#activityMounts.delete(section)
    }
  }

  #clear() {
    this.#savedWindows.clear()
    this.#clearRequestStatus()
    this.#clearWorkWarning()
    this.#clearMessageMetadata()
    this.#clearToolInspectors()
    this.#clearActivity()
  }
}
