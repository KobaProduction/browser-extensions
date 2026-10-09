import { buildArchiveThread, currentConversationId } from '@chatgpt-booster/chatgpt'
import type {
  ArchiveRecordView,
  ArchiveThreadView,
  ArchiveWindowRequest,
} from '@chatgpt-booster/core'
import { readPinnedSnapshot, verifyPinnedResult } from '@kobaproduction/browser-storage'
import type { ArchiveV4Message, ArchiveV4Store } from './archive-v4-store'
import { normalizeConversationMessage } from './conversation-records'
import type { ConversationStateStore } from './conversation-state'

export type ArchiveV4WindowCursor = Pick<ArchiveV4Message, 'sourceCreateTime' | 'messageId'>

export interface ArchiveV4ThreadWindow {
  thread: ArchiveThreadView
  olderCursor: ArchiveV4WindowCursor | null
  newerCursor: ArchiveV4WindowCursor | null
  hasOlderStored: boolean
  hasNewerStored: boolean
  loadedRecordCount: number
  totalKnownRecordCount: number
  /** Null create_time records exist but cannot be placed in chronology. */
  hasUnsequencedRecords: boolean
  source: 'live' | 'saved'
  sourceRevision: number | null
  sourceInstanceId: string | null
  accountId: string
  focusedMessageId?: string
  unsequencedTarget?: boolean
}

export type ArchiveV4WindowDirection = 'older' | 'newer' | 'first'

/**
 * Assembles only the windows deliberately opened by the reader. The live current
 * conversation is served from RAM; saved chats are fetched via indexed cursors.
 * No v3 store access or synthetic parent links.
 */
interface ReaderSession {
  records: Map<string, ArchiveRecordView>
  points: Map<string, ArchiveV4WindowCursor>
  keys: string[] // ascending chronological order; bounded at 240
  revision: number | null
  instanceId: string | null
  head: string | null
  projectId: string | null
  hasOlderStored: boolean
  hasNewerStored: boolean
}

function newSession(
  revision: number | null,
  head: string | null,
  projectId: string | null,
  instanceId: string | null = null,
): ReaderSession {
  return {
    records: new Map(),
    points: new Map(),
    keys: [],
    revision,
    instanceId,
    head,
    projectId,
    hasOlderStored: false,
    hasNewerStored: false,
  }
}

/** Reader sessions contain only adjacent records, with independent cursors for both edges. */
export class ArchiveV4Reader {
  readonly #sessions = new Map<string, ReaderSession>()
  readonly #requestTokens = new Map<string, number>()
  #requestSerial = 0
  #ownerEpoch: number | null = null
  static readonly MAX_SESSIONS = 4
  static readonly MAX_WINDOW_RECORDS = 240

  constructor(
    private readonly store: ArchiveV4Store,
    private readonly memory: ConversationStateStore,
    private readonly activeConversationId: () => string | null = () =>
      currentConversationId() ?? null,
  ) {}

  reset() {
    this.#sessions.clear()
    this.#requestTokens.clear()
  }

