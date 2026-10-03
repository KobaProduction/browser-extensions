import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'

export const ARCHIVE_DB_NAME = 'chatgpt-booster-archive'
export const ARCHIVE_DB_VERSION = 2
export const ARCHIVE_UPDATED_EVENT = 'chatgpt-booster:archive-updated'

export interface ArchivedConversation {
  conversationId: string
  projectId: string | null
  title: string | null
  conversationOrigin: string | null
  conversationTemplateId: string | null
  gizmoId: string | null
  gizmoType: string | null
  defaultModelSlug: string | null
  currentNodeId: string | null
  createdAt: number | null
  updatedAt: number | null
  isArchived: boolean | null
  isReadOnly: boolean | null
  isTemporaryChat: boolean | null
  isStarred: boolean | null
  isStudyMode: boolean | null
  isDoNotRemember: boolean | null
  branchSourceConversationId: string | null
  branchSourceTitle: string | null
  firstSeenAt: number
  lastSeenAt: number
  lastFullReadAt: number | null
  archiveState: 'unknown' | 'partial' | 'complete' | 'stale'
  raw: Record<string, unknown>
}

export interface ArchivedMessage {
  messageKey: string
  messageId: string
  conversationId: string
  projectId: string | null
  parentId: string | null
  turnExchangeId: string | null
  workingTurnId: string | null
  requestId: string | null
  role: string | null
  authorName: string | null
  recipient: string | null
  channel: string | null
  contentType: string | null
  messageType: string | null
  status: string | null
  endTurn: boolean | null
  weight: number | null
  createTime: number | null
  updateTime: number | null
  modelSlug: string | null
  resolvedModelSlug: string | null
  firstSeenAt: number
  lastSeenAt: number
  payloadHash: string
  raw: Record<string, unknown>
}

export interface ArchivedConversationPage {
  pageKey: string
  conversationId: string
  startCursor: string | null
  endCursor: string | null
  hasPreviousPage: boolean | null
  hasNextPage: boolean | null
  messageIds: string[]
  observedAt: number
  sourceUrl: string
}

export interface ConversationCoverage {
  conversationId: string
  oldestKnownMessageId: string | null
  newestKnownMessageId: string | null
  oldestKnownCursor: string | null
  newestKnownCursor: string | null
  hasOlderServerHistory: boolean | null
  hasNewerServerHistory: boolean | null
  knownMessageCount: number
  knownBranchConversationIds: string[]
  lastObservedAt: number
  lastFullReadAt: number | null
  completeAtLastRead: boolean
}

export interface ArchiveIngestSummary {
  conversationId: string
  projectId: string | null
  insertedMessages: number
  updatedMessages: number
  unchangedMessages: number
  knownMessageCount: number
  complete: boolean
  hasOlderServerHistory: boolean | null
  observedAt: number
}

type RawRecord = Record<string, unknown>

