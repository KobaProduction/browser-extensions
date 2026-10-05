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
  type ScheduledIdleTask,
  scheduleIdleTask,
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
  ARCHIVE_EVENT,
  ARCHIVE_POLICY_EVENT,
  ARCHIVE_PRELOAD_EVENT,
  type ArchiveAssetResolutionEventDetail,
  type ConversationArchiveEventDetail,
  TRANSPORT_CHANNEL,
} from '@chatgpt-booster/observer'
import type { ConversationArchiveStore } from './archive-store'

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
  #queue: Promise<unknown> = Promise.resolve()
  #pendingPreloads: ConversationArchiveEventDetail[] = []
  #preloadTask: ScheduledIdleTask | undefined
  #navigationUnsubscribe: (() => void) | undefined
  #ticketExpiryTimer: ReturnType<typeof setTimeout> | undefined
  #active = false
  #lastPolicy = ''
  constructor(
    store: ConversationArchiveStore,
    private settingsAdapter: SettingsAdapter,
    private messageSource: Window = window,
  ) {
    this.store = store
  }
  async start() {
    if (this.#active) return
    this.#active = true
    window.addEventListener('message', this.#onMessage)
    this.#unsubscribe = this.settingsAdapter.subscribe((settings) => {
      this.#settings = settings
      this.#publishPolicy()
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
    this.#unsubscribe?.()
    this.#navigationUnsubscribe?.()
    this.#navigationUnsubscribe = undefined
    if (this.#ticketExpiryTimer) clearTimeout(this.#ticketExpiryTimer)
    this.#ticketExpiryTimer = undefined
    this.#preloadTask?.cancel()
    this.#preloadTask = undefined
    this.#pendingPreloads = []
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
    await this.#flushPendingPreloads()
    const promotedPreload = await this.#promotePreload(conversationId, startedAt)
    if (!promotedPreload) await this.#promoteDomSnapshot(conversationId, startedAt)
    window.dispatchEvent(new Event(HISTORY_LOADER_START_EVENT))
  }
  async #promotePreload(conversationId: string, startedAt: number): Promise<boolean> {
    const pages = await this.store.listLatestPreloadPages(conversationId)
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
    const snapshot = this.store.getDomSnapshot(conversationId) ?? currentConversationDomSnapshot()
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
    const readId = 'manual-' + startedAt

    await this.store.ingest(
      {
        kind: 'conversation-page',
        readId,
        readStartedAt: startedAt,
        isInitial: true,
        requestedBefore: null,
        timestamp: snapshot.observedAt,
        sourceUrl: location.href + '#chatgpt-booster-dom-snapshot',
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
  #schedulePreload(detail: ConversationArchiveEventDetail) {
    this.#pendingPreloads.push(detail)
    if (this.#preloadTask) return
    this.#preloadTask = scheduleIdleTask(() => {
      this.#preloadTask = undefined
      void this.#flushPendingPreloads()
    }, 500)
  }
  async #flushPendingPreloads() {
    this.#preloadTask?.cancel()
    this.#preloadTask = undefined
    if (!this.#pendingPreloads.length) return
    const pending = this.#pendingPreloads
    this.#pendingPreloads = []
    this.#queue = this.#queue
      .then(async () => {
        if (!this.#active) return
        for (const detail of pending) {
          if (!this.#active) return
          await this.store.ingestPreload(detail)
        }
      })
      .catch(() => undefined)
    await this.#queue
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
  #onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== this.messageSource) return
    const data = event.data
    if (data?.channel !== TRANSPORT_CHANNEL) return
    if (data.type === ARCHIVE_PRELOAD_EVENT && data.detail?.kind === 'conversation-page') {
      this.#schedulePreload(data.detail as ConversationArchiveEventDetail)
      return
    }
    if (data.type === ARCHIVE_ASSET_EVENT) {
      const detail = data.detail as ArchiveAssetResolutionEventDetail | undefined
      if (!detail || typeof detail.assetId !== 'string' || typeof detail.downloadUrl !== 'string')
        return
      const conversationId = currentConversationId()
      if (!conversationId) return
      void this.store
        .getConversation(conversationId)
        .then(async (conversation) => {
          if (!this.#active) return
          const projectId = currentProjectId() ?? conversation?.projectId ?? null
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
          // The normal resolver can finish just before the conversation page is committed.
          // Retry once, but re-check consent before the delayed write.
          setTimeout(() => {
            if (this.#active && permitted())
              void this.store.updateAssetResolution(detail, conversationId).catch(() => undefined)
          }, 750)
        })
        .catch(() => undefined)
      return
    }
    if (data.type !== ARCHIVE_EVENT || data.detail?.kind !== 'conversation-page') return
    const detail = data.detail as ConversationArchiveEventDetail
    this.#queue = this.#queue
      .then(async () => {
        if (!this.#active) return
        const payload = detail.payload
        if (
          !payload ||
          !Array.isArray(payload.messages) ||
          typeof detail.conversationId !== 'string'
        )
          return
        const id = detail.conversationId
        if (payload.conversation_id && payload.conversation_id !== id) return
        const old = await this.store.getConversation(id)
        const project =
          'gizmo_id' in payload
            ? typeof payload.gizmo_id === 'string' && payload.gizmo_id.startsWith('g-p-')
              ? payload.gizmo_id
              : null
            : (old?.projectId ??
              (currentConversationId() === id ? (currentProjectId() ?? null) : null))
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
        if (summary && project && stillPermitted())
          await this.store.upsertProject(project, currentProjectTitle(project) ?? null)
      })
      .catch(() => {
        // Error class only: do not log user payloads or IndexedDB key values.
        window.dispatchEvent(
          new CustomEvent('chatgpt-booster:archive-storage-error', {
            detail: { conversationId: detail.conversationId },
          }),
        )
      })
  }
}