  #boundary(session: ReaderSession, edge: 'older' | 'newer'): ArchiveV4WindowCursor | null {
    const id = edge === 'older' ? session.keys[0] : session.keys.at(-1)
    return id ? (session.points.get(id) ?? null) : null
  }

  #rememberSession(key: string, session: ReaderSession, direction: 'older' | 'newer') {
    while (session.keys.length > ArchiveV4Reader.MAX_WINDOW_RECORDS) {
      const removed = direction === 'older' ? session.keys.pop() : session.keys.shift()
      if (!removed) break
      session.records.delete(removed)
      session.points.delete(removed)
      if (direction === 'older') session.hasNewerStored = true
      else session.hasOlderStored = true
    }
    this.#sessions.delete(key)
    this.#sessions.set(key, session)
    while (this.#sessions.size > ArchiveV4Reader.MAX_SESSIONS) {
      const oldest = this.#sessions.keys().next().value
      if (oldest === undefined) break
      this.#sessions.delete(oldest)
    }
  }

  #addPage(
    session: ReaderSession,
    items: { record: ArchiveRecordView; point: ArchiveV4WindowCursor }[],
    direction: 'older' | 'newer',
  ) {
    // IndexedDB oldest queries already return ascending; newest queries are reversed.
    const ordered = direction === 'older' ? items.reverse() : items
    const ids: string[] = []
    for (const { record, point } of ordered) {
      if (session.records.has(record.messageId)) continue
      session.records.set(record.messageId, record)
      session.points.set(record.messageId, point)
      ids.push(record.messageId)
    }
    if (direction === 'older') session.keys.unshift(...ids)
    else session.keys.push(...ids)
  }

  #result(
    session: ReaderSession,
    known: number,
    hasUnsequencedRecords: boolean,
    accountId: string,
    source: 'live' | 'saved',
  ): ArchiveV4ThreadWindow {
    return {
      source,
      accountId,
      sourceRevision: session.revision,
      sourceInstanceId: session.instanceId,
      thread: buildArchiveThread(
        session.keys.flatMap((id) => {
          const record = session.records.get(id)
          return record ? [record] : []
        }),
      ),
      olderCursor: session.hasOlderStored ? this.#boundary(session, 'older') : null,
      newerCursor: session.hasNewerStored ? this.#boundary(session, 'newer') : null,
      hasOlderStored: session.hasOlderStored,
      hasNewerStored: session.hasNewerStored,
      loadedRecordCount: session.records.size,
      totalKnownRecordCount: known,
      hasUnsequencedRecords,
    }
  }

  #requireOwner(accountId: string, request: ArchiveWindowRequest) {
    if (request.signal?.aborted) throw new DOMException('Archive read cancelled', 'AbortError')
    if (
      this.memory.verifiedAccountId() !== accountId ||
      (request.expectedAccountId !== undefined && request.expectedAccountId !== accountId)
    )
      throw new Error('archive.error.auth')
  }

  #guardOwner(accountId: string, request: ArchiveWindowRequest): () => void {
    const epoch = this.memory.accountEpoch()
    if (this.#ownerEpoch !== epoch) {
      this.reset()
      this.#ownerEpoch = epoch
    }
    const current = () => {
      this.#requireOwner(accountId, request)
      if (this.memory.accountEpoch() !== epoch) throw new Error('archive.error.auth')
    }
    current()
    return current
  }

  #beginRequest(accountId: string, conversationId: string): number {
    const key = JSON.stringify([accountId, conversationId])
    const token = ++this.#requestSerial
    this.#requestTokens.delete(key)
    this.#requestTokens.set(key, token)
    while (this.#requestTokens.size > ArchiveV4Reader.MAX_SESSIONS * 4) {
      const first = this.#requestTokens.keys().next().value
      if (first === undefined) break
      this.#requestTokens.delete(first)
    }
    return token
  }

  #requireRequest(accountId: string, conversationId: string, token: number) {
    if (this.#requestTokens.get(JSON.stringify([accountId, conversationId])) !== token)
      throw new Error('archive.error.sourceChanged')
  }

  /** Resolve a concrete source ID rather than scrolling a latest-only buffer. */
  async readMessageWindow(
    accountId: string,
    conversationId: string,
    messageId: string,
    request: ArchiveWindowRequest = {},
  ): Promise<ArchiveV4ThreadWindow> {
    const requireCurrent = this.#guardOwner(accountId, request)
    if (!messageId.trim() || messageId.length > 1024)
      throw new Error('archive.error.messageMissing')
    const token = this.#beginRequest(accountId, conversationId)
    const live =
      request.source !== 'saved' && this.activeConversationId() === conversationId
        ? this.memory.listMessages(conversationId)
        : []
    const at = live.findIndex((record) => record.messageId === messageId)
    if (at >= 0) {
      const session = newSession(null, null, null)
      const untimed = live[at]?.createTime === null
      const start = untimed ? at : Math.max(0, at - 20)
      const end = untimed ? at + 1 : Math.min(live.length, at + 21)
      this.#addPage(
        session,
        live.slice(start, end).map((record) => ({
          record,
          point: { sourceCreateTime: record.createTime, messageId: record.messageId },
        })),
        'newer',
      )
      session.hasOlderStored = !untimed && start > 0
      session.hasNewerStored = !untimed && end < live.length
      requireCurrent()
      this.#rememberSession(JSON.stringify([accountId, conversationId, 'live']), session, 'newer')
      return {
        ...this.#result(
          session,
          live.length,
          live.some((record) => record.createTime === null),
          accountId,
          'live',
        ),
        focusedMessageId: messageId,
        unsequencedTarget: untimed,
      }
    }
    // Saved preview requests always use this path, even for the current native chat.
    const found = await this.store.readMessageWindow(
      accountId,
      conversationId,
      messageId,
      20,
      request.signal,
    )
    requireCurrent()
    this.#requireRequest(accountId, conversationId, token)
    if (
      request.expectedRevision !== undefined &&
      found.conversation.revision !== request.expectedRevision
    )
      throw new Error('archive.error.sourceChanged')
    if (
      request.expectedInstanceId !== undefined &&
      request.expectedInstanceId !== (found.conversation.instanceId ?? null)
    )
      throw new Error('archive.error.sourceChanged')
    const { stamp: latest } = await verifyPinnedResult({
      stamp: found.conversation,
      result: found,
      readStamp: async () => {
        const current = await this.store.getConversation(accountId, conversationId)
        if (!current) throw new Error('archive.error.sourceChanged')
        return current
      },
      sameStamp: (first, current) =>
        current.revision === first.revision &&
        current.currentNodeId === first.currentNodeId &&
        current.projectId === first.projectId &&
        (current.instanceId ?? null) === (first.instanceId ?? null),
      assertCurrent: () => {
        requireCurrent()
        this.#requireRequest(accountId, conversationId, token)
      },
      ...(request.signal ? { signal: request.signal } : {}),
      conflictError: () => new Error('archive.error.sourceChanged'),
    })
    const session = newSession(
      latest.revision,
      latest.currentNodeId,
      latest.projectId,
      latest.instanceId ?? null,
    )
    this.#addPage(
      session,
      found.messages.map((message) => {
        const record = normalizeConversationMessage(
          message.raw,
          conversationId,
          latest.projectId,
          message.lastSeenAt,
        )
        if (!record) throw new Error('archive.error.incompatibleSource')
        return {
          record,
          point: { sourceCreateTime: message.sourceCreateTime, messageId: message.messageId },
        }
      }),
      'newer',
    )
    session.hasOlderStored = found.hasOlder
    session.hasNewerStored = found.hasNewer
    this.#rememberSession(JSON.stringify([accountId, conversationId, 'saved']), session, 'newer')
    return {
      ...this.#result(
        session,
        latest.knownMessageCount,
        latest.unsequencedMessageCount > 0,
        accountId,
        'saved',
      ),
      focusedMessageId: messageId,
      unsequencedTarget: found.unsequencedTarget,
    }
  }

  async readThreadWindow(
    accountId: string,
    conversationId: string,
    before?: ArchiveV4WindowCursor | null,
    limit = 40,
    direction: ArchiveV4WindowDirection = 'older',
    request: ArchiveWindowRequest = {},
  ): Promise<ArchiveV4ThreadWindow> {
    const maximum = Number.isFinite(limit) ? Math.max(1, Math.min(199, Math.floor(limit))) : 40
    const requireCurrent = this.#guardOwner(accountId, request)
    const forward = direction === 'newer' || direction === 'first'
    const advancing: 'older' | 'newer' = forward ? 'newer' : 'older'
    if (direction === 'first' && before) throw new Error('archive.error.sourceChanged')
    const continuing = !!before && direction !== 'first'
    const active = this.activeConversationId() === conversationId
    const live =
      active && request.source !== 'saved' ? this.memory.listMessages(conversationId) : []
    const key = JSON.stringify([accountId, conversationId, live.length ? 'live' : 'saved'])
    const requestToken = this.#beginRequest(accountId, conversationId)
    if (live.length) {
      const previous = this.#sessions.get(key)
      if (
        continuing &&
        (!previous ||
          JSON.stringify(this.#boundary(previous, advancing)) !== JSON.stringify(before))
      ) {
        this.#sessions.delete(key)
        throw new Error('archive.error.sourceChanged')
      }
      const session = continuing && previous ? previous : newSession(null, null, null)
      let start = 0
      let end = live.length
      if (continuing) {
        const index = live.findIndex((record) => record.messageId === before.messageId)
        if (index < 0) throw new Error('archive.error.sourceChanged')
        if (forward) start = index + 1
        else end = index
      }
      if (forward) end = Math.min(end, start + maximum)
      else start = Math.max(start, end - maximum)
      const selected = live.slice(start, end).map((record) => ({
        record,
        point: { sourceCreateTime: record.createTime, messageId: record.messageId },
      }))
      // RAM is ascending. Match the descending input contract of older IDB pages.
      this.#addPage(session, forward ? selected : selected.reverse(), advancing)
      if (forward) session.hasNewerStored = end < live.length
      else session.hasOlderStored = start > 0
      if (!continuing) {
        session.hasOlderStored = forward ? false : start > 0
        session.hasNewerStored = forward ? end < live.length : false
      }
      if (
        this.memory.verifiedAccountId() !== accountId ||
        this.activeConversationId() !== conversationId
      )
        throw new Error('archive.error.auth')
      requireCurrent()
      this.#rememberSession(key, session, advancing)
      return this.#result(
        session,
        live.length,
        live.some((r) => r.createTime === null),
        accountId,
        'live',
      )
    }

    const previous = this.#sessions.get(key)
    const { stamp: conversation, result: page } = await readPinnedSnapshot({
      readStamp: () => this.store.getConversation(accountId, conversationId),
      read: () =>
        this.store.readWindow(
          accountId,
          conversationId,
          maximum + 1,
          forward ? 'oldest' : 'newest',
          before ?? undefined,
          request.signal,
        ),
      ...(request.signal ? { signal: request.signal } : {}),
      assertCurrent: () => {
        if (this.memory.verifiedAccountId() !== accountId) throw new Error('archive.error.auth')
        requireCurrent()
        this.#requireRequest(accountId, conversationId, requestToken)
      },
      acceptStamp: (stamp) => {
        const revision = stamp?.revision ?? null
        if (request.expectedRevision !== undefined && revision !== request.expectedRevision)
          throw new Error('archive.error.sourceChanged')
        if (
          request.expectedInstanceId !== undefined &&
          request.expectedInstanceId !== (stamp?.instanceId ?? null)
        )
          throw new Error('archive.error.sourceChanged')
        if (
          continuing &&
          (!previous ||
            previous.revision !== revision ||
            previous.instanceId !== (stamp?.instanceId ?? null) ||
            previous.head !== (stamp?.currentNodeId ?? null) ||
            previous.projectId !== (stamp?.projectId ?? null) ||
            JSON.stringify(this.#boundary(previous, advancing)) !== JSON.stringify(before))
        ) {
          this.#sessions.delete(key)
          throw new Error('archive.error.sourceChanged')
        }
      },
      sameStamp: (first, latest) =>
        (first?.revision ?? null) === (latest?.revision ?? null) &&
        first?.currentNodeId === latest?.currentNodeId &&
        first?.projectId === latest?.projectId &&
        (first?.instanceId ?? null) === (latest?.instanceId ?? null),
      onConflict: () => this.#sessions.delete(key),
      conflictError: () => new Error('archive.error.sourceChanged'),
    })
    const revision = conversation?.revision ?? null
    const session =
      continuing && previous
        ? previous
        : newSession(
            revision,
            conversation?.currentNodeId ?? null,
            conversation?.projectId ?? null,
            conversation?.instanceId ?? null,
          )
    const more = page.length > maximum
    const selected = page.slice(0, maximum).map((message) => {
      const record = normalizeConversationMessage(
        message.raw,
        conversationId,
        conversation?.projectId ?? null,
        message.lastSeenAt,
      )
      if (!record) throw new Error('archive.error.incompatibleSource')
      return {
        record,
        point: { sourceCreateTime: message.sourceCreateTime, messageId: message.messageId },
      }
    })
    this.#addPage(session, selected, advancing)
    if (forward) session.hasNewerStored = more
    else session.hasOlderStored = more
    if (!continuing) {
      session.hasOlderStored = forward ? false : more
      session.hasNewerStored = forward ? more : false
    }
    this.#rememberSession(key, session, advancing)
    return this.#result(
      session,
      conversation?.knownMessageCount ?? session.records.size,
      (conversation?.unsequencedMessageCount ?? 0) > 0,
      accountId,
      'saved',
    )
  }
}
