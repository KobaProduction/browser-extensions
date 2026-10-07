import {
  archiveRecordMetadata,
  archiveRecordText,
  asRecord,
  type ConversationMessageTarget,
  chatGptRequestStatusAnchor,
  chatGptTurnId,
  chatGptTurnMessageIds,
  chatGptWorkSubagentActivity,
  chatGptWorkSubagentUsageCount,
  conversationDomSnapshotFromTargets,
  currentConversationId,
  findChatGptTurnRoot,
  findConversationMessageTargets,
  findToolCallEvidence,
  isChatGptWorkConversationOrigin,
  observeConversationActivity,
  observeConversationDecorations,
  resolveChatGptDomAdapter,
  toolInvocationFromEvidence,
  toolInvocationFromRecord,
} from '@chatgpt-booster/chatgpt'
import {
  AGENT_ACTIVITY_EVENT,
  type AgentActivitySnapshot,
  type BoosterModule,
  type BoosterSettings,
  type ConversationItemMetadataView,
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
} from '@chatgpt-booster/ui'
import type { ArchivedMessage, ConversationArchiveStore } from './archive-store'
import {
  claimSessionAlert,
  conversationCriticalAlertKey,
  conversationTerminalAlert,
} from './conversation-alerts'
import { ConversationStateStore } from './conversation-state'

const UNKNOWN_METADATA: ConversationItemMetadataView = {
  sentAt: null,
  editedAt: null,
  edited: false,
  model: null,
  thinking: null,
}

function sourceTime(value: number | null | undefined): number | null {
  const normalized = serverTimeMs(value, 0)
  return normalized > 0 ? normalized : null
}

function sourceMetadata(record: ArchivedMessage) {
  return asRecord(record.raw.metadata)
}

function isFinalAnswer(record: ArchivedMessage) {
  return (
    record.role === 'assistant' &&
    (!record.channel || record.channel === 'final') &&
    ['text', 'multimodal_text'].includes(record.contentType ?? '')
  )
}

function hasConcreteConnectorPayload(record: ArchivedMessage) {
  const metadata = sourceMetadata(record)
  if (
    typeof metadata?.connector_tool_payload === 'string' &&
    metadata.connector_tool_payload.trim()
  )
    return true
  const content = asRecord(record.raw.content)
  if (typeof content?.text !== 'string') return false
  try {
    const parsed = JSON.parse(content.text) as unknown
    return Boolean(asRecord(parsed)?.path)
  } catch {
    return false
  }
}

