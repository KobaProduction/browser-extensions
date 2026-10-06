import {
  archiveRecordKind,
  asRecord,
  currentConversationDomSnapshot,
  currentConversationId,
  currentProjectId,
  currentProjectTitle,
  hasConversationDraft,
  hasPendingComposerAttachments,
  isConversationGenerating,
  observeChatGptNavigation,
} from '@chatgpt-booster/chatgpt'
import {
  type ArchiveRecordView,
  type BoosterModule,
  type BoosterSettings,
  type CaptureRule,
  captureRuleForOperation,
  HISTORY_LOADER_START_EVENT,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import {
  ARCHIVE_ASSET_EVENT,
  ARCHIVE_POLICY_EVENT,
  type ArchiveAssetResolutionEventDetail,
  type ConversationArchiveEventDetail,
  TRANSPORT_CHANNEL,
} from '@chatgpt-booster/observer'
import type { ConversationArchiveStore } from './archive-store'
import { ConversationStateStore } from './conversation-state'

const TICKET_KEY = 'chatgpt-booster:manual-collection'
export interface CollectionTicket {
  conversationId: string
  startedAt: number
  expiresAt: number
}
export function collectionTicket(): CollectionTicket | undefined {
  try {
    const ticket = JSON.parse(
      sessionStorage.getItem(TICKET_KEY) ?? 'null',
    ) as CollectionTicket | null
    if (
      ticket &&
      ticket.conversationId === currentConversationId() &&
      typeof ticket.startedAt === 'number' &&
      Number.isFinite(ticket.startedAt) &&
      ticket.startedAt <= Date.now() &&
      typeof ticket.expiresAt === 'number' &&
      ticket.expiresAt > Date.now() &&
      ticket.expiresAt <= ticket.startedAt + 30 * 60_000
    )
      return ticket
  } catch {
    /* invalid or inaccessible tab state is never consent */
  }
  return undefined
}
export function keepCapturedRecord(raw: Record<string, unknown>, rule: CaptureRule): boolean {
  const author = asRecord(raw.author),
    content = asRecord(raw.content),
    metadata = asRecord(raw.metadata)
  const kind = archiveRecordKind({
    raw,
    role: author?.role ?? null,
    recipient: raw.recipient ?? null,
    channel: raw.channel ?? null,
    contentType: content?.content_type ?? null,
    messageType: metadata?.message_type ?? null,
  } as ArchiveRecordView)
  if (kind === 'user' || kind === 'answer') return true
  if (kind === 'reasoning') return rule.reasoning
  if (kind === 'tool_call' || kind === 'tool_result') return rule.tools
  return rule.internal
}
export class ConversationArchiveModule implements BoosterModule {
  readonly id = 'conversation-archive'
  readonly store: ConversationArchiveStore
  #settings: BoosterSettings = normalizeSettings()
  #unsubscribe: (() => void) | undefined
  #pageUnsubscribe: (() => void) | undefined
  #queue: Promise<unknown> = Promise.resolve()
  #navigationUnsubscribe: (() => void) | undefined
  #ticketExpiryTimer: ReturnType<typeof setTimeout> | undefined
  #active = false
  #lastPolicy = ''
  #persistedPageKeys = new Set<string>()
  #ownsStateStore: boolean
  private stateStore: ConversationStateStore
  constructor(
    store: ConversationArchiveStore,
    private settingsAdapter: SettingsAdapter,
    stateStore?: ConversationStateStore,
    private messageSource: Window = window,
  ) {
    this.store = store
    this.stateStore = stateStore ?? new ConversationStateStore(messageSource)
    this.#ownsStateStore = !stateStore
  }

  async start() {
    if (this.#active) return
    this.#active = true
    if (this.#ownsStateStore) this.stateStore.start()
    this.#pageUnsubscribe = this.stateStore.subscribePages(this.#onStatePage)
    window.addEventListener('message', this.#onMessage)
    this.#unsubscribe = this.settingsAdapter.subscribe((settings) => {
      this.#settings = settings
      this.#publishPolicy()
      if (settings.enabled) this.#persistCurrentBuffered()
    })
    this.#settings = await this.settingsAdapter.get()
    if (!this.#active) return
    this.#navigationUnsubscribe = observeChatGptNavigation(this.#onContextChanged)
    this.#publishPolicy()
    this.#scheduleTicketExpiry()
  }
  stop() {
    this.#active = false
    window.removeEventListener('message', this.#onMessage)
    this.#pageUnsubscribe?.()
    this.#pageUnsubscribe = undefined
    this.#unsubscribe?.()
    if (this.#ownsStateStore) this.stateStore.stop()
    this.#navigationUnsubscribe?.()
    this.#navigationUnsubscribe = undefined
    if (this.#ticketExpiryTimer) clearTimeout(this.#ticketExpiryTimer)
    this.#ticketExpiryTimer = undefined
  }
  async collectCurrent(): Promise<void> {
    const conversationId = currentConversationId()
    if (!conversationId) throw new Error('archive.error.noChat')
    if (hasConversationDraft()) throw new Error('archive.error.draft')
    if (hasPendingComposerAttachments()) throw new Error('archive.error.attachments')
    if (isConversationGenerating()) throw new Error('archive.error.generating')
    const startedAt = Date.now()
    // One explicit manual operation, scoped to this tab/chat and time bounded.
    sessionStorage.setItem(
      TICKET_KEY,
      JSON.stringify({ conversationId, startedAt, expiresAt: startedAt + 30 * 60_000 }),
    )
    this.#scheduleTicketExpiry()
    this.#publishPolicy()
    const promotedPreload = await this.#promotePreload(conversationId, startedAt)
    if (!promotedPreload) await this.#promoteDomSnapshot(conversationId, startedAt)
    window.dispatchEvent(new Event(HISTORY_LOADER_START_EVENT))
  }
  async #promotePreload(conversationId: string, startedAt: number): Promise<boolean> {
    const memoryPages = this.stateStore.pages(conversationId)
    const latestInitial = memoryPages
      .filter((page) => page.isInitial)
      .sort(
        (a, b) =>
          (b.readStartedAt ?? b.timestamp) - (a.readStartedAt ?? a.timestamp) ||
          b.timestamp - a.timestamp,
      )[0]
    const selectedReadId = latestInitial?.readId ?? memoryPages.at(-1)?.readId ?? null
    const livePages = selectedReadId
      ? memoryPages.filter((page) => page.readId === selectedReadId)
      : memoryPages.slice(-1)
    const legacyPages = livePages.length
      ? []
      : await this.store.listLatestPreloadPages(conversationId)
    const pages = livePages.length
      ? livePages.map((page) => ({
          payload: page.payload,
          isInitial: page.isInitial,
          requestedBefore: page.requestedBefore,
          observedAt: page.timestamp,
          sourceUrl: page.sourceUrl,
        }))
      : legacyPages
    if (!pages.length) return false
    const project =
      currentProjectId() ??
      pages
        .map((page) => page.payload.gizmo_id)
        .find((value) => typeof value === 'string' && value.startsWith('g-p-')) ??
      null
    const rule = captureRuleForOperation(
      this.#settings.archive,
      conversationId,
      typeof project === 'string' ? project : null,
      true,
      this.#settings.enabled,
    )
    const stillPermitted = () =>
      this.#active && collectionTicket()?.conversationId === conversationId
    const readId = `manual-${startedAt}`
    for (const page of pages) {
      if (!stillPermitted()) return false
      const rawMessages = Array.isArray(page.payload.messages) ? page.payload.messages : []
      const messages = rawMessages
        .map(asRecord)
        .filter((raw): raw is Record<string, unknown> => !!raw)
        .filter((raw) => keepCapturedRecord(raw, rule))
      await this.store.ingest(
        {
          kind: 'conversation-page',
          readId,
          readStartedAt: startedAt,
          isInitial: page.isInitial,
          requestedBefore: page.requestedBefore,
          timestamp: page.observedAt,
          sourceUrl: page.sourceUrl,
          conversationId,
          payload: {
            ...page.payload,
            messages,
            booster_capture: {
              reasoning: rule.reasoning,
              tools: rule.tools,
              internal: rule.internal,
              omittedRecords: rawMessages.length - messages.length,
            },
          },
        },
        stillPermitted,
      )
    }
    return true
  }

  async #promoteDomSnapshot(conversationId: string, startedAt: number): Promise<boolean> {
    const memory = this.stateStore.snapshot(conversationId)
    const fallback = currentConversationDomSnapshot()
    const snapshot = memory?.records.length
      ? {
          conversationId,
          projectId: memory.projectId,
          title: memory.title,
          observedAt: memory.lastObservedAt,
          records: memory.records,
        }
      : fallback
    if (!snapshot || snapshot.conversationId !== conversationId || !snapshot.records.length)
      return false

    const projectId = currentProjectId() ?? snapshot.projectId ?? null
    const rule = captureRuleForOperation(
      this.#settings.archive,
      conversationId,
      projectId,
      true,
      this.#settings.enabled,
    )
    const stillPermitted = () =>
      this.#active && collectionTicket()?.conversationId === conversationId
    const rawMessages = snapshot.records.map((record) => record.raw)
    const messages = rawMessages.filter((raw) => keepCapturedRecord(raw, rule))
    const readId = `manual-${startedAt}`

    await this.store.ingest(
      {
        kind: 'conversation-page',
        readId,
        readStartedAt: startedAt,
        isInitial: true,
        requestedBefore: null,
        timestamp: snapshot.observedAt,
        sourceUrl: `${location.href}#chatgpt-booster-dom-snapshot`,
        conversationId,
        payload: {
          conversation_id: conversationId,
          title: snapshot.title,
          gizmo_id: projectId,
          messages,
          page_info: {
            start_cursor: null,
            end_cursor: null,
            has_previous_page: null,
            has_next_page: null,
          },
          booster_capture: {
            reasoning: rule.reasoning,
            tools: rule.tools,
            internal: rule.internal,
            omittedRecords: rawMessages.length - messages.length,
            domSnapshot: true,
          },
        },
      },
      stillPermitted,
    )
    return true
  }

  finishCollection(expected?: Pick<CollectionTicket, 'conversationId' | 'startedAt'>) {
    if (expected) {
      try {
        const stored = JSON.parse(
          sessionStorage.getItem(TICKET_KEY) ?? 'null',
        ) as CollectionTicket | null
        if (
          stored &&
          (stored.conversationId !== expected.conversationId ||
            stored.startedAt !== expected.startedAt)
        )
          return
      } catch {
        // Malformed ticket is never consent and can be cleared below.
      }
    }
    sessionStorage.removeItem(TICKET_KEY)
    this.#scheduleTicketExpiry()
    this.#publishPolicy()
  }
  #onContextChanged = () => {
    this.#publishPolicy()
    this.#scheduleTicketExpiry()
  }
  #scheduleTicketExpiry() {
    if (this.#ticketExpiryTimer) clearTimeout(this.#ticketExpiryTimer)
    this.#ticketExpiryTimer = undefined
    const ticket = collectionTicket()
    if (!ticket) return
    const delay = Math.max(0, ticket.expiresAt - Date.now())
    this.#ticketExpiryTimer = setTimeout(() => {
      this.#ticketExpiryTimer = undefined
      this.#publishPolicy()
    }, delay)
  }
  #publishPolicy() {
    if (!this.#active) return
    const detail = {
      enabled: this.#settings.enabled,
      defaultEnabled: this.#settings.archive.defaultRule.enabled,
      projects: Object.fromEntries(
        Object.entries(this.#settings.archive.projects).map(([id, rule]) => [id, rule.enabled]),
      ),
      conversations: Object.fromEntries(
        Object.entries(this.#settings.archive.conversations).map(([id, rule]) => [
          id,
          rule.enabled,
        ]),
      ),
      manualConversationId: collectionTicket()?.conversationId ?? null,
      manualStartedAt: collectionTicket()?.startedAt ?? null,
    }
    const json = JSON.stringify(detail)
    if (json === this.#lastPolicy) return
    this.#lastPolicy = json
    window.postMessage(
      { channel: TRANSPORT_CHANNEL, type: ARCHIVE_POLICY_EVENT, detail },
      location.origin,
    )
  }
  #pagePersistenceKey(detail: ConversationArchiveEventDetail, rule: CaptureRule) {
    return [
      detail.conversationId,
      detail.readId ?? '',
      detail.isInitial ? '1' : '0',
      detail.requestedBefore ?? '',
      detail.timestamp,
      rule.reasoning ? 'r1' : 'r0',
      rule.tools ? 't1' : 't0',
      rule.internal ? 'i1' : 'i0',
    ].join('|')
  }

  #onStatePage = (detail: ConversationArchiveEventDetail) => {
    this.#queue = this.#queue
      .then(() => this.#persistPage(detail))
      .catch(() => {
        window.dispatchEvent(
          new CustomEvent('chatgpt-booster:archive-storage-error', {
            detail: { conversationId: detail.conversationId },
          }),
        )
      })
  }

  #persistCurrentBuffered() {
    const conversationId = currentConversationId()
    if (!conversationId) return
    for (const page of this.stateStore.pages(conversationId)) this.#onStatePage(page)
  }

  async #persistPage(detail: ConversationArchiveEventDetail) {
    if (!this.#active) return
    const payload = detail.payload
    if (!payload || !Array.isArray(payload.messages) || typeof detail.conversationId !== 'string')
      return
    const id = detail.conversationId
    if (payload.conversation_id && payload.conversation_id !== id) return
    const memoryProject = this.stateStore.snapshot(id)?.projectId ?? null
    const project =
      'gizmo_id' in payload
        ? typeof payload.gizmo_id === 'string' && payload.gizmo_id.startsWith('g-p-')
          ? payload.gizmo_id
          : null
        : (memoryProject ?? (currentConversationId() === id ? (currentProjectId() ?? null) : null))
    const operationRule = () =>
      captureRuleForOperation(
        this.#settings.archive,
        id,
        project,
        collectionTicket()?.conversationId === id,
        this.#settings.enabled,
      )
    const rule = operationRule()
    if (!rule.enabled) return
    const key = this.#pagePersistenceKey(detail, rule)
    if (this.#persistedPageKeys.has(key)) return
    const stillPermitted = () => {
      const current = operationRule()
      return (
        this.#active &&
        current.enabled &&
        (!rule.reasoning || current.reasoning) &&
        (!rule.tools || current.tools) &&
        (!rule.internal || current.internal)
      )
    }
    const messages = payload.messages
      .map(asRecord)
      .filter((raw): raw is Record<string, unknown> => !!raw)
      .filter((raw) => keepCapturedRecord(raw, rule))
    const summary = await this.store.ingest(
      {
        ...detail,
        payload: {
          ...payload,
          messages,
          booster_capture: {
            reasoning: rule.reasoning,
            tools: rule.tools,
            internal: rule.internal,
            omittedRecords: payload.messages.length - messages.length,
          },
        },
      },
      stillPermitted,
    )
    if (!summary) return
    this.#persistedPageKeys.add(key)
    if (project && stillPermitted())
      await this.store.upsertProject(project, currentProjectTitle(project) ?? null)
  }

  #onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== this.messageSource) return
    const data = event.data
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== ARCHIVE_ASSET_EVENT) return
    const detail = data.detail as ArchiveAssetResolutionEventDetail | undefined
    if (!detail || typeof detail.assetId !== 'string' || typeof detail.downloadUrl !== 'string')
      return
    const conversationId = currentConversationId()
    if (!conversationId) return
    void this.store
      .getConversation(conversationId)
      .then(async (conversation) => {
        if (!this.#active) return
        const projectId =
          currentProjectId() ??
          this.stateStore.snapshot(conversationId)?.projectId ??
          conversation?.projectId ??
          null
        const permitted = () =>
          captureRuleForOperation(
            this.#settings.archive,
            conversationId,
            projectId,
            collectionTicket()?.conversationId === conversationId,
            this.#settings.enabled,
          ).enabled
        if (!permitted()) return
        const stored = await this.store.updateAssetResolution(detail, conversationId)
        if (stored || !this.#active) return
        setTimeout(() => {
          if (this.#active && permitted())
            void this.store.updateAssetResolution(detail, conversationId).catch(() => undefined)
        }, 750)
      })
      .catch(() => undefined)
  }
}