function record(value: unknown): RawRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawRecord)
    : undefined
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function jsonHash(value: unknown): string {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`
}

function request<T = undefined>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function createIndexIfMissing(
  store: IDBObjectStore,
  name: string,
  keyPath: string | string[],
  options?: IDBIndexParameters,
) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options)
}

function openArchiveDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(ARCHIVE_DB_NAME, ARCHIVE_DB_VERSION)
    open.onerror = () => reject(open.error ?? new Error('Failed to open archive database'))
    open.onupgradeneeded = (event) => {
      const db = open.result
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion

      if (oldVersion > 0 && oldVersion < 2) {
        for (const name of [
          'conversations',
          'messages',
          'conversationPages',
          'conversationCoverage',
          'projects',
          'assets',
        ]) {
          if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name)
        }
      }

      const conversations = db.objectStoreNames.contains('conversations')
        ? open.transaction?.objectStore('conversations')
        : db.createObjectStore('conversations', { keyPath: 'conversationId' })
      if (conversations) {
        createIndexIfMissing(conversations, 'projectId', 'projectId')
        createIndexIfMissing(conversations, 'updatedAt', 'updatedAt')
        createIndexIfMissing(conversations, 'archiveState', 'archiveState')
        createIndexIfMissing(
          conversations,
          'branchSourceConversationId',
          'branchSourceConversationId',
        )
        createIndexIfMissing(conversations, 'lastSeenAt', 'lastSeenAt')
      }

      const messages = db.objectStoreNames.contains('messages')
        ? open.transaction?.objectStore('messages')
        : db.createObjectStore('messages', { keyPath: 'messageKey' })
      if (messages) {
        createIndexIfMissing(messages, 'messageId', 'messageId')
        createIndexIfMissing(messages, 'conversationId', 'conversationId')
        createIndexIfMissing(messages, 'projectId', 'projectId')
        createIndexIfMissing(messages, 'parentId', 'parentId')
        createIndexIfMissing(messages, 'turnExchangeId', 'turnExchangeId')
        createIndexIfMissing(messages, 'workingTurnId', 'workingTurnId')
        createIndexIfMissing(messages, 'role', 'role')
        createIndexIfMissing(messages, 'contentType', 'contentType')
        createIndexIfMissing(messages, 'messageType', 'messageType')
        createIndexIfMissing(messages, 'createTime', 'createTime')
        createIndexIfMissing(messages, 'lastSeenAt', 'lastSeenAt')
        createIndexIfMissing(messages, 'conversationCreateTime', ['conversationId', 'createTime'])
        createIndexIfMissing(messages, 'conversationParent', ['conversationId', 'parentId'])
        createIndexIfMissing(messages, 'conversationTurn', ['conversationId', 'turnExchangeId'])
      }

      const pages = db.objectStoreNames.contains('conversationPages')
        ? open.transaction?.objectStore('conversationPages')
        : db.createObjectStore('conversationPages', { keyPath: 'pageKey' })
      if (pages) {
        createIndexIfMissing(pages, 'conversationId', 'conversationId')
        createIndexIfMissing(pages, 'observedAt', 'observedAt')
        createIndexIfMissing(pages, 'hasPreviousPage', 'hasPreviousPage')
      }

      if (!db.objectStoreNames.contains('conversationCoverage')) {
        db.createObjectStore('conversationCoverage', { keyPath: 'conversationId' })
      }
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'projectId' })
      }
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'assetId' })
      }
    }
    open.onsuccess = () => resolve(open.result)
  })
}

function normalizeProjectId(payload: RawRecord): string | null {
  const gizmoId = stringOrNull(payload.gizmo_id)
  const gizmoType = stringOrNull(payload.gizmo_type)
  if (!gizmoId?.startsWith('g-p-')) return null
  if (gizmoType && gizmoType !== 'snorlax') return null
  return gizmoId
}

function findBranchSource(messages: RawRecord[]): {
  id: string | null
  title: string | null
  knownBranches: string[]
} {
  let id: string | null = null
  let title: string | null = null
  const branches = new Set<string>()
  for (const message of messages) {
    const metadata = record(message.metadata)
    if (!metadata) continue
    const candidate = stringOrNull(metadata.branching_from_conversation_id)
    if (candidate) {
      id ??= candidate
      branches.add(candidate)
    }
    title ??= stringOrNull(metadata.branching_from_conversation_title)
  }
  return { id, title, knownBranches: [...branches] }
}

function normalizeMessage(
  raw: RawRecord,
  conversationId: string,
  projectId: string | null,
  now: number,
  previous?: ArchivedMessage,
): ArchivedMessage | undefined {
  const messageId = stringOrNull(raw.id)
  if (!messageId) return undefined
  const author = record(raw.author)
  const content = record(raw.content)
  const metadata = record(raw.metadata)
  return {
    messageKey: `${conversationId}:${messageId}`,
    messageId,
    conversationId,
    projectId,
    parentId: stringOrNull(metadata?.parent_id),
    turnExchangeId: stringOrNull(metadata?.turn_exchange_id),
    workingTurnId: stringOrNull(metadata?.working_turn_id),
    requestId: stringOrNull(metadata?.request_id),
    role: stringOrNull(author?.role),
    authorName: stringOrNull(author?.name),
    recipient: stringOrNull(raw.recipient),
    channel: stringOrNull(raw.channel),
    contentType: stringOrNull(content?.content_type),
    messageType: stringOrNull(metadata?.message_type),
    status: stringOrNull(raw.status),
    endTurn: booleanOrNull(raw.end_turn),
    weight: numberOrNull(raw.weight),
    createTime: numberOrNull(raw.create_time),
    updateTime: numberOrNull(raw.update_time),
    modelSlug: stringOrNull(metadata?.model_slug),
    resolvedModelSlug: stringOrNull(metadata?.resolved_model_slug),
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now,
    payloadHash: jsonHash(raw),
    raw,
  }
}

function withoutMessages(payload: RawRecord): RawRecord {
  const { messages: _messages, ...rest } = payload
  return rest
}

export class ConversationArchiveStore {
  #database: Promise<IDBDatabase> | undefined

  async getCoverage(conversationId: string): Promise<ConversationCoverage | undefined> {
    const db = await this.#db()
    const tx = db.transaction('conversationCoverage', 'readonly')
    return await request<ConversationCoverage | undefined>(
      tx.objectStore('conversationCoverage').get(conversationId),
    )
  }

  async getConversation(conversationId: string): Promise<ArchivedConversation | undefined> {
    const db = await this.#db()
    const tx = db.transaction('conversations', 'readonly')
    return await request<ArchivedConversation | undefined>(
      tx.objectStore('conversations').get(conversationId),
    )
  }

  async ingest(detail: ConversationArchiveEventDetail): Promise<ArchiveIngestSummary> {
    const payload = detail.payload
    const conversationId = stringOrNull(payload.conversation_id) ?? detail.conversationId
    const rawMessages = Array.isArray(payload.messages)
      ? payload.messages.map(record).filter((value): value is RawRecord => Boolean(value))
      : []
    const pageInfo = record(payload.page_info)
    if (!conversationId || !pageInfo) throw new Error('Invalid conversation archive payload')

    const now = detail.timestamp
    const projectId = normalizeProjectId(payload)
    const db = await this.#db()

    const readTx = db.transaction(['conversations', 'messages', 'conversationCoverage'], 'readonly')
    const readDone = transactionDone(readTx)
    const conversationPromise = request<ArchivedConversation | undefined>(
      readTx.objectStore('conversations').get(conversationId),
    )
    const coveragePromise = request<ConversationCoverage | undefined>(
      readTx.objectStore('conversationCoverage').get(conversationId),
    )
    const messageStore = readTx.objectStore('messages')
    const previousMessagesPromise = Promise.all(
      rawMessages.map((message) => {
        const id = stringOrNull(message.id)
        return id
          ? request<ArchivedMessage | undefined>(messageStore.get(`${conversationId}:${id}`))
          : Promise.resolve(undefined)
      }),
    )
    const [oldConversation, oldCoverage, previousMessages] = await Promise.all([
      conversationPromise,
      coveragePromise,
      previousMessagesPromise,
    ])
    await readDone

    let insertedMessages = 0
    let updatedMessages = 0
    let unchangedMessages = 0
    const normalizedMessages: ArchivedMessage[] = []
    for (let index = 0; index < rawMessages.length; index += 1) {
      const raw = rawMessages[index]
      if (!raw) continue
      const previous = previousMessages[index]
      const next = normalizeMessage(raw, conversationId, projectId, now, previous)
      if (!next) continue
      normalizedMessages.push(next)
      if (!previous) insertedMessages += 1
      else if (previous.payloadHash !== next.payloadHash) updatedMessages += 1
      else unchangedMessages += 1
    }

    const branch = findBranchSource(rawMessages)
    const hasPreviousPage = booleanOrNull(pageInfo.has_previous_page)
    const hasNextPage = booleanOrNull(pageInfo.has_next_page)
    const startCursor = stringOrNull(pageInfo.start_cursor)
    const endCursor = stringOrNull(pageInfo.end_cursor)
    const complete = hasPreviousPage === false || oldCoverage?.completeAtLastRead === true
    const archiveState: ArchivedConversation['archiveState'] = complete ? 'complete' : 'partial'

    const conversation: ArchivedConversation = {
      conversationId,
      projectId: projectId ?? oldConversation?.projectId ?? null,
      title: stringOrNull(payload.title) ?? oldConversation?.title ?? null,
      conversationOrigin:
        stringOrNull(payload.conversation_origin) ?? oldConversation?.conversationOrigin ?? null,
      conversationTemplateId:
        stringOrNull(payload.conversation_template_id) ??
        oldConversation?.conversationTemplateId ??
        null,
      gizmoId: stringOrNull(payload.gizmo_id) ?? oldConversation?.gizmoId ?? null,
      gizmoType: stringOrNull(payload.gizmo_type) ?? oldConversation?.gizmoType ?? null,
      defaultModelSlug:
        stringOrNull(payload.default_model_slug) ?? oldConversation?.defaultModelSlug ?? null,
      currentNodeId: stringOrNull(payload.current_node) ?? oldConversation?.currentNodeId ?? null,
      createdAt: numberOrNull(payload.create_time) ?? oldConversation?.createdAt ?? null,
      updatedAt: numberOrNull(payload.update_time) ?? oldConversation?.updatedAt ?? null,
      isArchived:
        'is_archived' in payload
          ? booleanOrNull(payload.is_archived)
          : (oldConversation?.isArchived ?? null),
      isReadOnly:
        'is_read_only' in payload
          ? booleanOrNull(payload.is_read_only)
          : (oldConversation?.isReadOnly ?? null),
      isTemporaryChat:
        'is_temporary_chat' in payload
          ? booleanOrNull(payload.is_temporary_chat)
          : (oldConversation?.isTemporaryChat ?? null),
      isStarred:
        'is_starred' in payload
          ? booleanOrNull(payload.is_starred)
          : (oldConversation?.isStarred ?? null),
      isStudyMode:
        'is_study_mode' in payload
          ? booleanOrNull(payload.is_study_mode)
          : (oldConversation?.isStudyMode ?? null),
      isDoNotRemember:
        'is_do_not_remember' in payload
          ? booleanOrNull(payload.is_do_not_remember)
          : (oldConversation?.isDoNotRemember ?? null),
      branchSourceConversationId: branch.id ?? oldConversation?.branchSourceConversationId ?? null,
      branchSourceTitle: branch.title ?? oldConversation?.branchSourceTitle ?? null,
      firstSeenAt: oldConversation?.firstSeenAt ?? now,
      lastSeenAt: now,
      lastFullReadAt: hasPreviousPage === false ? now : (oldConversation?.lastFullReadAt ?? null),
      archiveState,
      raw: { ...(oldConversation?.raw ?? {}), ...withoutMessages(payload) },
    }

    const messageIds = normalizedMessages.map((message) => message.messageId)
    const pageKey = `${conversationId}:${startCursor ?? ''}:${endCursor ?? ''}`
    const page: ArchivedConversationPage = {
      pageKey,
      conversationId,
      startCursor,
      endCursor,
      hasPreviousPage,
      hasNextPage,
      messageIds,
      observedAt: now,
      sourceUrl: detail.sourceUrl,
    }

    const ordered = normalizedMessages
      .filter((message) => message.createTime !== null)
      .sort((a, b) => (a.createTime ?? 0) - (b.createTime ?? 0))
    const knownBranches = new Set(oldCoverage?.knownBranchConversationIds ?? [])
    for (const id of branch.knownBranches) knownBranches.add(id)
    const coverage: ConversationCoverage = {
      conversationId,
      oldestKnownMessageId:
        hasNextPage === true
          ? (ordered[0]?.messageId ?? oldCoverage?.oldestKnownMessageId ?? messageIds[0] ?? null)
          : (oldCoverage?.oldestKnownMessageId ?? ordered[0]?.messageId ?? messageIds[0] ?? null),
      newestKnownMessageId:
        hasPreviousPage === true
          ? (ordered.at(-1)?.messageId ??
            oldCoverage?.newestKnownMessageId ??
            messageIds.at(-1) ??
            null)
          : (oldCoverage?.newestKnownMessageId ??
            ordered.at(-1)?.messageId ??
            messageIds.at(-1) ??
            null),
      oldestKnownCursor:
        hasNextPage === true ? startCursor : (oldCoverage?.oldestKnownCursor ?? startCursor),
      newestKnownCursor:
        hasPreviousPage === true ? endCursor : (oldCoverage?.newestKnownCursor ?? endCursor),
      hasOlderServerHistory:
        hasPreviousPage === false ? false : (oldCoverage?.hasOlderServerHistory ?? hasPreviousPage),
      hasNewerServerHistory: oldCoverage?.hasNewerServerHistory ?? hasNextPage,
      knownMessageCount: (oldCoverage?.knownMessageCount ?? 0) + insertedMessages,
      knownBranchConversationIds: [...knownBranches],
      lastObservedAt: now,
      lastFullReadAt: hasPreviousPage === false ? now : (oldCoverage?.lastFullReadAt ?? null),
      completeAtLastRead: complete,
    }

    const writeTx = db.transaction(
      ['conversations', 'messages', 'conversationPages', 'conversationCoverage'],
      'readwrite',
    )
    const writeDone = transactionDone(writeTx)
    writeTx.objectStore('conversations').put(conversation)
    const writeMessages = writeTx.objectStore('messages')
    for (const message of normalizedMessages) writeMessages.put(message)
    writeTx.objectStore('conversationPages').put(page)
    writeTx.objectStore('conversationCoverage').put(coverage)
    await writeDone

    const summary: ArchiveIngestSummary = {
      conversationId,
      projectId: conversation.projectId,
      insertedMessages,
      updatedMessages,
      unchangedMessages,
      knownMessageCount: coverage.knownMessageCount,
      complete,
      hasOlderServerHistory: coverage.hasOlderServerHistory,
      observedAt: now,
    }
    window.dispatchEvent(new CustomEvent(ARCHIVE_UPDATED_EVENT, { detail: summary }))
    return summary
  }

  async #db(): Promise<IDBDatabase> {
    this.#database ??= openArchiveDatabase()
    return await this.#database
  }
}