function playActivityTone(kind: 'complete' | 'long' | 'critical') {
  try {
    const context = new AudioContext()
    const gain = context.createGain()
    gain.connect(context.destination)
    const now = context.currentTime
    const critical = kind === 'critical'
    const notes = critical
      ? Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? 980 : 760))
      : kind === 'complete'
        ? [660, 880]
        : [360, 300]
    const spacing = critical ? 0.24 : 0.12
    const duration = critical ? 0.12 : 0.1
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      oscillator.connect(gain)
      const start = now + index * spacing
      oscillator.start(start)
      oscillator.stop(start + duration)
    })
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.015)
    if (critical) {
      gain.gain.setValueAtTime(0.11, now + 2.16)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.36)
      window.setTimeout(() => void context.close(), 2_600)
    } else {
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
      window.setTimeout(() => void context.close(), 500)
    }
  } catch {}
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
  #longAlertedTurnId: string | null = null
  #completedAlertedTurnId: string | null = null
  #criticalAlertedRunKey: string | null = null
  #activeObservedTurnIds = new Set<string>()
  #ticker: ReturnType<typeof setInterval> | undefined
  #unsubscribe: (() => void) | undefined
  #stateUnsubscribe: (() => void) | undefined
  #settings: BoosterSettings | undefined
  #records = new Map<string, ArchivedMessage>()
  #turnRecords = new Map<string, ArchivedMessage[]>()
  #recordConversationId: string | null = null
  #messageMounts = new Map<HTMLElement, MountedMessageMetadata>()
  #toolMounts = new Map<HTMLElement, MountedToolInspector>()
  #lastCleanupAt = 0

  constructor(
    private settingsAdapter: SettingsAdapter,
    private store: ConversationArchiveStore,
    private stateStore: ConversationStateStore = new ConversationStateStore(),
  ) {}

  async start() {
    this.#settings = await this.settingsAdapter.get()
    this.#unsubscribe = this.settingsAdapter.subscribe((next) => {
      const previous = this.#settings
      const languageChanged = next.language !== previous?.language
      const enabledChanged = next.enabled !== previous?.enabled
      const messageMetadataChanged =
        next.features.messageMetadata !== previous?.features.messageMetadata
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
    if (!this.#activityObserver)
      this.#activityObserver = observeConversationActivity(this.#onActivity)
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
    const conversationId = currentConversationId() ?? null
    if (conversationId && section)
      this.stateStore.observeRendererState(
        conversationId,
        resolveChatGptDomAdapter(section)?.turnState(section) ?? null,
        chatGptTurnId(section),
      )
    const snapshot = section ? this.#sourceActivity(section, observed) : observed
    window.dispatchEvent(new CustomEvent(AGENT_ACTIVITY_EVENT, { detail: snapshot }))

    if (this.#latestActivity?.turnId !== snapshot.turnId) {
      this.#longAlertedTurnId = null
      this.#completedAlertedTurnId = null
      this.#criticalAlertedRunKey = null
    }
    if (snapshot.active && snapshot.turnId) this.#activeObservedTurnIds.add(snapshot.turnId)
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

    if (
      !settings.features.activityIndicator ||
      !snapshot.active ||
      !mount ||
      !snapshot.phaseStartedAt
    ) {
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
    for (const mounted of this.#toolMounts.values()) mounted.tick(now)

    const snapshot = this.#requestLifecycleSnapshot() ?? this.#latestActivity
    if (!snapshot?.turnId) return
    const conversationId = currentConversationId() ?? null
    const lifecycle = conversationId ? this.stateStore.lifecycle(conversationId) : undefined
    const sourceAlert =
      lifecycle?.userMessageId === snapshot.turnId ? conversationTerminalAlert(lifecycle) : null
    const alertKind =
      sourceAlert ?? (!lifecycle && snapshot.phase === 'complete' ? 'complete' : null)

    if (alertKind === 'conversation_exhausted' && conversationId && lifecycle) {
      const alertKey = conversationCriticalAlertKey(conversationId, lifecycle)
      if (alertKey && this.#criticalAlertedRunKey !== alertKey) {
        this.#criticalAlertedRunKey = alertKey
        if (claimSessionAlert(window.sessionStorage, alertKey)) {
          window.dispatchEvent(
            new CustomEvent('chatgpt-booster:conversation-exhausted', { detail: snapshot }),
          )
          playActivityTone('critical')
        }
      }
      this.#activeObservedTurnIds.delete(snapshot.turnId)
    } else if (
      alertKind === 'complete' &&
      this.#activeObservedTurnIds.has(snapshot.turnId) &&
      this.#completedAlertedTurnId !== snapshot.turnId
    ) {
      this.#completedAlertedTurnId = snapshot.turnId
      window.dispatchEvent(
        new CustomEvent('chatgpt-booster:response-complete', { detail: snapshot }),
      )
      if (settings.alerts.responseCompleteSound) playActivityTone('complete')
      this.#activeObservedTurnIds.delete(snapshot.turnId)
    }
    if (
      settings.alerts.longRunningSound &&
      snapshot.active &&
      snapshot.startedAt &&
      this.#longAlertedTurnId !== snapshot.turnId &&
      now - snapshot.startedAt >= settings.alerts.longRunningThresholdMs
    ) {
      this.#longAlertedTurnId = snapshot.turnId
      window.dispatchEvent(new CustomEvent('chatgpt-booster:long-running', { detail: snapshot }))
      playActivityTone('long')
    }
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
    const phase = active ? (activity?.phase ?? 'thinking') : terminal ? 'complete' : 'idle'
    return {
      conversationId,
      turnId: lifecycle.userMessageId,
      active,
      phase,
      startedAt: lifecycle.startedAt,
      reasoningStartedAt: activity?.reasoningStartedAt ?? null,
      phaseStartedAt: activity?.phaseStartedAt ?? null,
      completedAt: lifecycle.completedAt ?? activity?.completedAt ?? null,
      lastActivityAt: activity?.lastActivityAt ?? null,
      durationMs:
        lifecycle.completedAt !== null
          ? Math.max(0, lifecycle.completedAt - lifecycle.startedAt)
          : null,
      reasoningDurationMs: activity?.reasoningDurationMs ?? null,
      label: activity?.label ?? null,
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
    const nativeUsageCount = chatGptWorkSubagentUsageCount(document)
    let missingFromSource =
      nativeUsageCount === null ? 0 : Math.max(0, nativeUsageCount - subagents.length)
    for (const live of chatGptWorkSubagentActivity(document)) {
      if (live.status !== 'working' || missingFromSource <= 0) continue
      const alreadyWorking = subagents.some(
        (agent) =>
          agent.status === 'working' &&
          agent.displayName?.toLocaleLowerCase() === live.displayName?.toLocaleLowerCase(),
      )
      if (alreadyWorking) continue
      subagents.push({
        displayName: live.displayName,
        status: 'working',
      })
      missingFromSource -= 1
    }
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
    const snapshot = this.#requestLifecycleSnapshot()
    if (!snapshot?.active || !snapshot.startedAt) {
      this.#clearRequestStatus()
      return
    }
    if (snapshot.turnId) this.#activeObservedTurnIds.add(snapshot.turnId)
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
    this.#longAlertedTurnId = null
    this.#completedAlertedTurnId = null
    this.#activeObservedTurnIds.clear()
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#stateUnsubscribe?.()
    this.#stateUnsubscribe = undefined
    this.#records.clear()
    this.#turnRecords.clear()
    this.#recordConversationId = null
    this.#activitySnapshots.clear()
    this.#lastCleanupAt = 0
    this.#clear()
  }

  #syncRecordsFromState() {
    const conversationId = currentConversationId() ?? null
    if (!conversationId) {
      this.#records.clear()
      this.#turnRecords.clear()
      this.#recordConversationId = null
      return
    }
    const records = this.stateStore.listMessages(conversationId)
    this.#records = new Map(records.map((record) => [record.messageId, record]))
    this.#turnRecords.clear()
    for (const record of records)
      for (const key of new Set([record.turnExchangeId, record.workingTurnId])) {
        if (!key) continue
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
    void this.stateStore.hydrate(conversationId, this.store).catch((error) => {
      console.warn('[ChatGPT Booster] Conversation state hydration failed', error)
    })
  }

  #turnItemsForSection(section: HTMLElement): ArchivedMessage[] {
    const conversationId = currentConversationId() ?? null
    if (!conversationId) return []
    return this.stateStore.recordsForMessageIds(conversationId, chatGptTurnMessageIds(section))
  }

  #sourceActivity(section: HTMLElement, observed: AgentActivitySnapshot): AgentActivitySnapshot {
    const items = this.#turnItemsForSection(section)
    const conversationId = currentConversationId() ?? null
    const lifecycle = conversationId ? this.stateStore.lifecycle(conversationId) : undefined
    const lifecycleActive = lifecycle
      ? lifecycle.state === 'in_progress' || lifecycle.state === 'stop_requested'
      : observed.active
    const lifecyclePhase = lifecycleActive
      ? observed.phase
      : lifecycle?.state === 'complete' ||
          lifecycle?.state === 'stopped' ||
          lifecycle?.state === 'cancelled' ||
          lifecycle?.state === 'failed'
        ? 'complete'
        : observed.phase
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
      }
    const ordered = [...items].sort(
      (a, b) =>
        (sourceTime(a.createTime) ?? Number.POSITIVE_INFINITY) -
        (sourceTime(b.createTime) ?? Number.POSITIVE_INFINITY),
    )
    const user = ordered.find((item) => item.role === 'user')
    const startedAt = sourceTime(user?.createTime) ?? lifecycle?.startedAt ?? null

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
      final && (final.status === 'finished_successfully' || observed.phase === 'complete')
        ? (sourceTime(final.updateTime) ?? finalStartedAt)
        : null
    const recapCompletedAt = [...ordered]
      .reverse()
      .find((item) => item.contentType === 'reasoning_recap')
    const completedAt =
      lifecycle?.completedAt ??
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
    const lastActivityAt = eventTimes.length ? Math.max(...eventTimes) : null

    let phaseStartedAt: number | null = null
    if (lifecyclePhase === 'thinking') phaseStartedAt = reasoningStartedAt
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
      durationMs: startedAt && completedAt ? Math.max(0, completedAt - startedAt) : null,
      reasoningDurationMs,
      label: observed.label ?? recapLabel,
      tool: lifecyclePhase === 'tool' ? (latestTool ?? observed.tool) : observed.tool,
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
    return snapshot.startedAt || snapshot.reasoningStartedAt || snapshot.completedAt
      ? snapshot
      : null
  }

  #toolTitleTokens(value: string | null | undefined) {
    return new Set(
      (value ?? '')
        .toLocaleLowerCase()
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => (token.length > 5 ? token.slice(0, 5) : token)),
    )
  }

  #toolTitleSimilarity(left: string | null | undefined, right: string | null | undefined) {
    const a = this.#toolTitleTokens(left)
    const b = this.#toolTitleTokens(right)
    if (!a.size || !b.size) return 0
    let overlap = 0
    for (const token of a) if (b.has(token)) overlap += 1
    return overlap / Math.max(a.size, b.size)
  }

  #toolReasoningTitle(pair: { call: ArchivedMessage; result: ArchivedMessage | null }) {
    const callMetadata = sourceMetadata(pair.call)
    const resultMetadata = pair.result ? sourceMetadata(pair.result) : undefined
    return (
      [callMetadata?.reasoning_title, resultMetadata?.reasoning_title]
        .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        ?.replace(/\s+/g, ' ')
        .trim() ?? null
    )
  }

  #toolRecordForEvidence(
    evidence: ReturnType<typeof findToolCallEvidence>[number],
    records: Array<{ call: ArchivedMessage; result: ArchivedMessage | null }>,
    used: Set<string>,
    fallbackIndex: number,
    evidenceCount: number,
  ) {
    const visible = evidence.visibleText.replace(/\s+/g, ' ').trim()
    const titled = records
      .filter((pair) => !used.has(pair.call.messageId))
      .map((pair) => ({
        pair,
        score: this.#toolTitleSimilarity(this.#toolReasoningTitle(pair), visible),
      }))
      .filter((candidate) => candidate.score >= 0.6)
      .sort((a, b) => b.score - a.score)[0]?.pair
    if (titled) return titled
    const only = records.length === 1 ? records[0] : undefined
    if (only && !used.has(only.call.messageId)) return only
    if (records.length === evidenceCount) {
      const fallback = records[fallbackIndex]
      if (fallback && !used.has(fallback.call.messageId)) return fallback
    }
    return null
  }

  #toolCallRecords(section: HTMLElement): Array<{
    call: ArchivedMessage
    result: ArchivedMessage | null
  }> {
    const messageIds = chatGptTurnMessageIds(section)
    const anchor = messageIds.map((id) => this.#records.get(id)).find(Boolean)
    const key = anchor?.turnExchangeId ?? anchor?.workingTurnId
    if (!key) return []
    const items = this.#turnRecords.get(key) ?? []
    const candidates = items.filter(
      (item) =>
        item.role === 'assistant' &&
        Boolean(item.recipient && item.recipient !== 'all') &&
        Boolean(toolInvocationFromRecord(item)),
    )
    const concrete = candidates.filter(hasConcreteConnectorPayload)
    const wrappedIds = new Set(
      concrete.map((item) => item.parentId).filter((value): value is string => Boolean(value)),
    )
    const calls = candidates.filter((item) => !wrappedIds.has(item.messageId))
    return calls.map((call, index) => {
      const callTime = sourceTime(call.createTime)
      const nextCall = calls[index + 1]
      const nextCallTime = nextCall ? sourceTime(nextCall.createTime) : null
      const direct = items.find((item) => item.role === 'tool' && item.parentId === call.messageId)
      const adjacent =
        callTime === null
          ? undefined
          : items.find((item) => {
              if (item.role !== 'tool') return false
              const time = sourceTime(item.createTime)
              return (
                time !== null && time >= callTime && (nextCallTime === null || time < nextCallTime)
              )
            })
      return { call, result: direct ?? adjacent ?? null }
    })
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
    const missingTargets = targets.filter((target) => !this.#records.has(target.messageId))
    const snapshot = missingTargets.length
      ? conversationDomSnapshotFromTargets(missingTargets)
      : undefined
    if (snapshot) this.stateStore.ingestDomSnapshot(snapshot)
    const locale = resolveLocale(settings.language)

    for (const target of targets) {
      const record = this.#records.get(target.messageId)
      const metadata = record ? archiveRecordMetadata(record) : UNKNOWN_METADATA
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

    if (settings.features.toolInspector) {
      const toolRoot = root === document ? (document.querySelector('main') ?? root) : root
      const evidenceList = findToolCallEvidence(toolRoot)
      const bySection = new Map<HTMLElement, typeof evidenceList>()
      for (const evidence of evidenceList) {
        const section = findChatGptTurnRoot(evidence.element)
        if (!section) continue
        const list = bySection.get(section) ?? []
        list.push(evidence)
        bySection.set(section, list)
      }
      for (const [section, evidences] of bySection) {
        const records = this.#toolCallRecords(section)
        const usedRecords = new Set<string>()
        for (const [index, evidence] of evidences.entries()) {
          const observed = toolInvocationFromEvidence(evidence)
          const pair = this.#toolRecordForEvidence(
            evidence,
            records,
            usedRecords,
            index,
            evidences.length,
          )
          if (records.length && !pair) {
            this.#toolMounts.get(evidence.element)?.unmount()
            this.#toolMounts.delete(evidence.element)
            continue
          }
          if (pair) usedRecords.add(pair.call.messageId)
          const archived = pair ? toolInvocationFromRecord(pair.call, pair.result) : null
          const tool = archived
            ? {
                ...observed,
                ...archived,
                payload: archived.payload ?? observed.payload,
                iconUrl: archived.iconUrl ?? observed.iconUrl,
                iconKey: archived.iconKey ?? observed.iconKey,
              }
            : observed
          if (!tool.timestamp) {
            const messageId = chatGptTurnMessageIds(section)
              .map((id) => (this.#records.has(id) ? id : null))
              .find((id): id is string => Boolean(id))
            const record = messageId ? this.#records.get(messageId) : undefined
            const metadata = record ? archiveRecordMetadata(record) : undefined
            tool.timestamp = metadata?.sentAt ?? null
          }
          const model = {
            id: evidence.id,
            tool,
            locale,
            structuredPayloads: evidence.structuredPayloads,
            attributes: evidence.attributes,
            visibleText: evidence.visibleText,
            score: evidence.score,
            signals: evidence.signals,
            active: Boolean(
              this.#latestActivity?.active &&
                this.#latestActivity.phase === 'tool' &&
                this.#latestActivity.turnId === chatGptTurnId(section) &&
                !tool.finishedAt &&
                index === evidences.length - 1,
            ),
          }
          const mounted = this.#toolMounts.get(evidence.element)
          if (mounted?.element.isConnected) mounted.update(model)
          else {
            mounted?.unmount()
            this.#toolMounts.set(evidence.element, mountToolInspector(evidence.element, model))
          }
        }
      }
    } else {
      for (const mounted of this.#toolMounts.values()) mounted.unmount()
      this.#toolMounts.clear()
    }

    this.#cleanupDisconnected(root === document)
  }

  #cleanupDisconnected(force = false) {
    const now = Date.now()
    if (!force && now - this.#lastCleanupAt < 2_000) return
    this.#lastCleanupAt = now
    for (const [target, mounted] of this.#messageMounts) {
      if (target.isConnected && mounted.element.isConnected) continue
      mounted.unmount()
      this.#messageMounts.delete(target)
    }
    for (const [target, mounted] of this.#toolMounts) {
      if (target.isConnected && mounted.element.isConnected) continue
      mounted.unmount()
      this.#toolMounts.delete(target)
    }
    for (const [section, mounted] of this.#activityMounts) {
      if (section.isConnected && mounted.element.isConnected) continue
      mounted.unmount()
      this.#activityMounts.delete(section)
    }
  }

  #clear() {
    this.#clearRequestStatus()
    this.#clearWorkWarning()
    this.#clearMessageMetadata()
    for (const mounted of this.#toolMounts.values()) mounted.unmount()
    this.#toolMounts.clear()
    this.#clearActivity()
  }
}
