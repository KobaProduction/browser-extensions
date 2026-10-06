import {
  archiveRecordMetadata,
  archiveRecordText,
  asRecord,
  type ConversationMessageTarget,
  chatGptTurnId,
  chatGptTurnMessageIds,
  conversationDomSnapshotFromTargets,
  currentConversationId,
  findChatGptTurnRoot,
  findConversationMessageTargets,
  findToolCallEvidence,
  observeConversationActivity,
  observeConversationDecorations,
  type ScheduledIdleTask,
  scheduleIdleTask,
  toolInvocationFromEvidence,
  toolInvocationFromRecord,
} from '@chatgpt-booster/chatgpt'
import {
  AGENT_ACTIVITY_EVENT,
  type AgentActivitySnapshot,
  ARCHIVE_UPDATED_EVENT,
  type BoosterModule,
  type BoosterSettings,
  type ConversationItemMetadataView,
  type SettingsAdapter,
  serverTimeMs,
} from '@chatgpt-booster/core'
import {
  type MountedAgentActivity,
  type MountedMessageMetadata,
  type MountedToolInspector,
  mountAgentActivity,
  mountMessageMetadata,
  mountToolInspector,
  resolveLocale,
} from '@chatgpt-booster/ui'
import type { ArchivedMessage, ConversationArchiveStore } from './archive-store'

const UNKNOWN_METADATA: ConversationItemMetadataView = {
  sentAt: null,
  editedAt: null,
  edited: false,
  model: null,
  thinking: null,
}

export class ConversationDecoratorsModule implements BoosterModule {
  readonly id = 'conversation-decorators'

  #observer: ReturnType<typeof observeConversationDecorations> | undefined
  #activityObserver: ReturnType<typeof observeConversationActivity> | undefined
  #activityMounts = new Map<HTMLElement, MountedAgentActivity>()
  #activitySnapshots = new Map<HTMLElement, AgentActivitySnapshot>()
  #unsubscribe: (() => void) | undefined
  #archiveRefreshTimer: ReturnType<typeof setTimeout> | undefined
  #settings: BoosterSettings | undefined
  #records = new Map<string, ArchivedMessage>()
  #turnRecords = new Map<string, ArchivedMessage[]>()
  #recordConversationId: string | null = null
  #loadVersion = 0
  #activeRecordRefresh: { conversationId: string | null; promise: Promise<void> } | undefined
  #recordRefreshQueued = false
  #messageMounts = new Map<HTMLElement, MountedMessageMetadata>()
  #firstSeen = new Map<string, number>()
  #toolMounts = new Map<HTMLElement, MountedToolInspector>()
  #lastCleanupAt = 0
  #initialTask: ScheduledIdleTask | undefined

