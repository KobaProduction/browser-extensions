import {
  archiveRecordMetadata,
  type ConversationMessageTarget,
  conversationDomSnapshotFromTargets,
  currentConversationId,
  findToolCallEvidence,
  observeConversationDecorations,
  toolInvocationFromEvidence,
} from '@chatgpt-booster/chatgpt'
import {
  ARCHIVE_UPDATED_EVENT,
  type BoosterModule,
  type BoosterSettings,
  type ConversationItemMetadataView,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import {
  type MountedMessageMetadata,
  type MountedToolInspector,
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
  #unsubscribe: (() => void) | undefined
  #archiveRefreshTimer: ReturnType<typeof setTimeout> | undefined
  #settings: BoosterSettings | undefined
  #records = new Map<string, ArchivedMessage>()
  #recordConversationId: string | null = null
  #loadVersion = 0
  #activeRecordRefresh: { conversationId: string | null; promise: Promise<void> } | undefined
  #recordRefreshQueued = false
  #messageMounts = new Map<HTMLElement, MountedMessageMetadata>()
  #firstSeen = new Map<string, number>()
  #toolMounts = new Map<HTMLElement, MountedToolInspector>()
  #lastCleanupAt = 0

  constructor(
    private settingsAdapter: SettingsAdapter,
    private store: ConversationArchiveStore,
  ) {}

  async start() {
    this.#settings = await this.settingsAdapter.get()
    this.#unsubscribe = this.settingsAdapter.subscribe((next) => {
      const previous = this.#settings
      const languageChanged = next.language !== previous?.language
      const relevantChanged =
        next.enabled !== previous?.enabled ||
        languageChanged ||
        next.features.toolInspector !== previous?.features.toolInspector
      this.#settings = next
      if (!relevantChanged) return
      if (languageChanged) this.#clear()
      this.#observer?.scan()
    })
    window.addEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchiveUpdated)
    this.#observer = observeConversationDecorations((targets, root) => {
      void this.#scan(targets, root)
    })
    await this.#refreshRecords()
    this.#observer.scan()
  }

  stop() {
    this.#observer?.stop()
    this.#observer = undefined
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    window.removeEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchiveUpdated)
    if (this.#archiveRefreshTimer) clearTimeout(this.#archiveRefreshTimer)
    this.#archiveRefreshTimer = undefined
    this.#loadVersion += 1
    this.#activeRecordRefresh = undefined
    this.#recordRefreshQueued = false
    this.#records.clear()
    if (this.#recordConversationId) this.store.clearDomSnapshot(this.#recordConversationId)
    this.#recordConversationId = null
    this.#firstSeen.clear()
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
    this.#recordConversationId = conversationId
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
      const mounted = this.#messageMounts.get(target.message)
      if (mounted) mounted.update(metadata)
      else
        this.#messageMounts.set(
          target.message,
          mountMessageMetadata(target.actions, metadata, locale, target.role === 'assistant'),
        )
    }

    if (settings.features.toolInspector) {
      for (const evidence of findToolCallEvidence(root)) {
        if (this.#toolMounts.has(evidence.element)) continue
        const tool = toolInvocationFromEvidence(evidence)
        if (!tool.timestamp) {
          const section = evidence.element.closest<HTMLElement>(
            'section[data-testid^="conversation-turn-"]',
          )
          const messageId = section?.querySelector<HTMLElement>(
            '[data-message-id][data-message-author-role]',
          )?.dataset.messageId
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
  }

  #clear() {
    for (const mounted of this.#messageMounts.values()) mounted.unmount()
    for (const mounted of this.#toolMounts.values()) mounted.unmount()
    this.#messageMounts.clear()
    this.#toolMounts.clear()
  }
}
