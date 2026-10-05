import {
  archiveRecordAttachments,
  buildArchiveThread,
  type ConversationDomSnapshot,
} from '@chatgpt-booster/chatgpt'
import {
  ARCHIVE_UPDATED_EVENT,
  type ArchiveAttachmentView,
  serverTimeMs,
} from '@chatgpt-booster/core'
import { historyCoverage } from './archive-coverage'

export { ARCHIVE_UPDATED_EVENT } from '@chatgpt-booster/core'

import {
  type ArchiveAssetResolutionEventDetail,
  archiveAssetContentUrl,
  type ConversationArchiveEventDetail,
} from '@chatgpt-booster/observer'

export const ARCHIVE_DB_NAME = 'chatgpt-booster-archive'
export const ARCHIVE_DB_VERSION = 3

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

export interface ArchivedProject {
  projectId: string
  title: string | null
  firstSeenAt: number
  lastSeenAt: number
}

export interface ArchivedAsset extends ArchiveAttachmentView {
  downloadUrl: string | null
  resolverObservedAt: number | null
  firstSeenAt: number
  lastSeenAt: number
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

export interface PreloadedConversationPage {
  pageKey: string
  conversationId: string
  readId: string | null
  readStartedAt: number | null
  isInitial: boolean
  requestedBefore: string | null
  observedAt: number
  expiresAt: number
  sourceUrl: string
  payload: Record<string, unknown>
}

export interface ArchivedConversationPage {
  readId?: string | undefined
  readStartedAt?: number | undefined
  isInitial?: boolean | undefined
  requestedBefore?: string | null | undefined
  pageKey: string
  conversationId: string
  startCursor: string | null
  endCursor: string | null
  hasPreviousPage: boolean | null
  hasNextPage: boolean | null
  messageIds: string[]
  observedAt: number
  sourceUrl: string
  captureReasoning?: boolean | null | undefined
  captureTools?: boolean | null | undefined
  captureInternal?: boolean | null | undefined
  omittedRecordCount?: number | null | undefined
}

export interface CaptureEvidence {
  conversationId: string
  readId: string | null
  pageCount: number
  omittedRecordCount: number | null
  verified: boolean
}

export interface ConversationCoverage {
  evidenceVersion?: number
  readId?: string | null
  readStartedAt?: number | null
  verifiedAt?: number | null
  historyPageCount?: number
  visibleMessageCount?: number
  internalRecordCount?: number
  conversationId: string
  oldestKnownMessageId: string | null
  newestKnownMessageId: string | null
  oldestKnownVisibleMessageId?: string | null
  newestKnownVisibleMessageId?: string | null
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
  pageKey?: string
  readId?: string | undefined
  readStartedAt?: number | undefined
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

function deleteExpiredPreloadPages(store: IDBObjectStore, now: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursor = store.index('expiresAt').openKeyCursor(IDBKeyRange.upperBound(now, true))
    cursor.onerror = () => reject(cursor.error ?? new Error('Failed to scan expired preload pages'))
    cursor.onsuccess = () => {
      const item = cursor.result
      if (!item) {
        resolve()
        return
      }
      store.delete(item.primaryKey)
      item.continue()
    }
  })
}