  constructor(
    private settingsAdapter: SettingsAdapter,
    private store: ConversationArchiveStore,
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
      this.#settings = next
      if (
        !enabledChanged &&
        !languageChanged &&
        !messageMetadataChanged &&
        !activityIndicatorChanged &&
        !toolInspectorChanged
      )
        return

      if (!next.enabled) {
        this.#stopObserver()
        if (this.#archiveRefreshTimer) clearTimeout(this.#archiveRefreshTimer)
        this.#archiveRefreshTimer = undefined
        this.#clear()
        return
      }

      if (languageChanged) {
        this.#clear()
        this.#activityObserver?.scan()
      }
      if (messageMetadataChanged && !next.features.messageMetadata) this.#clearMessageMetadata()
      if (activityIndicatorChanged && !next.features.activityIndicator) this.#clearActivity()
      if (!this.#observer) {
        this.#initialTask?.cancel()
        this.#initialTask = undefined
        void this.#refreshRecords().then(() => {
          if (this.#settings?.enabled) this.#startObserver()
        })
        return
      }
      this.#observer.scan()
    })
    window.addEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchiveUpdated)
    if (this.#settings.enabled) {
      this.#initialTask = scheduleIdleTask(() => {
        this.#initialTask = undefined
        if (!this.#settings?.enabled) return
        void this.#refreshRecords().then(() => {
          if (this.#settings?.enabled) this.#startObserver()
        })
      }, 350)
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
    snapshot,
    section,
    mount,
  }: {
    snapshot: AgentActivitySnapshot
    section: HTMLElement | null
    mount: HTMLElement | null
  }) => {
    window.dispatchEvent(new CustomEvent(AGENT_ACTIVITY_EVENT, { detail: snapshot }))
    const settings = this.#settings
    if (!settings?.enabled || !section) return

    if (snapshot.lastActivityAt) this.#activitySnapshots.set(section, snapshot)
    const assistantTarget = findConversationMessageTargets(section).find(
      (target) => target.role === 'assistant',
    )
    if (assistantTarget) this.#messageMounts.get(assistantTarget.message)?.updateActivity(snapshot)

    if (
      !settings.features.activityIndicator ||
      !snapshot.active ||
      !mount ||
      !snapshot.lastActivityAt
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
    this.#initialTask?.cancel()
    this.#initialTask = undefined
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    window.removeEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchiveUpdated)
    if (this.#archiveRefreshTimer) clearTimeout(this.#archiveRefreshTimer)
    this.#archiveRefreshTimer = undefined
    this.#loadVersion += 1
    this.#activeRecordRefresh = undefined
    this.#recordRefreshQueued = false
    this.#records.clear()
    this.#turnRecords.clear()
    if (this.#recordConversationId) this.store.clearDomSnapshot(this.#recordConversationId)
    this.#recordConversationId = null
    this.#firstSeen.clear()
    this.#activitySnapshots.clear()
    this.#lastCleanupAt = 0
    this.#clear()
  }

  #onArchiveUpdated = (event: Event) => {
    const detail = (
      event as CustomEvent<{
        conversationId?: string
        preload?: boolean
        insertedMessages?: number
        updatedMessages?: number
      }>
    ).detail
    if (!this.#settings?.enabled) return
    const current = currentConversationId() ?? null
    if (detail?.conversationId && current && detail.conversationId !== current) return
    if (!detail?.preload && detail && detail.insertedMessages === 0 && detail.updatedMessages === 0)
      return
    if (this.#archiveRefreshTimer) clearTimeout(this.#archiveRefreshTimer)
    this.#archiveRefreshTimer = setTimeout(() => {
      this.#archiveRefreshTimer = undefined
      void this.#refreshRecords().then(() => this.#observer?.scan())
    }, 80)
  }

  async #refreshRecords() {
    const conversationId = currentConversationId() ?? null
    const active = this.#activeRecordRefresh
    if (active?.conversationId === conversationId) {
      this.#recordRefreshQueued = true
      return await active.promise
    }

    const promise = (async () => {
      do {
        this.#recordRefreshQueued = false
        await this.#loadRecords(conversationId)
      } while (
        this.#recordRefreshQueued &&
        currentConversationId() === conversationId &&
        this.#settings?.enabled
      )
    })()
    this.#activeRecordRefresh = { conversationId, promise }
    try {
      await promise
    } finally {
      if (this.#activeRecordRefresh?.promise === promise) this.#activeRecordRefresh = undefined
    }
  }

  async #loadRecords(conversationId: string | null) {
    if (conversationId !== this.#recordConversationId) {
      if (this.#recordConversationId) this.store.clearDomSnapshot(this.#recordConversationId)
      this.#firstSeen.clear()
    }
    const version = ++this.#loadVersion
    if (!conversationId) {
      this.#records.clear()
      this.#turnRecords.clear()
      this.#recordConversationId = null
      return
    }
    const [persisted, preload] = await Promise.all([
      this.store.listMessages(conversationId),
      this.store.getPreloadSnapshot(conversationId),
    ])
    if (version !== this.#loadVersion || currentConversationId() !== conversationId) return
    const merged = new Map<string, ArchivedMessage>()
    for (const record of persisted) merged.set(record.messageId, record)
    for (const record of preload?.records ?? []) merged.set(record.messageId, record)
    if (preload?.records.length) this.store.clearDomSnapshot(conversationId)
    this.#records = merged
    this.#turnRecords.clear()
    for (const record of merged.values()) {
      const key = record.turnExchangeId ?? record.workingTurnId
      if (!key) continue
      const items = this.#turnRecords.get(key) ?? []
      items.push(record)
      this.#turnRecords.set(key, items)
    }
    for (const items of this.#turnRecords.values())
      items.sort(
        (a, b) =>
          serverTimeMs(a.createTime, a.firstSeenAt) - serverTimeMs(b.createTime, b.firstSeenAt),
      )
    this.#recordConversationId = conversationId
  }

  #turnItemsForMessage(messageId: string): ArchivedMessage[] {
    const anchor = this.#records.get(messageId)
    const key = anchor?.turnExchangeId ?? anchor?.workingTurnId
    return key ? (this.#turnRecords.get(key) ?? []) : []
  }

  #historicalActivity(target: ConversationMessageTarget): AgentActivitySnapshot | null {
    if (target.role !== 'assistant') return null
    const items = this.#turnItemsForMessage(target.messageId)
    if (!items.length) return null
    const activityItems = items.filter(
      (item) =>
        item.role === 'tool' ||
        (item.role === 'assistant' && item.recipient && item.recipient !== 'all') ||
        item.contentType === 'thoughts' ||
        item.contentType === 'reasoning_recap',
    )
    if (!activityItems.length) return null

    const starts: number[] = []
    const ends: number[] = []
    let durationMs: number | null = null
    let label: string | null = null
    for (const item of activityItems) {
      const metadata = asRecord(item.raw.metadata)
      const reasoningStart =
        typeof metadata?.reasoning_start_time === 'number' ? metadata.reasoning_start_time : null
      const reasoningEnd =
        typeof metadata?.reasoning_end_time === 'number' ? metadata.reasoning_end_time : null
      if (reasoningStart) starts.push(serverTimeMs(reasoningStart))
      if (reasoningEnd) ends.push(serverTimeMs(reasoningEnd))
      const created = serverTimeMs(item.createTime, item.firstSeenAt)
      if (created) {
        starts.push(created)
        ends.push(created)
      }
      const updated = serverTimeMs(item.updateTime)
      if (updated) ends.push(updated)
      if (item.contentType === 'reasoning_recap') {
        label = archiveRecordText(item) || label
        if (typeof metadata?.finished_duration_sec === 'number')
          durationMs = Math.max(0, metadata.finished_duration_sec * 1000)
      }
    }
    if (!starts.length || !ends.length) return null
    const anchor = this.#records.get(target.messageId)
    return {
      conversationId: anchor?.conversationId ?? currentConversationId() ?? null,
      turnId: anchor?.turnExchangeId ?? anchor?.workingTurnId ?? chatGptTurnId(target.section),
      active: false,
      phase: 'complete',
      startedAt: Math.min(...starts),
      lastActivityAt: Math.max(...ends),
      durationMs: durationMs ?? Math.max(0, Math.max(...ends) - Math.min(...starts)),
      label,
      tool: null,
    }
  }

  #toolCallRecords(section: HTMLElement): ArchivedMessage[] {
    const messageIds = chatGptTurnMessageIds(section)
    const anchor = messageIds.map((id) => this.#records.get(id)).find(Boolean)
    const key = anchor?.turnExchangeId ?? anchor?.workingTurnId
    if (!key) return []
    return (this.#turnRecords.get(key) ?? []).filter(
      (item) =>
        item.role === 'assistant' &&
        Boolean(item.recipient && item.recipient !== 'all') &&
        Boolean(toolInvocationFromRecord(item)),
    )
  }

  async #scan(targets: ConversationMessageTarget[], root: ParentNode) {
    const settings = this.#settings
    if (!settings?.enabled) {
      this.#clear()
      return
    }
    const current = currentConversationId() ?? null
    if (current !== this.#recordConversationId) await this.#refreshRecords()
    const missingTargets = targets.filter((target) => !this.#records.has(target.messageId))
    const snapshot = missingTargets.length
      ? conversationDomSnapshotFromTargets(missingTargets)
      : undefined
    if (snapshot) {
      if (root === document) this.store.setDomSnapshot(snapshot)
      else this.store.mergeDomSnapshot(snapshot)
    } else if (root === document && current) {
      this.store.clearDomSnapshot(current)
    }
    const locale = resolveLocale(settings.language)

    for (const target of targets) {
      const record = this.#records.get(target.messageId)
      const observedAt = this.#firstSeen.get(target.messageId) ?? Date.now()
      this.#firstSeen.set(target.messageId, observedAt)
      const metadata = record
        ? archiveRecordMetadata(record)
        : { ...UNKNOWN_METADATA, sentAt: observedAt }
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
        for (const [index, evidence] of evidences.entries()) {
          if (this.#toolMounts.has(evidence.element)) continue
          const observed = toolInvocationFromEvidence(evidence)
          const archived = records[index] ? toolInvocationFromRecord(records[index]) : null
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
            tool.timestamp =
              metadata?.sentAt ?? (messageId ? (this.#firstSeen.get(messageId) ?? null) : null)
          }
          this.#toolMounts.set(
            evidence.element,
            mountToolInspector(evidence.element, {
              id: evidence.id,
              tool,
              locale,
              structuredPayloads: evidence.structuredPayloads,
              attributes: evidence.attributes,
              visibleText: evidence.visibleText,
              score: evidence.score,
              signals: evidence.signals,
            }),
          )
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
    this.#clearMessageMetadata()
    for (const mounted of this.#toolMounts.values()) mounted.unmount()
    this.#toolMounts.clear()
    this.#clearActivity()
  }
}