function deleteSupersededPreloadReads(
  store: IDBObjectStore,
  conversationId: string,
  readId: string | null,
): Promise<void> {
  const keepPrefix = `${conversationId}:${readId ?? 'preload'}:`
  return new Promise((resolve, reject) => {
    const cursor = store.index('conversationId').openKeyCursor(IDBKeyRange.only(conversationId))
    cursor.onerror = () => reject(cursor.error ?? new Error('Failed to compact preload reads'))
    cursor.onsuccess = () => {
      const item = cursor.result
      if (!item) {
        resolve()
        return
      }
      if (typeof item.primaryKey !== 'string' || !item.primaryKey.startsWith(keepPrefix))
        store.delete(item.primaryKey)
      item.continue()
    }
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
        open.transaction?.abort()
        return // Explicit legacy migration/export is required; never erase existing data.
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
      if (!db.objectStoreNames.contains('preloadPages')) {
        const preload = db.createObjectStore('preloadPages', { keyPath: 'pageKey' })
        preload.createIndex('conversationId', 'conversationId')
        preload.createIndex('expiresAt', 'expiresAt')
      }
    }
    open.onblocked = () => reject(new Error('Archive upgrade blocked by another tab'))
    open.onsuccess = () => {
      open.result.onversionchange = () => open.result.close()
      resolve(open.result)
    }
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

function preloadEvidence(page: PreloadedConversationPage) {
  const info = record(page.payload.page_info) ?? {}
  return {
    readId: page.readId ?? undefined,
    readStartedAt: page.readStartedAt ?? undefined,
    isInitial: page.isInitial,
    requestedBefore: page.requestedBefore,
    startCursor: stringOrNull(info.start_cursor),
    endCursor: stringOrNull(info.end_cursor),
    hasPreviousPage: booleanOrNull(info.has_previous_page),
    hasNextPage: booleanOrNull(info.has_next_page),
    observedAt: page.observedAt,
  }
}

export class ConversationArchiveStore {
  #domSnapshots = new Map<string, ConversationDomSnapshot>()

  setDomSnapshot(snapshot: ConversationDomSnapshot | undefined): void {
    if (!snapshot) return
    const previous = this.#domSnapshots.get(snapshot.conversationId)
    if (!previous || snapshot.observedAt >= previous.observedAt)
      this.#domSnapshots.set(snapshot.conversationId, snapshot)
  }

  mergeDomSnapshot(snapshot: ConversationDomSnapshot | undefined): void {
    if (!snapshot) return
    const previous = this.#domSnapshots.get(snapshot.conversationId)
    if (!previous) {
      this.#domSnapshots.set(snapshot.conversationId, snapshot)
      return
    }
    const records = new Map(previous.records.map((record) => [record.messageKey, record]))
    for (const record of snapshot.records) records.set(record.messageKey, record)
    this.#domSnapshots.set(snapshot.conversationId, {
      ...previous,
      ...snapshot,
      observedAt: Math.max(previous.observedAt, snapshot.observedAt),
      records: [...records.values()],
    })
  }

  getDomSnapshot(conversationId: string): ConversationDomSnapshot | undefined {
    return this.#domSnapshots.get(conversationId)
  }

  clearDomSnapshot(conversationId: string): void {
    this.#domSnapshots.delete(conversationId)
  }

  #database: Promise<IDBDatabase> | undefined
  #preloadReadIds = new Map<string, string | null>()

  async ingestPreload(detail: ConversationArchiveEventDetail): Promise<void> {
    await this.ingestPreloadBatch([detail])
  }

  async ingestPreloadBatch(details: readonly ConversationArchiveEventDetail[]): Promise<void> {
    if (!details.length) return
    const now = Date.now()
    const candidates: PreloadedConversationPage[] = []

    for (const detail of details) {
      const payload = detail.payload
      if (!payload || !Array.isArray(payload.messages)) continue
      if (payload.conversation_id && payload.conversation_id !== detail.conversationId) continue
      const pageInfo = record(payload.page_info) ?? {}
      const startCursor = stringOrNull(pageInfo.start_cursor)
      const endCursor = stringOrNull(pageInfo.end_cursor)
      candidates.push({
        pageKey: `${detail.conversationId}:${detail.readId ?? 'preload'}:${startCursor ?? ''}:${endCursor ?? ''}`,
        conversationId: detail.conversationId,
        readId: detail.readId ?? null,
        readStartedAt: detail.readStartedAt ?? null,
        isInitial: detail.isInitial === true,
        requestedBefore: detail.requestedBefore ?? null,
        observedAt: detail.timestamp || now,
        expiresAt: now + 24 * 60 * 60_000,
        sourceUrl: detail.sourceUrl,
        payload,
      })
    }
    if (!candidates.length) return

    const latestInitial = new Map<string, PreloadedConversationPage>()
    for (const entry of candidates) {
      if (!entry.isInitial) continue
      const previous = latestInitial.get(entry.conversationId)
      const entryTime = entry.readStartedAt ?? entry.observedAt
      const previousTime = previous ? (previous.readStartedAt ?? previous.observedAt) : -Infinity
      if (!previous || entryTime >= previousTime) latestInitial.set(entry.conversationId, entry)
    }
    for (const entry of latestInitial.values())
      this.#preloadReadIds.set(entry.conversationId, entry.readId)

    const entries = new Map<string, PreloadedConversationPage>()
    for (const entry of candidates) {
      const activeReadId = this.#preloadReadIds.get(entry.conversationId)
      if (activeReadId !== undefined && activeReadId !== entry.readId) continue
      entries.set(entry.pageKey, entry)
    }
    if (!entries.size) return

    const db = await this.#db()
    const tx = db.transaction('preloadPages', 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore('preloadPages')
    const conversations = new Set<string>()
    const compacted = new Set<string>()
    for (const entry of entries.values()) {
      store.put(entry)
      conversations.add(entry.conversationId)
      if (entry.isInitial && !compacted.has(entry.conversationId)) {
        compacted.add(entry.conversationId)
        await deleteSupersededPreloadReads(store, entry.conversationId, entry.readId)
      }
    }
    await deleteExpiredPreloadPages(store, now)
    await done

    for (const conversationId of conversations)
      window.dispatchEvent(
        new CustomEvent(ARCHIVE_UPDATED_EVENT, {
          detail: { conversationId, preload: true },
        }),
      )
  }

  async listPreloadPages(conversationId: string): Promise<PreloadedConversationPage[]> {
    const db = await this.#db()
    const tx = db.transaction('preloadPages', 'readonly')
    const items = await request<PreloadedConversationPage[]>(
      tx
        .objectStore('preloadPages')
        .index('conversationId')
        .getAll(IDBKeyRange.only(conversationId)),
    )
    const now = Date.now()
    const live = items.filter((item) => item.expiresAt >= now)
    if (!live.length) return []
    const latestInitial = live
      .filter((item) => item.isInitial)
      .sort(
        (a, b) =>
          (b.readStartedAt ?? b.observedAt) - (a.readStartedAt ?? a.observedAt) ||
          b.observedAt - a.observedAt,
      )[0]
    const currentReadId =
      latestInitial?.readId ?? live.sort((a, b) => b.observedAt - a.observedAt)[0]?.readId
    return live
      .filter((item) => (currentReadId ? item.readId === currentReadId : true))
      .sort((a, b) => a.observedAt - b.observedAt)
  }

  async listLatestPreloadPages(conversationId: string): Promise<PreloadedConversationPage[]> {
    const pages = await this.listPreloadPages(conversationId)
    if (!pages.length) return []
    const coverage = historyCoverage(pages.map(preloadEvidence))
    const selectedReadId = coverage.readId ?? pages.at(-1)?.readId ?? null
    if (!selectedReadId) {
      const latest = pages.at(-1)
      return latest ? [latest] : []
    }
    return pages.filter((page) => page.readId === selectedReadId)
  }

  async getPreloadSnapshot(
    conversationId: string,
  ): Promise<{ records: ArchivedMessage[]; coverage: ConversationCoverage } | undefined> {
    const pages = await this.listLatestPreloadPages(conversationId)
    if (!pages.length) return undefined
    const byMessage = new Map<string, ArchivedMessage>()
    const evidencePages = pages.map(preloadEvidence)
    let projectId: string | null = null
    for (const page of pages) {
      projectId ??= normalizeProjectId(page.payload)
      const rawMessages = Array.isArray(page.payload.messages) ? page.payload.messages : []
      for (const raw of rawMessages.map(record)) {
        if (!raw) continue
        const previous = byMessage.get(`${conversationId}:${String(raw.id ?? '')}`)
        const normalized = normalizeMessage(
          raw,
          conversationId,
          projectId,
          page.observedAt,
          previous,
        )
        if (normalized) byMessage.set(normalized.messageKey, normalized)
      }
    }
    const records = [...byMessage.values()]
    const thread = buildArchiveThread(records)
    const evidence = historyCoverage(evidencePages)
    const orderedVisible = thread.turns
      .flatMap((turn) => turn.messages.map((item) => item.record))
      .sort(
        (a, b) =>
          serverTimeMs(a.createTime, a.firstSeenAt) - serverTimeMs(b.createTime, b.firstSeenAt),
      )
    const coverage: ConversationCoverage = {
      evidenceVersion: 1,
      readId: evidence.readId,
      readStartedAt: evidence.readStartedAt,
      verifiedAt: evidence.verified ? evidence.observedAt : null,
      historyPageCount: evidence.pageCount,
      visibleMessageCount: thread.messageCount,
      internalRecordCount: thread.detailCount,
      conversationId,
      oldestKnownMessageId: records[0]?.messageId ?? null,
      newestKnownMessageId: records.at(-1)?.messageId ?? null,
      oldestKnownVisibleMessageId: orderedVisible[0]?.messageId ?? null,
      newestKnownVisibleMessageId: orderedVisible.at(-1)?.messageId ?? null,
      oldestKnownCursor: evidence.oldestCursor,
      newestKnownCursor:
        stringOrNull(
          record(pages.filter((page) => page.isInitial).at(-1)?.payload.page_info)?.end_cursor,
        ) ?? null,
      hasOlderServerHistory: !evidence.verified,
      hasNewerServerHistory:
        booleanOrNull(
          record(pages.filter((page) => page.isInitial).at(-1)?.payload.page_info)?.has_next_page,
        ) ?? null,
      knownMessageCount: records.length,
      knownBranchConversationIds: [],
      lastObservedAt: pages.at(-1)?.observedAt ?? Date.now(),
      lastFullReadAt: evidence.verified ? evidence.observedAt : null,
      completeAtLastRead: evidence.verified,
    }
    return { records, coverage }
  }

  async listProjects(): Promise<ArchivedProject[]> {
    const db = await this.#db()
    const tx = db.transaction('projects', 'readonly')
    const items = await request<ArchivedProject[]>(tx.objectStore('projects').getAll())
    return items.sort((a, b) => a.title?.localeCompare(b.title ?? '') ?? 0)
  }

  async getProject(projectId: string): Promise<ArchivedProject | undefined> {
    const db = await this.#db()
    const tx = db.transaction('projects', 'readonly')
    return await request<ArchivedProject | undefined>(tx.objectStore('projects').get(projectId))
  }

  async upsertProject(projectId: string, title: string | null): Promise<void> {
    const db = await this.#db()
    // One read/write transaction prevents a late null title from losing a known name.
    const tx = db.transaction('projects', 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore('projects')
    const previous = await request<ArchivedProject | undefined>(store.get(projectId))
    const now = Date.now()
    store.put({
      projectId,
      title: title?.trim() || previous?.title || null,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
    } satisfies ArchivedProject)
    await done
  }

  async syncAssetMetadata(records: ArchivedMessage[]): Promise<ArchivedAsset[]> {
    const metadata = new Map<string, ArchiveAttachmentView>()
    for (const record of records)
      for (const item of archiveRecordAttachments(record)) {
        const previous = metadata.get(item.assetId)
        metadata.set(item.assetId, {
          ...previous,
          ...item,
          fileName: item.fileName ?? previous?.fileName ?? null,
          mimeType: item.mimeType ?? previous?.mimeType ?? null,
          sizeBytes: item.sizeBytes ?? previous?.sizeBytes ?? null,
          width: item.width ?? previous?.width ?? null,
          height: item.height ?? previous?.height ?? null,
          kind: item.kind === 'image' || previous?.kind === 'image' ? 'image' : 'file',
        })
      }
    if (!metadata.size) return []
    const db = await this.#db()
    const tx = db.transaction('assets', 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore('assets')
    const previous = await Promise.all(
      [...metadata.keys()].map((assetId) => request<ArchivedAsset | undefined>(store.get(assetId))),
    )
    const now = Date.now()
    const results: ArchivedAsset[] = []
    let index = 0
    for (const item of metadata.values()) {
      const old = previous[index++]
      const next: ArchivedAsset = {
        ...item,
        fileName: item.fileName ?? old?.fileName ?? null,
        mimeType: item.mimeType ?? old?.mimeType ?? null,
        sizeBytes: item.sizeBytes ?? old?.sizeBytes ?? null,
        width: item.width ?? old?.width ?? null,
        height: item.height ?? old?.height ?? null,
        kind: item.kind === 'image' || old?.kind === 'image' ? 'image' : 'file',
        downloadUrl: old?.downloadUrl ?? null,
        resolverObservedAt: old?.resolverObservedAt ?? null,
        firstSeenAt: old?.firstSeenAt ?? now,
        lastSeenAt: now,
      }
      store.put(next)
      results.push(next)
    }
    await done
    return results
  }

  async updateAssetResolution(
    detail: ArchiveAssetResolutionEventDetail,
    conversationId: string,
  ): Promise<boolean> {
    const downloadUrl = archiveAssetContentUrl(detail.downloadUrl, detail.assetId)
    if (!downloadUrl) return false
    const db = await this.#db()
    const tx = db.transaction(['assets', 'messages'], 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore('assets')
    const [previous, messages] = await Promise.all([
      request<ArchivedAsset | undefined>(store.get(detail.assetId)),
      request<ArchivedMessage[]>(
        tx.objectStore('messages').index('conversationId').getAll(IDBKeyRange.only(conversationId)),
      ),
    ])
    let metadata: ArchiveAttachmentView | undefined
    for (const message of messages) {
      const candidate = archiveRecordAttachments(message).find(
        (attachment) => attachment.assetId === detail.assetId,
      )
      if (!candidate) continue
      metadata = metadata
        ? {
            ...metadata,
            ...candidate,
            fileName: candidate.fileName ?? metadata.fileName,
            mimeType: candidate.mimeType ?? metadata.mimeType,
            sizeBytes: candidate.sizeBytes ?? metadata.sizeBytes,
            width: candidate.width ?? metadata.width,
            height: candidate.height ?? metadata.height,
            kind: candidate.kind === 'image' || metadata.kind === 'image' ? 'image' : 'file',
          }
        : candidate
    }
    // A resolver observed in one chat must never refresh an archived asset that is not
    // referenced by that same conversation. This keeps signed URL writes scoped to consent.
    if (!metadata) {
      await done
      return false
    }
    const now = Date.now()
    const base: ArchivedAsset = previous ?? {
      ...metadata,
      downloadUrl: null,
      resolverObservedAt: null,
      firstSeenAt: now,
      lastSeenAt: now,
    }
    store.put({
      ...base,
      fileName: detail.fileName ?? base.fileName,
      mimeType: detail.mimeType ?? base.mimeType,
      sizeBytes: detail.fileSizeBytes ?? base.sizeBytes,
      downloadUrl,
      resolverObservedAt: detail.observedAt,
      lastSeenAt: now,
    } satisfies ArchivedAsset)
    await done
    return true
  }

  async getAssets(assetIds: string[]): Promise<ArchivedAsset[]> {
    const ids = [...new Set(assetIds)]
    if (!ids.length) return []
    const db = await this.#db()
    const tx = db.transaction('assets', 'readonly')
    const store = tx.objectStore('assets')
    return (
      await Promise.all(ids.map((id) => request<ArchivedAsset | undefined>(store.get(id))))
    ).filter((item): item is ArchivedAsset => Boolean(item))
  }

  async getCaptureEvidence(
    conversationId: string,
    readId: string | null | undefined,
  ): Promise<CaptureEvidence> {
    const db = await this.#db()
    const tx = db.transaction('conversationPages', 'readonly')
    const pages = await request<ArchivedConversationPage[]>(
      tx.objectStore('conversationPages').index('conversationId').getAll(conversationId),
    )
    const selected = readId ? pages.filter((page) => page.readId === readId) : []
    const known = selected.every(
      (page) =>
        typeof page.omittedRecordCount === 'number' && Number.isFinite(page.omittedRecordCount),
    )
    const omittedRecordCount = known
      ? selected.reduce((sum, page) => sum + (page.omittedRecordCount ?? 0), 0)
      : null
    return {
      conversationId,
      readId: readId ?? null,
      pageCount: selected.length,
      omittedRecordCount,
      verified: selected.length > 0 && known && omittedRecordCount === 0,
    }
  }

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

  async listConversations(): Promise<ArchivedConversation[]> {
    const db = await this.#db()
    const tx = db.transaction('conversations', 'readonly')
    const items = await request<ArchivedConversation[]>(tx.objectStore('conversations').getAll())
    return items.sort(
      (a, b) => serverTimeMs(b.updatedAt, b.lastSeenAt) - serverTimeMs(a.updatedAt, a.lastSeenAt),
    )
  }

  async listMessages(conversationId: string): Promise<ArchivedMessage[]> {
    const db = await this.#db()
    const tx = db.transaction('messages', 'readonly')
    const index = tx.objectStore('messages').index('conversationId')
    const items = await request<ArchivedMessage[]>(index.getAll(IDBKeyRange.only(conversationId)))
    return items.sort(
      (a, b) =>
        serverTimeMs(a.createTime, a.firstSeenAt) - serverTimeMs(b.createTime, b.firstSeenAt) ||
        a.messageId.localeCompare(b.messageId),
    )
  }

  async ingest(
    detail: ConversationArchiveEventDetail,
    canWrite: () => boolean = () => true,
  ): Promise<ArchiveIngestSummary | undefined> {
    if (!canWrite()) return undefined
    const payload = detail.payload
    const conversationId = stringOrNull(payload.conversation_id) ?? detail.conversationId
    const incomingMessages = Array.isArray(payload.messages)
      ? payload.messages.map(record).filter((value): value is RawRecord => Boolean(value))
      : []
    // Stable record identity, including duplicate IDs within one server page.
    const rawMessages = [
      ...new Map(
        incomingMessages
          .filter((message) => typeof message.id === 'string')
          .map((message) => [message.id, message]),
      ).values(),
    ]
    const pageInfo = record(payload.page_info)
    if (!conversationId || !pageInfo) throw new Error('Invalid conversation archive payload')
    const capture = record(payload.booster_capture)

    const now = detail.timestamp
    const incomingProjectId = normalizeProjectId(payload)
    const db = await this.#db()
    if (!canWrite()) return undefined

    const readTx = db.transaction(
      ['conversations', 'messages', 'conversationCoverage', 'conversationPages'],
      'readwrite',
    )
    const writeDone = transactionDone(readTx)
    const previousPagesPromise = request<ArchivedConversationPage[]>(
      readTx.objectStore('conversationPages').index('conversationId').getAll(conversationId),
    )
    const allMessagesPromise = request<ArchivedMessage[]>(
      readTx.objectStore('messages').index('conversationId').getAll(conversationId),
    )
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
    const [oldConversation, oldCoverage, previousMessages, previousPages, allMessages] =
      await Promise.all([
        conversationPromise,
        coveragePromise,
        previousMessagesPromise,
        previousPagesPromise,
        allMessagesPromise,
      ])

    // Consent can be revoked while database requests are in flight. No puts yet.
    if (!canWrite()) {
      await writeDone
      return undefined
    }

    const projectId =
      'gizmo_id' in payload ? incomingProjectId : (oldConversation?.projectId ?? null)
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
    const candidatePage = {
      readId: detail.readId,
      readStartedAt: detail.readStartedAt,
      isInitial: detail.isInitial,
      requestedBefore: detail.requestedBefore,
      startCursor,
      endCursor,
      hasPreviousPage,
      hasNextPage,
      observedAt: now,
      captureReasoning: booleanOrNull(capture?.reasoning),
      captureTools: booleanOrNull(capture?.tools),
      captureInternal: booleanOrNull(capture?.internal),
      omittedRecordCount: numberOrNull(capture?.omittedRecords),
    }
    const evidence = historyCoverage([...previousPages, candidatePage])
    const complete = evidence.verified
    const archiveState: ArchivedConversation['archiveState'] = complete ? 'complete' : 'partial'

    const conversation: ArchivedConversation = {
      conversationId,
      projectId,
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
      lastFullReadAt: complete ? now : (oldConversation?.lastFullReadAt ?? null),
      archiveState,
      raw: { ...(oldConversation?.raw ?? {}), ...withoutMessages(payload) },
    }

    const messageIds = normalizedMessages.map((message) => message.messageId)
    const pageKey = `${conversationId}:${detail.readId ?? 'legacy'}:${startCursor ?? ''}:${endCursor ?? ''}`
    const page: ArchivedConversationPage = {
      ...candidatePage,
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
    const mergedRecords = new Map(allMessages.map((message) => [message.messageKey, message]))
    for (const message of normalizedMessages) mergedRecords.set(message.messageKey, message)
    const counts = buildArchiveThread([...mergedRecords.values()])
    const visibleRecords = counts.turns
      .flatMap((turn) => turn.messages.map((item) => item.record))
      .sort(
        (a, b) =>
          serverTimeMs(a.createTime, a.firstSeenAt) - serverTimeMs(b.createTime, b.firstSeenAt),
      )
    const coverage: ConversationCoverage = {
      evidenceVersion: 1,
      readId: evidence.readId,
      readStartedAt: evidence.readStartedAt,
      verifiedAt: complete ? evidence.observedAt : null,
      historyPageCount: evidence.pageCount,
      visibleMessageCount: counts.messageCount,
      internalRecordCount: counts.detailCount,
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
      oldestKnownVisibleMessageId:
        visibleRecords[0]?.messageId ?? oldCoverage?.oldestKnownVisibleMessageId ?? null,
      newestKnownVisibleMessageId:
        visibleRecords.at(-1)?.messageId ?? oldCoverage?.newestKnownVisibleMessageId ?? null,
      oldestKnownCursor:
        hasNextPage === true ? startCursor : (oldCoverage?.oldestKnownCursor ?? startCursor),
      newestKnownCursor:
        hasPreviousPage === true ? endCursor : (oldCoverage?.newestKnownCursor ?? endCursor),
      hasOlderServerHistory: evidence.startReached ? false : evidence.readId ? true : null,
      hasNewerServerHistory: detail.isInitial
        ? hasNextPage
        : (oldCoverage?.hasNewerServerHistory ?? null),
      knownMessageCount: counts.recordCount,
      knownBranchConversationIds: [...knownBranches],
      lastObservedAt: now,
      lastFullReadAt: complete ? now : (oldCoverage?.lastFullReadAt ?? null),
      completeAtLastRead: complete,
    }

    const writeTx = readTx
    writeTx.objectStore('conversations').put(conversation)
    const writeMessages = writeTx.objectStore('messages')
    for (const message of normalizedMessages) writeMessages.put(message)
    if (oldConversation && oldConversation.projectId !== projectId) {
      const incomingKeys = new Set(normalizedMessages.map((message) => message.messageKey))
      for (const previous of allMessages)
        if (!incomingKeys.has(previous.messageKey)) writeMessages.put({ ...previous, projectId })
    }
    writeTx.objectStore('conversationPages').put(page)
    writeTx.objectStore('conversationCoverage').put(coverage)
    await writeDone
    // Asset metadata is ancillary to the conversation transaction. It can be rebuilt
    // from raw records later, so a separate asset-store failure must not invalidate chat data.
    await this.syncAssetMetadata(normalizedMessages).catch(() => [])

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
      pageKey,
      readId: detail.readId,
      readStartedAt: detail.readStartedAt,
    }
    window.dispatchEvent(new CustomEvent(ARCHIVE_UPDATED_EVENT, { detail: summary }))
    return summary
  }

  async #db(): Promise<IDBDatabase> {
    this.#database ??= openArchiveDatabase().catch((error) => {
      this.#database = undefined
      throw error
    })
    return await this.#database
  }
}
