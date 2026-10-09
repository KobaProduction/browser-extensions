import type {
  ConversationArchiveEventDetail,
  ConversationCatalogEventDetail,
  ConversationSubmissionSelection,
} from '@chatgpt-booster/observer'
import {
  requestResult as req,
  transactionComplete as settled,
} from '@kobaproduction/browser-storage'
import { type HistoryPageEvidence, historyCoverage } from './archive-coverage'
import {
  ArchiveSourceGate,
  type ArchiveSubmissionSnapshot,
  sameSubmissionSelection,
} from './archive-source-contract'
import { ArchiveV4Database } from './archive-v4-database'
import { traceArchiveV4Path, traceArchiveV4PathIds } from './archive-v4-path'
import {
  archiveWriteAllowed,
  canonicalSourceJson,
  guardArchiveTransaction,
  sourceFingerprint,
} from './archive-v4-write'
import { normalizeConversationProjectId } from './conversation-records'

/**
 * Clean storage namespace. No upgrade, import, or deletion of legacy v3 data.
 * Four ChatGPT domain entities; UI preferences and export jobs are independent.
 */
export { ARCHIVE_V4_DB_NAME, ARCHIVE_V4_DB_VERSION } from './archive-v4-database'
export { traceArchiveV4Path, traceArchiveV4PathIds } from './archive-v4-path'

type Source = Record<string, unknown>
type OwnerType = 'project' | 'conversation' | 'message' | 'account'
type MetadataKind =
  | 'history-page'
  | 'message-snapshot'
  | 'message-revision-evidence'
  | 'submission-selection'
  | 'write-generation'

export interface ArchiveV4Project {
  key: string
  projectId: string
  accountId: string
  title: string | null
  firstSeenAt: number
  lastSeenAt: number
}

export interface ArchiveV4Conversation {
  key: string
  conversationId: string
  accountId: string
  projectId: string | null
  title: string | null
  currentNodeId: string | null
  /** Newest native initial read allowed to update title/project/selected head. */
  headReadId?: string | null
  headReadStartedAt?: number | null
  catalogReadStartedAt?: number | null
  /** Changes on recreation, so deleting and recollecting cannot alias revision 1. */
  instanceId?: string
  latestReadId?: string | null
  latestReadStartedAt?: number | null
  latestReadConflicted?: boolean
  knownMessageCount: number
  // Native create_time may be null. These messages remain stored but have no proven chronology.
  unsequencedMessageCount: number
  firstKnownMessageId: string | null
  lastKnownMessageId: string | null
  firstKnownTime: number | null
  lastKnownTime: number | null
  // Source pagination proof does not prove selected branch ancestry.
  verifiedPathRootId: string | null
  verifiedPathTipId: string | null
  /** The exact native history read and revision that established these boundaries. */
  verifiedPathReadId?: string | null
  verifiedPathRevision?: number | null
  coverage: 'unverified'
  revision: number
  firstSeenAt: number
  lastSeenAt: number
}

export interface ArchiveV4Message {
  key: string
  conversationKey: string
  messageId: string
  parentId: string | null
  // Absent parent_id is not proof that this node is a root.
  parentKnown: boolean
  sourceCreateTime: number | null
  firstSeenAt: number
  lastSeenAt: number
  revision: number
  /** Snapshot provenance prevents a late older read overwriting fresher raw. */
  sourceReadId?: string | null
  sourceReadStartedAt?: number | null
  sourceFingerprint?: string
  // Entire original ChatGPT message. No Booster keys inserted or removed.
  raw: Source
}

export interface ArchiveV4Metadata {
  key: string
  ownerType: OwnerType
  ownerKey: string
  kind: MetadataKind
  observedAt: number
  payload: Source
}

/** Previous stored source version; no claim about when or who edited it. */
export interface ArchiveV4SourceRevisionEvidence {
  previousRevision: number
  previousLastSeenAtMs: number
  sourceReadId: string | null
  sourceReadStartedAtMs: number | null
}

export interface ArchiveV4SourceRevisionWindow {
  previous: ArchiveV4SourceRevisionEvidence[]
  /** Older revisions have been omitted to bound the exported evidence. */
  olderRevisionsOmitted: boolean
}

export type ArchiveV4SubmissionEvidence =
  | { status: 'unobserved' | 'conflicted'; selection: null }
  | { status: 'observed'; selection: ConversationSubmissionSelection }

export type ArchiveV4Change =
  | { kind: 'conversation'; accountId: string; conversationId: string; revision: number }
  | { kind: 'project'; accountId: string; projectId: string }
  | { kind: 'cleared'; accountId: string }

export interface ArchiveV4WriteTicket {
  readonly accountId: string
  readonly generation: string | null
  readonly localEpoch: number
  readonly requestedAt: number
}
export interface ArchiveV4WriteOptions {
  ticket?: ArchiveV4WriteTicket
  signal?: AbortSignal
}

export interface ArchiveV4IngestResult {
  mutated: boolean
  conversationKey: string
  inserted: number
  changed: number
  unchanged: number
  totalMessages: number
  revision: number
}

/** A chronological preview is not proof of a complete message lineage. */
export interface ArchiveV4Preview {
  conversation: ArchiveV4Conversation | undefined
  earliest: ArchiveV4Message[]
  latest: ArchiveV4Message[]
  hiddenKnownCount: number
  hasUnsequencedMessages: boolean
}

export type ArchiveV4PathStatus =
  | 'verified'
  | 'conversation_missing'
  | 'head_mismatch'
  | 'pagination_incomplete'
  | 'capture_omissions'
  | 'tip_missing'
  | 'parent_unknown'
  | 'missing_parent'
  | 'cyclic_parent'
  | 'depth_limit'
  | 'source_changed'

export interface ArchiveV4PathResult {
  status: ArchiveV4PathStatus
  /** Ordered root -> selected tip for the confirmed subset only. */
  messages: ArchiveV4Message[]
  rootId: string | null
  selectedTipId: string
  // Raw provenance is never inferred from chronological adjacency.
  coverageReadId: string | null
  /** Conversation revision captured before tracing this native path. */
  conversationRevision: number | null
  conversationInstanceId?: string | null
}

/** Verified root-to-tip IDs without retaining every source-native raw message. */
export type ArchiveV4PathIndex = Omit<ArchiveV4PathResult, 'messages'> & {
  messageIds: string[]
}

function key(...values: string[]): string {
  return JSON.stringify(values)
}

function identity(value: string, label: string): string {
  if (!value || value.trim() !== value) throw new Error('Invalid value: '.concat(label))
  return value
}

function sourceObject(value: unknown): Source {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid source message object')
  return value as Source
}

function comparePoint(aTime: number, aId: string, bTime: number, bId: string): number {
  return aTime - bTime || (aId < bId ? -1 : aId > bId ? 1 : 0)
}

export class ArchiveV4Store {
  readonly #database = new ArchiveV4Database()
  #listeners = new Set<(change: ArchiveV4Change) => void>()
  #writeEpochs = new Map<string, number>()
  #channel: BroadcastChannel | undefined

  subscribe(listener: (change: ArchiveV4Change) => void): () => void {
    this.#listeners.add(listener)
    if (!this.#channel && typeof BroadcastChannel !== 'undefined') {
      try {
        this.#channel = new BroadcastChannel('chatgpt-booster:archive-v4:changes-v1')
        this.#channel.onmessage = (event: MessageEvent<unknown>) => {
          const value = event.data
          if (!value || typeof value !== 'object') return
          const data = value as Record<string, unknown>
          const validId = (v: unknown): v is string =>
            typeof v === 'string' && !!v && v.length <= 4096
          if (!validId(data.accountId)) return
          let change: ArchiveV4Change | undefined
          if (data.kind === 'cleared') change = { kind: 'cleared', accountId: data.accountId }
          else if (data.kind === 'project' && validId(data.projectId))
            change = { kind: 'project', accountId: data.accountId, projectId: data.projectId }
          else if (
            data.kind === 'conversation' &&
            validId(data.conversationId) &&
            typeof data.revision === 'number' &&
            Number.isSafeInteger(data.revision) &&
            data.revision >= 0
          )
            change = {
              kind: 'conversation',
              accountId: data.accountId,
              conversationId: data.conversationId,
              revision: data.revision,
            }
          // Notifications invalidate local views only; they never prove data or authorize writes.
          if (change) this.#emit(change, false)
        }
      } catch {
        /* Snapshot checks remain authoritative without cross-tab notifications. */
      }
    }
    return () => {
      this.#listeners.delete(listener)
      if (!this.#listeners.size) {
        this.#channel?.close()
        this.#channel = undefined
      }
    }
  }

  #emit(change: ArchiveV4Change, broadcast = true) {
    if (change.kind === 'cleared')
      this.#writeEpochs.set(change.accountId, (this.#writeEpochs.get(change.accountId) ?? 0) + 1)
    for (const listener of this.#listeners) {
      try {
        listener(change)
      } catch {
        /* A subscriber cannot reverse a committed transaction. */
      }
    }
    if (broadcast) {
      try {
        this.#channel?.postMessage(change)
      } catch {
        /* Never convert a committed write into failure. */
      }
    }
  }

  /** Captured before queueing work; compared again under the eventual write lock. */
  async acquireWriteTicket(accountId: string): Promise<ArchiveV4WriteTicket> {
    identity(accountId, 'accountId')
    const localEpoch = this.#writeEpochs.get(accountId) ?? 0
    const requestedAt = Date.now()
    const db = await this.#db()
    const value = await req<ArchiveV4Metadata | undefined>(
      db
        .transaction('metadata', 'readonly')
        .objectStore('metadata')
        .get(key(key(accountId), 'write-generation')),
    )
    return Object.freeze({
      accountId,
      localEpoch,
      requestedAt,
      generation: this.#generation(value, accountId),
    })
  }

  #generation(value: ArchiveV4Metadata | undefined, accountId: string): string | null {
    if (!value) return null
    if (
      value.ownerType !== 'account' ||
      value.ownerKey !== key(accountId) ||
      value.kind !== 'write-generation' ||
      typeof value.payload.generation !== 'string' ||
      !Number.isFinite(value.observedAt)
    )
      throw new Error('archive.error.sourceChanged')
    return value.payload.generation
  }

  #ticketMatches(ticket: ArchiveV4WriteTicket, generation: ArchiveV4Metadata | undefined): boolean {
    return (
      ticket.localEpoch === (this.#writeEpochs.get(ticket.accountId) ?? 0) &&
      // A ticket waiting for DB open may first observe the new generation after
      // cleanup. Do not let that race grant earlier work the new generation.
      (!generation || ticket.requestedAt > generation.observedAt) &&
      ticket.generation === this.#generation(generation, ticket.accountId)
    )
  }

  constructor(readonly sourceGate = new ArchiveSourceGate()) {}

  async #db(): Promise<IDBDatabase> {
    return this.#database.open()
  }

  async warmup(): Promise<void> {
    await this.#db()
  }

  /** Validate/fingerprint outside the transaction; publish only a committed semantic delta. */
  async ingest(
    incoming: ConversationArchiveEventDetail,
    accountId: string,
    stillAuthorized: () => boolean = () => true,
    shouldCapture: (message: Readonly<Source>) => boolean = () => true,
    submissionSelections: ReadonlyMap<string, ArchiveSubmissionSnapshot> = new Map(),
    write: ArchiveV4WriteOptions = {},
  ): Promise<ArchiveV4IngestResult | undefined> {
    const allowed = () => archiveWriteAllowed(write.signal, stillAuthorized)
    if (!allowed()) return undefined
    identity(accountId, 'accountId')
    // Clone before the first await; queued native objects may not change under a fingerprint.
    const detail = structuredClone(incoming)
    identity(detail.conversationId, 'conversationId')
    if (detail.accountId !== accountId || !detail.readId) throw new Error('archive.error.auth')
    this.sourceGate.inspect(detail)
    const observedAt = detail.timestamp
    const readStartedAt = detail.readStartedAt ?? observedAt
    if (!Number.isFinite(observedAt) || !Number.isFinite(readStartedAt))
      throw new Error('archive.error.incompatibleSource')
    const received = (detail.payload.messages as unknown[]).map(sourceObject)
    const seen = new Map<string, string>()
    const allRecords: { raw: Source; canonical: string; capture: boolean; fingerprint: string }[] =
      []
    for (const raw of received) {
      const messageId = identity(raw.id as string, 'messageId')
      if (
        raw.create_time !== null &&
        (typeof raw.create_time !== 'number' || !Number.isFinite(raw.create_time))
      )
        throw new Error('archive.error.incompatibleSource')
      const canonical = canonicalSourceJson(raw)
      const previous = seen.get(messageId)
      if (previous !== undefined && previous !== canonical)
        throw new Error('archive.error.sourceChanged')
      if (previous === undefined)
        allRecords.push({ raw, canonical, capture: shouldCapture(raw), fingerprint: '' })
      seen.set(messageId, canonical)
    }
    const ticket = write.ticket ?? (await this.acquireWriteTicket(accountId))
    if (ticket.accountId !== accountId) throw new Error('archive.error.auth')
    if (!allowed()) return undefined
    for (const record of allRecords) {
      record.fingerprint = await sourceFingerprint(record.canonical)
      if (!allowed()) return undefined
    }
    const messages = allRecords.filter((record) => record.capture)
    const conversationKey = key(accountId, detail.conversationId)
    const projectId = normalizeConversationProjectId(detail.payload)
    const { messages: _rawPageMessages, ...nativeEnvelope } = detail.payload
    void _rawPageMessages
    const pageFingerprint = await sourceFingerprint(
      canonicalSourceJson({
        nativeEnvelope,
        messages: allRecords.map((record) => [record.raw.id, record.fingerprint]),
      }),
    )
    const submissions = messages.flatMap(({ raw }) => {
      if (sourceObject(raw.author).role !== 'user') return []
      const snapshot = submissionSelections.get(raw.id as string)
      if (!snapshot || snapshot.selection.observedAtMs > observedAt) return []
      const copy = structuredClone(snapshot)
      this.sourceGate.inspectSubmissionSelection(detail.conversationId, copy.selection)
      if (copy.selection.messageId !== raw.id) throw new Error('archive.error.sourceChanged')
      return [{ ...copy, ownerKey: key(conversationKey, copy.selection.messageId) }]
    })
    if (!allowed()) return undefined
    const db = await this.#db()
    if (!allowed()) return undefined
    this.sourceGate.assertCompatible(detail.conversationId)
    const tx = db.transaction(['projects', 'conversations', 'messages', 'metadata'], 'readwrite')
    const done = settled(tx)
    const detach = guardArchiveTransaction(tx, write.signal)
    try {
      const projects = tx.objectStore('projects')
      const conversations = tx.objectStore('conversations')
      const records = tx.objectStore('messages')
      const metadata = tx.objectStore('metadata')
      const projectKey = projectId ? key(accountId, projectId) : null
      const pageKey = key(
        conversationKey,
        'page',
        detail.readId,
        detail.isInitial ? 'initial' : 'older',
        detail.requestedBefore ?? '',
      )
      const [
        previousConversation,
        previousProject,
        previousPage,
        previousMessages,
        previousSubmissions,
        generation,
      ] = await Promise.all([
        req<ArchiveV4Conversation | undefined>(conversations.get(conversationKey)),
        projectKey
          ? req<ArchiveV4Project | undefined>(projects.get(projectKey))
          : Promise.resolve(undefined),
        req<ArchiveV4Metadata | undefined>(metadata.get(pageKey)),
        Promise.all(
          messages.map(({ raw }) =>
            req<ArchiveV4Message | undefined>(records.get(key(conversationKey, raw.id as string))),
          ),
        ),
        Promise.all(
          submissions.map((item) =>
            req<ArchiveV4Metadata | undefined>(
              metadata.get(key(item.ownerKey, 'submission-selection')),
            ),
          ),
        ),
        req<ArchiveV4Metadata | undefined>(metadata.get(key(key(accountId), 'write-generation'))),
      ])
      if (!allowed() || !this.#ticketMatches(ticket, generation)) {
        tx.abort()
        await done.catch(() => undefined)
        return undefined
      }
      this.sourceGate.assertCompatible(detail.conversationId)
      if (
        previousConversation &&
        (previousConversation.accountId !== accountId ||
          previousConversation.conversationId !== detail.conversationId)
      )
        throw new Error('archive.error.auth')
      if (
        previousPage &&
        (previousPage.ownerKey !== conversationKey || previousPage.kind !== 'history-page')
      )
        throw new Error('archive.error.auth')
      const unchangedResult = (): ArchiveV4IngestResult => ({
        mutated: false,
        conversationKey,
        inserted: 0,
        changed: 0,
        unchanged: messages.length,
        totalMessages: previousConversation?.knownMessageCount ?? 0,
        revision: previousConversation?.revision ?? 0,
      })
      // A delayed duplicate page cannot replace newer proof or reintroduce omitted categories.
      if (previousPage && observedAt < previousPage.observedAt) {
        await done
        return allowed() ? unchangedResult() : undefined
      }
      const summary: ArchiveV4Conversation = previousConversation
        ? { ...previousConversation }
        : {
            key: conversationKey,
            accountId,
            conversationId: detail.conversationId,
            projectId,
            title: null,
            currentNodeId: null,
            instanceId: crypto.randomUUID(),
            headReadId: null,
            headReadStartedAt: null,
            latestReadId: null,
            latestReadStartedAt: null,
            latestReadConflicted: false,
            knownMessageCount: 0,
            unsequencedMessageCount: 0,
            firstKnownMessageId: null,
            lastKnownMessageId: null,
            firstKnownTime: null,
            lastKnownTime: null,
            verifiedPathRootId: null,
            verifiedPathTipId: null,
            verifiedPathReadId: null,
            verifiedPathRevision: null,
            coverage: 'unverified',
            revision: 0,
            firstSeenAt: observedAt,
            lastSeenAt: observedAt,
          }
      const latestStart = summary.latestReadStartedAt ?? summary.headReadStartedAt ?? null
      const latestId = summary.latestReadId ?? summary.headReadId ?? null
      if (latestStart === null || readStartedAt > latestStart) {
        summary.latestReadId = detail.readId
        summary.latestReadStartedAt = readStartedAt
        summary.latestReadConflicted = false
      } else if (readStartedAt === latestStart && latestId && latestId !== detail.readId) {
        summary.latestReadConflicted = true
      }
      const canUpdateHead =
        detail.isInitial === true &&
        !summary.latestReadConflicted &&
        summary.latestReadId === detail.readId &&
        readStartedAt === summary.latestReadStartedAt &&
        (summary.headReadId !== detail.readId ||
          !previousPage ||
          observedAt >= previousPage.observedAt)
      if (canUpdateHead) {
        if (readStartedAt >= (summary.catalogReadStartedAt ?? -Infinity)) {
          if (Object.hasOwn(detail.payload, 'gizmo_id')) summary.projectId = projectId
          if (Object.hasOwn(detail.payload, 'title'))
            summary.title = typeof detail.payload.title === 'string' ? detail.payload.title : null
        }
        if (Object.hasOwn(detail.payload, 'current_node'))
          summary.currentNodeId =
            typeof detail.payload.current_node === 'string' ? detail.payload.current_node : null
        summary.headReadId = detail.readId
        summary.headReadStartedAt = readStartedAt
      }
      let inserted = 0,
        changed = 0,
        unchanged = 0,
        staleRecordCount = 0
      let submissionChanged = false
      for (let i = 0; i < messages.length; i++) {
        const item = messages[i]
        if (!item) continue
        const { raw, canonical, fingerprint } = item
        const messageId = raw.id as string
        const sourceCreateTime = raw.create_time as number | null
        const previous = previousMessages[i]
        if (
          previous &&
          (previous.conversationKey !== conversationKey || previous.messageId !== messageId)
        )
          throw new Error('archive.error.auth')
        const identical =
          !!previous &&
          (previous.sourceFingerprint
            ? previous.sourceFingerprint === fingerprint
            : canonicalSourceJson(previous.raw) === canonical)
        const previousStart = previous?.sourceReadStartedAt ?? previous?.lastSeenAt ?? -Infinity
        const oldVersion =
          previous && typeof previous.raw.update_time === 'number'
            ? previous.raw.update_time
            : previous?.sourceCreateTime
        const newVersion = typeof raw.update_time === 'number' ? raw.update_time : sourceCreateTime
        const older =
          !!previous &&
          (readStartedAt < previousStart ||
            (readStartedAt === previousStart &&
              !!previous.sourceReadId &&
              previous.sourceReadId !== detail.readId) ||
            observedAt < previous.lastSeenAt ||
            (oldVersion != null && newVersion !== null && newVersion < oldVersion))
        if (identical && previous) {
          if (!older && (readStartedAt > previousStart || !previous.sourceFingerprint)) {
            records.put({
              ...previous,
              sourceFingerprint: fingerprint,
              sourceReadId: detail.readId,
              sourceReadStartedAt: readStartedAt,
              lastSeenAt: Math.max(previous.lastSeenAt, observedAt),
            } satisfies ArchiveV4Message)
          }
          unchanged++
          continue
        }
        if (older) {
          staleRecordCount++
          unchanged++
          continue
        }
        if (previous && previous.sourceCreateTime !== sourceCreateTime)
          throw new Error('archive.error.sourceChanged')
        if (previous) {
          metadata.put({
            key: key(previous.key, 'snapshot', String(previous.revision)),
            ownerType: 'message',
            ownerKey: previous.key,
            kind: 'message-snapshot',
            observedAt: previous.lastSeenAt,
            payload: {
              raw: previous.raw,
              revision: previous.revision,
              sourceFingerprint: previous.sourceFingerprint ?? null,
              sourceReadId: previous.sourceReadId ?? null,
              sourceReadStartedAt: previous.sourceReadStartedAt ?? null,
            },
          } satisfies ArchiveV4Metadata)
          // Evidence consumed by the compact writer stays tiny even when the
          // retained original snapshot contains very large multimodal data.
          // Both rows belong to the same all-or-nothing source transaction.
          metadata.put({
            key: key(previous.key, 'revision-evidence', String(previous.revision)),
            ownerType: 'message',
            ownerKey: previous.key,
            kind: 'message-revision-evidence',
            observedAt: previous.lastSeenAt,
            payload: {
              revision: previous.revision,
              sourceReadId: previous.sourceReadId ?? null,
              sourceReadStartedAt: previous.sourceReadStartedAt ?? null,
            },
          } satisfies ArchiveV4Metadata)
          changed++
        } else {
          inserted++
          summary.knownMessageCount++
          if (sourceCreateTime === null) summary.unsequencedMessageCount++
        }
        const meta = sourceObject(raw.metadata)
        records.put({
          key: key(conversationKey, messageId),
          conversationKey,
          messageId,
          parentId: typeof meta.parent_id === 'string' ? meta.parent_id : null,
          parentKnown:
            Object.hasOwn(meta, 'parent_id') &&
            (meta.parent_id === null || typeof meta.parent_id === 'string'),
          sourceCreateTime,
          firstSeenAt: previous?.firstSeenAt ?? observedAt,
          lastSeenAt: observedAt,
          revision: (previous?.revision ?? 0) + 1,
          sourceReadId: detail.readId,
          sourceReadStartedAt: readStartedAt,
          sourceFingerprint: fingerprint,
          raw,
        } satisfies ArchiveV4Message)
        if (sourceCreateTime !== null) {
          if (
            summary.firstKnownTime === null ||
            !summary.firstKnownMessageId ||
            comparePoint(
              sourceCreateTime,
              messageId,
              summary.firstKnownTime,
              summary.firstKnownMessageId,
            ) < 0
          ) {
            summary.firstKnownTime = sourceCreateTime
            summary.firstKnownMessageId = messageId
          }
          if (
            summary.lastKnownTime === null ||
            !summary.lastKnownMessageId ||
            comparePoint(
              sourceCreateTime,
              messageId,
              summary.lastKnownTime,
              summary.lastKnownMessageId,
            ) > 0
          ) {
            summary.lastKnownTime = sourceCreateTime
            summary.lastKnownMessageId = messageId
          }
        }
      }
      for (let i = 0; i < submissions.length; i++) {
        const item = submissions[i]
        if (!item) continue
        const previous = previousSubmissions[i]
        if (
          previous &&
          (previous.ownerType !== 'message' ||
            previous.ownerKey !== item.ownerKey ||
            previous.kind !== 'submission-selection' ||
            typeof previous.payload.conflicted !== 'boolean')
        )
          throw new Error('archive.error.sourceChanged')
        if (previous?.payload.conflicted === true) continue
        const old = previous?.payload.selection as ConversationSubmissionSelection | undefined
        if (old) this.sourceGate.inspectSubmissionSelection(detail.conversationId, old)
        if (old && !item.conflicted && sameSubmissionSelection(old, item.selection)) continue
        metadata.put({
          key: key(item.ownerKey, 'submission-selection'),
          ownerType: 'message',
          ownerKey: item.ownerKey,
          kind: 'submission-selection',
          observedAt,
          payload: previous
            ? { selection: old, conflictingSelection: item.selection, conflicted: true }
            : { selection: item.selection, conflicted: item.conflicted },
        } satisfies ArchiveV4Metadata)
        submissionChanged = true
      }
      if (projectKey && projectId && !previousProject) {
        projects.put({
          key: projectKey,
          projectId,
          accountId,
          title: null,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
        } satisfies ArchiveV4Project)
      }
      const pageInfo = sourceObject(detail.payload.page_info)
      const nextPayload: Source = {
        nativeContractVersion: this.sourceGate.version,
        sourceFingerprint: pageFingerprint,
        nativeEnvelope,
        messageIds: messages.map((item) => item.raw.id),
        observedSourceRecordCount: received.length,
        observedUniqueRecordCount: seen.size,
        storedRecordCount: messages.length,
        omittedRecordCount: seen.size - messages.length,
        staleRecordCount,
        readId: detail.readId,
        readStartedAt,
        isInitial: detail.isInitial === true,
        requestedBefore: detail.requestedBefore ?? null,
        startCursor: pageInfo.start_cursor ?? null,
        endCursor: pageInfo.end_cursor ?? null,
        hasPreviousPage: pageInfo.has_previous_page ?? null,
        hasNextPage: pageInfo.has_next_page ?? null,
      }
      const pageChanged =
        !previousPage ||
        canonicalSourceJson(previousPage.payload) !== canonicalSourceJson(nextPayload)
      const summaryChanged =
        !previousConversation ||
        canonicalSourceJson({
          projectId: summary.projectId,
          title: summary.title,
          currentNodeId: summary.currentNodeId,
          headReadId: summary.headReadId ?? null,
          headReadStartedAt: summary.headReadStartedAt ?? null,
          latestReadId: summary.latestReadId ?? null,
          latestReadStartedAt: summary.latestReadStartedAt ?? null,
          latestReadConflicted: summary.latestReadConflicted ?? false,
        }) !==
          canonicalSourceJson({
            projectId: previousConversation.projectId,
            title: previousConversation.title,
            currentNodeId: previousConversation.currentNodeId,
            headReadId: previousConversation.headReadId ?? null,
            headReadStartedAt: previousConversation.headReadStartedAt ?? null,
            latestReadId: previousConversation.latestReadId ?? null,
            latestReadStartedAt: previousConversation.latestReadStartedAt ?? null,
            latestReadConflicted: previousConversation.latestReadConflicted ?? false,
          })
      const mutated =
        inserted > 0 || changed > 0 || submissionChanged || pageChanged || summaryChanged
      if (pageChanged)
        metadata.put({
          key: pageKey,
          ownerType: 'conversation',
          ownerKey: conversationKey,
          kind: 'history-page',
          observedAt,
          payload: nextPayload,
        } satisfies ArchiveV4Metadata)
      if (mutated) {
        summary.verifiedPathRootId = null
        summary.verifiedPathTipId = null
        summary.verifiedPathReadId = null
        summary.verifiedPathRevision = null
        summary.revision++
        summary.lastSeenAt = Math.max(summary.lastSeenAt, observedAt)
        conversations.put(summary)
      }
      if (!allowed()) {
        tx.abort()
        await done.catch(() => undefined)
        return undefined
      }
      this.sourceGate.assertCompatible(detail.conversationId)
      await done
      if (mutated)
        this.#emit({
          kind: 'conversation',
          accountId,
          conversationId: detail.conversationId,
          revision: summary.revision,
        })
      return allowed()
        ? {
            mutated,
            conversationKey,
            inserted,
            changed,
            unchanged,
            totalMessages: summary.knownMessageCount,
            revision: summary.revision,
          }
        : undefined
    } catch (cause) {
      try {
        tx.abort()
      } catch {
        /* Already settled. */
      }
      await done.catch(() => undefined)
      if (!allowed()) return undefined
      throw cause
    } finally {
      detach()
    }
  }

  /** Update only already archived headers; a sidebar catalog does not grant capture consent. */
  async applyCatalog(
    detail: ConversationCatalogEventDetail,
    accountId: string,
    stillAuthorized: () => boolean,
    write: ArchiveV4WriteOptions = {},
  ): Promise<void> {
    const allowed = () => archiveWriteAllowed(write.signal, stillAuthorized)
    if (!allowed()) return
    if (detail.accountId !== accountId) throw new Error('archive.error.auth')
    const input = structuredClone(detail)
    const startedAt = input.requestStartedAt ?? input.observedAt
    if (!Number.isFinite(startedAt) || !Number.isFinite(input.observedAt))
      throw new Error('archive.error.sourceChanged')
    const items = new Map<string, ConversationCatalogEventDetail['items'][number]>()
    for (const item of input.items) {
      identity(item.conversationId, 'conversationId')
      if (
        (item.title != null && typeof item.title !== 'string') ||
        (item.projectId !== null && typeof item.projectId !== 'string') ||
        (item.projectKnown !== undefined && typeof item.projectKnown !== 'boolean')
      )
        throw new Error('archive.error.sourceChanged')
      this.sourceGate.assertCompatible(item.conversationId)
      const previous = items.get(item.conversationId)
      if (previous && canonicalSourceJson(previous) !== canonicalSourceJson(item))
        throw new Error('archive.error.sourceChanged')
      items.set(item.conversationId, item)
    }
    const ticket = write.ticket ?? (await this.acquireWriteTicket(accountId))
    if (ticket.accountId !== accountId) throw new Error('archive.error.auth')
    const db = await this.#db()
    if (!allowed()) return
    const tx = db.transaction(['projects', 'conversations', 'metadata'], 'readwrite')
    const done = settled(tx)
    const detach = guardArchiveTransaction(tx, write.signal)
    const changes: ArchiveV4Change[] = []
    try {
      const conversations = tx.objectStore('conversations')
      const projects = tx.objectStore('projects')
      const [generation, stored] = await Promise.all([
        req<ArchiveV4Metadata | undefined>(
          tx.objectStore('metadata').get(key(key(accountId), 'write-generation')),
        ),
        Promise.all(
          [...items.keys()].map((id) =>
            req<ArchiveV4Conversation | undefined>(conversations.get(key(accountId, id))),
          ),
        ),
      ])
      if (!allowed() || !this.#ticketMatches(ticket, generation)) {
        tx.abort()
        await done.catch(() => undefined)
        return
      }
      for (const previous of stored) {
        if (!previous) continue
        if (previous.accountId !== accountId) throw new Error('archive.error.auth')
        const item = items.get(previous.conversationId)
        if (!item) throw new Error('archive.error.sourceChanged')
        this.sourceGate.assertCompatible(item.conversationId)
        if (
          startedAt <
          Math.max(
            previous.catalogReadStartedAt ?? -Infinity,
            previous.headReadStartedAt ?? -Infinity,
          )
        )
          continue
        const projectId =
          item.projectKnown === true ? item.projectId : (item.projectId ?? previous.projectId)
        const title =
          typeof item.title === 'string' && item.title.trim() ? item.title : previous.title
        const changed = projectId !== previous.projectId || title !== previous.title
        if (projectId) {
          const projectKey = key(accountId, projectId)
          const project = await req<ArchiveV4Project | undefined>(projects.get(projectKey))
          if (!project)
            projects.put({
              key: projectKey,
              projectId,
              accountId,
              title: null,
              firstSeenAt: input.observedAt,
              lastSeenAt: input.observedAt,
            } satisfies ArchiveV4Project)
          else if (project.accountId !== accountId) throw new Error('archive.error.auth')
        }
        if (changed || startedAt > (previous.catalogReadStartedAt ?? -Infinity)) {
          conversations.put({
            ...previous,
            projectId,
            title,
            catalogReadStartedAt: startedAt,
            ...(changed
              ? {
                  revision: previous.revision + 1,
                  lastSeenAt: Math.max(previous.lastSeenAt, input.observedAt),
                  verifiedPathRootId: null,
                  verifiedPathTipId: null,
                  verifiedPathReadId: null,
                  verifiedPathRevision: null,
                }
              : {}),
          } satisfies ArchiveV4Conversation)
        }
        if (changed)
          changes.push({
            kind: 'conversation',
            accountId,
            conversationId: previous.conversationId,
            revision: previous.revision + 1,
          })
      }
      if (!allowed()) throw new DOMException('Catalog write revoked', 'AbortError')
      await done
      for (const change of changes) this.#emit(change)
    } catch (cause) {
      try {
        tx.abort()
      } catch {
        /* Already settled. */
      }
      await done.catch(() => undefined)
      if (allowed()) throw cause
    } finally {
      detach()
    }
  }

  /** Project observations share the same revocable account write barrier as pages. */
  async upsertProject(
    accountId: string,
    projectId: string,
    title: string | null,
    observedAt: number,
    stillAuthorized: () => boolean = () => true,
    write: ArchiveV4WriteOptions = {},
  ): Promise<void> {
    const pk = key(identity(accountId, 'accountId'), identity(projectId, 'projectId'))
    const allowed = () => archiveWriteAllowed(write.signal, stillAuthorized)
    if (!allowed()) return
    if (!Number.isFinite(observedAt)) throw new Error('Invalid project observation time')
    const ticket = write.ticket ?? (await this.acquireWriteTicket(accountId))
    if (ticket.accountId !== accountId) throw new Error('archive.error.auth')
    const db = await this.#db()
    if (!allowed()) return
    const tx = db.transaction(['projects', 'metadata'], 'readwrite')
    const done = settled(tx)
    const detach = guardArchiveTransaction(tx, write.signal)
    try {
      const store = tx.objectStore('projects')
      const [previous, generation] = await Promise.all([
        req<ArchiveV4Project | undefined>(store.get(pk)),
        req<ArchiveV4Metadata | undefined>(
          tx.objectStore('metadata').get(key(key(accountId), 'write-generation')),
        ),
      ])
      if (!allowed() || !this.#ticketMatches(ticket, generation)) {
        tx.abort()
        await done.catch(() => undefined)
        return
      }
      if (previous && (previous.accountId !== accountId || previous.projectId !== projectId))
        throw new Error('archive.error.auth')
      if (previous && observedAt < previous.lastSeenAt) {
        await done
        return
      }
      const nextTitle =
        typeof title === 'string' && title.trim() ? title : (previous?.title ?? null)
      if (!previous || nextTitle !== previous.title || observedAt > previous.lastSeenAt)
        store.put({
          key: pk,
          accountId,
          projectId,
          title: nextTitle,
          firstSeenAt: previous?.firstSeenAt ?? observedAt,
          lastSeenAt: observedAt,
        } satisfies ArchiveV4Project)
      if (!allowed()) {
        tx.abort()
        await done.catch(() => undefined)
        return
      }
      await done
      if (!previous || nextTitle !== previous.title)
        this.#emit({ kind: 'project', accountId, projectId })
    } catch (cause) {
      try {
        tx.abort()
      } catch {
        /* Already settled. */
      }
      await done.catch(() => undefined)
      if (allowed()) throw cause
    } finally {
      detach()
    }
  }

  async listProjects(accountId: string): Promise<ArchiveV4Project[]> {
    const db = await this.#db()
    const tx = db.transaction('projects', 'readonly')
    return req<ArchiveV4Project[]>(
      tx.objectStore('projects').index('byAccount').getAll(identity(accountId, 'accountId')),
    )
  }

  /** Explicit account-scoped cleanup; never deletes other accounts or the v3 DB. */
  async clearAccount(
    accountId: string,
    stillAuthorized: () => boolean = () => true,
    signal?: AbortSignal,
  ): Promise<void> {
    const owner = identity(accountId, 'accountId')
    const allowed = () => archiveWriteAllowed(signal, stillAuthorized)
    if (!allowed()) throw new DOMException('Archive cleanup cancelled', 'AbortError')
    this.#writeEpochs.set(owner, (this.#writeEpochs.get(owner) ?? 0) + 1)
    const db = await this.#db()
    if (!allowed()) throw new DOMException('Archive cleanup cancelled', 'AbortError')
    const tx = db.transaction(['projects', 'conversations', 'messages', 'metadata'], 'readwrite')
    const done = settled(tx)
    const detach = guardArchiveTransaction(tx, signal)
    const projects = tx.objectStore('projects')
    const conversations = tx.objectStore('conversations')
    const messages = tx.objectStore('messages')
    const metadata = tx.objectStore('metadata')
    try {
      // Delete by indexed primary-key cursors instead of getAllKeys(). A large
      // account never materializes all Message/Metadata keys in browser RAM.
      // All traversals and the durable generation marker share ONE transaction.
      await new Promise<void>((resolve, reject) => {
        let failed = false
        const fail = (cause: unknown) => {
          if (failed) return
          failed = true
          reject(cause)
          try {
            tx.abort()
          } catch {
            /* A revoked transaction may be closed. */
          }
        }
        tx.addEventListener(
          'abort',
          () =>
            fail(
              signal?.aborted
                ? new DOMException('Archive cleanup cancelled', 'AbortError')
                : (tx.error ?? new Error('Archive cleanup transaction aborted')),
            ),
          { once: true },
        )
        const check = () => {
          if (!allowed()) {
            fail(new DOMException('Archive cleanup cancelled', 'AbortError'))
            return false
          }
          return true
        }
        // The next request is scheduled synchronously in onsuccess: the IDB
        // transaction cannot auto-commit between nested scans.
        const erase = (
          store: IDBObjectStore,
          indexName: string,
          indexedKey: IDBValidKey,
          beforeDelete: (primaryKey: IDBValidKey, resume: () => void) => void,
          complete: () => void,
        ) => {
          if (!check()) return
          try {
            const request = store.index(indexName).openKeyCursor(IDBKeyRange.only(indexedKey))
            request.onerror = () =>
              fail(request.error ?? new Error('Archive cleanup cursor failed'))
            request.onsuccess = () => {
              if (failed || !check()) return
              const cursor = request.result
              if (!cursor) {
                try {
                  complete()
                } catch (cause) {
                  fail(cause)
                }
                return
              }
              try {
                beforeDelete(cursor.primaryKey, () => {
                  if (failed || !check()) return
                  try {
                    // Key-only cursor has no deletable value: delete through
                    // the owning store, then synchronously queue the next key.
                    store.delete(cursor.primaryKey)
                    cursor.continue()
                  } catch (cause) {
                    fail(cause)
                  }
                })
              } catch (cause) {
                fail(cause)
              }
            }
          } catch (cause) {
            fail(cause)
          }
        }
        const eraseOwnedMetadata = (ownerKey: IDBValidKey, complete: () => void) =>
          erase(metadata, 'byOwner', ownerKey, (_key, resume) => resume(), complete)
        const eraseMessages = (conversationKey: IDBValidKey, complete: () => void) =>
          erase(
            messages,
            'byConversation',
            conversationKey,
            (messageKey, resume) => eraseOwnedMetadata(messageKey, resume),
            complete,
          )
        const eraseConversations = (complete: () => void) =>
          erase(
            conversations,
            'byAccount',
            owner,
            (conversationKey, resume) =>
              eraseMessages(conversationKey, () => eraseOwnedMetadata(conversationKey, resume)),
            complete,
          )
        const eraseProjects = (complete: () => void) =>
          erase(
            projects,
            'byAccount',
            owner,
            (projectKey, resume) => eraseOwnedMetadata(projectKey, resume),
            complete,
          )
        eraseProjects(() =>
          eraseConversations(() => {
            if (!check()) return
            // This marker invalidates tickets from other tabs issued before
            // deletion. It is committed atomically with every removed key.
            metadata.put({
              key: key(key(owner), 'write-generation'),
              ownerType: 'account',
              ownerKey: key(owner),
              kind: 'write-generation',
              observedAt: Date.now(),
              payload: { generation: crypto.randomUUID() },
            } satisfies ArchiveV4Metadata)
            resolve()
          }),
        )
      })
      if (!allowed()) throw new DOMException('Archive cleanup cancelled', 'AbortError')
      await done
      this.#emit({ kind: 'cleared', accountId: owner })
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // A failed transaction is already aborted.
      }
      await done.catch(() => undefined)
      throw error
    } finally {
      detach()
    }
  }

  async getProject(accountId: string, projectId: string) {
    const db = await this.#db()
    const tx = db.transaction('projects', 'readonly')
    return req<ArchiveV4Project | undefined>(
      tx
        .objectStore('projects')
        .get(key(identity(accountId, 'accountId'), identity(projectId, 'projectId'))),
    )
  }

  async getConversation(accountId: string, conversationId: string) {
    const db = await this.#db()
    const tx = db.transaction('conversations', 'readonly')
    return req<ArchiveV4Conversation | undefined>(
      tx
        .objectStore('conversations')
        .get(key(identity(accountId, 'accountId'), identity(conversationId, 'conversationId'))),
    )
  }

  async listConversations(accountId: string) {
    const db = await this.#db()
    const tx = db.transaction('conversations', 'readonly')
    return req<ArchiveV4Conversation[]>(
      tx.objectStore('conversations').index('byAccount').getAll(identity(accountId, 'accountId')),
    )
  }

  async getMessage(accountId: string, conversationId: string, messageId: string) {
    const db = await this.#db()
    const tx = db.transaction('messages', 'readonly')
    return req<ArchiveV4Message | undefined>(
      tx
        .objectStore('messages')
        .get(
          key(
            key(identity(accountId, 'accountId'), identity(conversationId, 'conversationId')),
            identity(messageId, 'messageId'),
          ),
        ),
    )
  }

  /** Evidence is stored only once its native user message belongs to this archive. */
  async getMessageSubmission(
    accountId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ArchiveV4SubmissionEvidence> {
    const ownerKey = key(
      key(identity(accountId, 'accountId'), identity(conversationId, 'conversationId')),
      identity(messageId, 'messageId'),
    )
    this.sourceGate.assertCompatible(conversationId)
    const db = await this.#db()
    const value = await req<ArchiveV4Metadata | undefined>(
      db
        .transaction('metadata', 'readonly')
        .objectStore('metadata')
        .get(key(ownerKey, 'submission-selection')),
    )
    if (!value) return { status: 'unobserved', selection: null }
    if (
      value.ownerKey !== ownerKey ||
      value.ownerType !== 'message' ||
      value.kind !== 'submission-selection'
    )
      throw new Error('archive.error.auth')
    if (typeof value.payload.conflicted !== 'boolean')
      throw new Error('archive.error.sourceChanged')
    if (value.payload.conflicted === true) return { status: 'conflicted', selection: null }
    const selection = value.payload.selection as ConversationSubmissionSelection
    this.sourceGate.inspectSubmissionSelection(conversationId, selection)
    if (selection.messageId !== messageId) throw new Error('archive.error.sourceChanged')
    return { status: 'observed', selection: { ...selection } }
  }

  /**
   * Return bounded account-scoped revision facts without exporting previous raw.
   * Checkpoints from earlier local v4 builds retained message-snapshot raw but
   * not companion revision-evidence rows. Read old snapshots only when compact
   * evidence cannot establish the start of this message's revision chain.
   */
  async getMessageRevisionEvidence(
    accountId: string,
    conversationId: string,
    messageId: string,
    limit = 64,
  ): Promise<ArchiveV4SourceRevisionWindow> {
    const ownerKey = key(
      key(identity(accountId, 'accountId'), identity(conversationId, 'conversationId')),
      identity(messageId, 'messageId'),
    )
    const maximum = Number.isFinite(limit) ? Math.max(1, Math.min(128, Math.floor(limit))) : 64
    const db = await this.#db()
    const previous = new Map<number, ArchiveV4SourceRevisionEvidence>()
    let olderRevisionsOmitted = false
    const add = (
      metadata: ArchiveV4Metadata,
      kind: 'message-revision-evidence' | 'message-snapshot',
    ) => {
      const revision = metadata.payload?.revision
      if (
        metadata.ownerKey !== ownerKey ||
        metadata.ownerType !== 'message' ||
        metadata.kind !== kind ||
        typeof revision !== 'number' ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        !Number.isFinite(metadata.observedAt)
      )
        throw new Error('archive.error.sourceChanged')
      if (previous.has(revision)) return
      previous.set(revision, {
        previousRevision: revision,
        previousLastSeenAtMs: metadata.observedAt,
        sourceReadId:
          typeof metadata.payload.sourceReadId === 'string' ? metadata.payload.sourceReadId : null,
        sourceReadStartedAtMs:
          typeof metadata.payload.sourceReadStartedAt === 'number' &&
          Number.isFinite(metadata.payload.sourceReadStartedAt)
            ? metadata.payload.sourceReadStartedAt
            : null,
      })
      if (previous.size > maximum) {
        const oldest = Math.min(...previous.keys())
        previous.delete(oldest)
        olderRevisionsOmitted = true
      }
    }
    const scan = (kind: 'message-revision-evidence' | 'message-snapshot', olderThan?: number) => {
      // Separate readonly transactions: a cursor's final onsuccess may allow
      // auto-commit before a second async cursor is scheduled.
      const tx = db.transaction('metadata', 'readonly')
      return new Promise<void>((resolve, reject) => {
        let finished = false
        const fail = (cause: unknown) => {
          if (finished) return
          finished = true
          try {
            tx.abort()
          } catch {
            /* Already settled. */
          }
          reject(cause)
        }
        const cursor = tx
          .objectStore('metadata')
          .index('byKind')
          .openCursor(IDBKeyRange.only([ownerKey, kind]))
        cursor.onerror = () => fail(cursor.error ?? new Error('Archive revision cursor failed'))
        tx.onabort = () => fail(tx.error ?? new Error('Archive revision scan aborted'))
        cursor.onsuccess = () => {
          if (finished) return
          const current = cursor.result
          if (!current) {
            finished = true
            resolve()
            return
          }
          try {
            const metadata = current.value as ArchiveV4Metadata
            const revision = metadata.payload?.revision
            if (
              typeof revision !== 'number' ||
              !Number.isSafeInteger(revision) ||
              revision < 1 ||
              metadata.ownerKey !== ownerKey ||
              metadata.ownerType !== 'message' ||
              metadata.kind !== kind
            )
              throw new Error('archive.error.sourceChanged')
            if (olderThan === undefined || revision < olderThan) add(metadata, kind)
            current.continue()
          } catch (cause) {
            fail(cause)
          }
        }
      })
    }
    await scan('message-revision-evidence')
    const earliestCompact = Math.min(...previous.keys())
    if (!olderRevisionsOmitted && (!Number.isFinite(earliestCompact) || earliestCompact > 1))
      await scan('message-snapshot', Number.isFinite(earliestCompact) ? earliestCompact : undefined)
    const sorted = [...previous.values()].sort(
      (left, right) => left.previousRevision - right.previousRevision,
    )
    // Do not report an incomplete snapshot history as a verified contiguous
    // list merely because a newer compact revision exists.
    if (sorted.length && !olderRevisionsOmitted && sorted[0]?.previousRevision !== 1)
      throw new Error('archive.error.sourceChanged')
    for (let i = 1; i < sorted.length; i++)
      if (sorted[i]?.previousRevision !== (sorted[i - 1]?.previousRevision ?? -1) + 1)
        throw new Error('archive.error.sourceChanged')
    return { previous: sorted, olderRevisionsOmitted }
  }

  /**
   * Indexed chronological window. Native messages with null create_time are
   * retained but unsequenced and deliberately excluded from this index.
   * Check Conversation.unsequencedMessageCount before claiming a complete path.
   */
  async readWindow(
    accountId: string,
    conversationId: string,
    limit = 40,
    direction: 'newest' | 'oldest' = 'newest',
    fromExclusive?: Pick<ArchiveV4Message, 'sourceCreateTime' | 'messageId'>,
    signal?: AbortSignal,
  ): Promise<ArchiveV4Message[]> {
    const conversationKey = key(
      identity(accountId, 'accountId'),
      identity(conversationId, 'conversationId'),
    )
    if (signal?.aborted) throw new DOMException('Archive window cancelled', 'AbortError')
    const db = await this.#db()
    if (signal?.aborted) throw new DOMException('Archive window cancelled', 'AbortError')
    const tx = db.transaction('messages', 'readonly')
    const index = tx.objectStore('messages').index('byChronology')
    if (
      fromExclusive &&
      (fromExclusive.sourceCreateTime === null || !Number.isFinite(fromExclusive.sourceCreateTime))
    )
      throw new Error('Chronological cursor requires a verified numeric source time')
    const range = fromExclusive
      ? direction === 'newest'
        ? IDBKeyRange.bound(
            [conversationKey],
            [conversationKey, fromExclusive.sourceCreateTime, fromExclusive.messageId],
            false,
            true,
          )
        : IDBKeyRange.bound(
            [conversationKey, fromExclusive.sourceCreateTime, fromExclusive.messageId],
            [conversationKey, []],
            true,
            false,
          )
      : IDBKeyRange.bound([conversationKey], [conversationKey, []])
    const amount = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 40
    return new Promise((resolve, reject) => {
      const rows: ArchiveV4Message[] = []
      const detach = () => signal?.removeEventListener('abort', abort)
      const abort = () => {
        detach()
        try {
          tx.abort()
        } catch {
          /* A completed read needs no cancellation. */
        }
        reject(new DOMException('Archive window cancelled', 'AbortError'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      tx.onabort = () => {
        detach()
        reject(
          signal?.aborted
            ? new DOMException('Archive window cancelled', 'AbortError')
            : (tx.error ?? new Error('Archive index read aborted')),
        )
      }
      tx.oncomplete = () => {
        detach()
        resolve(rows)
      }
      const cursor = index.openCursor(range, direction === 'newest' ? 'prev' : 'next')
      cursor.onerror = () => {
        detach()
        reject(cursor.error ?? new Error('Archive index read failed'))
      }
      cursor.onsuccess = () => {
        const current = cursor.result
        if (!current || rows.length >= amount || signal?.aborted) return
        rows.push(current.value as ArchiveV4Message)
        if (rows.length < amount) current.continue()
      }
      if (signal?.aborted) abort()
    })
  }

  /** One point lookup and two bounded index cursors inside the same readonly snapshot. */
  async readMessageWindow(
    accountId: string,
    conversationId: string,
    messageId: string,
    radius = 20,
    signal?: AbortSignal,
  ) {
    const owner = identity(accountId, 'accountId')
    const id = identity(conversationId, 'conversationId')
    const sourceId = identity(messageId, 'messageId')
    const scoped = key(owner, id)
    const amount = Number.isFinite(radius) ? Math.max(1, Math.min(60, Math.floor(radius))) : 20
    if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
    const db = await this.#db()
    if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
    const tx = db.transaction(['conversations', 'messages'], 'readonly')
    const done = settled(tx)
    // Abort can happen while a cursor promise is still pending.
    void done.catch(() => undefined)
    const abort = () => {
      try {
        tx.abort()
      } catch {
        /* Already settled. */
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const store = tx.objectStore('messages')
      const [conversation, target] = await Promise.all([
        req<ArchiveV4Conversation | undefined>(tx.objectStore('conversations').get(scoped)),
        req<ArchiveV4Message | undefined>(store.get(key(scoped, sourceId))),
      ])
      if (!conversation || !target) throw new Error('archive.error.messageMissing')
      if (
        conversation.accountId !== owner ||
        conversation.conversationId !== id ||
        target.conversationKey !== scoped ||
        target.messageId !== sourceId
      )
        throw new Error('archive.error.auth')
      if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
      const point = target.sourceCreateTime
      if (point === null) {
        await done
        return {
          conversation,
          target,
          messages: [target],
          hasOlder: false,
          hasNewer: false,
          unsequencedTarget: true,
        }
      }
      if (!Number.isFinite(point)) throw new Error('archive.error.incompatibleSource')
      const index = store.index('byChronology')
      const anchor = [scoped, point, sourceId]
      const neighbors = (direction: 'prev' | 'next') =>
        new Promise<ArchiveV4Message[]>((resolve, reject) => {
          const rows: ArchiveV4Message[] = []
          const onAbort = () =>
            reject(
              signal?.aborted
                ? new DOMException('Archive navigation cancelled', 'AbortError')
                : (tx.error ?? new Error('Archive navigation aborted')),
            )
          tx.addEventListener('abort', onAbort, { once: true })
          const range =
            direction === 'prev'
              ? IDBKeyRange.bound([scoped], anchor, false, true)
              : IDBKeyRange.bound(anchor, [scoped, []], true, false)
          const cursor = index.openCursor(range, direction)
          cursor.onerror = () =>
            reject(cursor.error ?? new Error('Archive navigation cursor failed'))
          cursor.onsuccess = () => {
            const current = cursor.result
            if (!current) {
              resolve(rows)
              return
            }
            rows.push(current.value as ArchiveV4Message)
            if (rows.length >= amount + 1) resolve(rows)
            else current.continue()
          }
        })
      const [older, newer] = await Promise.all([neighbors('prev'), neighbors('next')])
      await done
      if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
      return {
        conversation,
        target,
        messages: [...older.slice(0, amount).reverse(), target, ...newer.slice(0, amount)],
        hasOlder: older.length > amount,
        hasNewer: newer.length > amount,
        unsequencedTarget: false,
      }
    } catch (cause) {
      abort()
      await done.catch(() => undefined)
      if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
      throw cause
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  /** No ancestry traversal or message bodies: correlate only one stable saved revision. */
  async getExportEvidence(accountId: string, conversationId: string, signal?: AbortSignal) {
    const assertActive = () => {
      if (signal?.aborted) throw new DOMException('Export inspection cancelled', 'AbortError')
    }
    assertActive()
    const initial = await this.getConversation(accountId, conversationId)
    assertActive()
    // Read continuity and capture-category omissions from the SAME readonly
    // Metadata traversal. Two independent scans could observe different
    // transactions despite an unchanged saved Conversation header.
    const evidence = initial ? await this.readHistoryEvidence(accountId, conversationId) : undefined
    assertActive()
    const pages = evidence?.pages ?? historyCoverage([])
    const captureCoverage = evidence && pages.readId ? evidence.captureFor(pages.readId) : 'unknown'
    assertActive()
    const conversation = await this.getConversation(accountId, conversationId)
    assertActive()
    if (
      initial?.revision !== conversation?.revision ||
      initial?.currentNodeId !== conversation?.currentNodeId ||
      initial?.headReadId !== conversation?.headReadId ||
      initial?.instanceId !== conversation?.instanceId
    )
      throw new Error('archive.error.sourceChanged')
    const headReadMatches =
      !!conversation?.headReadId &&
      !!pages.readId &&
      conversation.headReadId === pages.readId &&
      !conversation.latestReadConflicted &&
      (!conversation.latestReadId || conversation.latestReadId === pages.readId)
    const pathVerified =
      !!conversation &&
      headReadMatches &&
      pages.verified &&
      captureCoverage === 'complete' &&
      pages.readId !== null &&
      conversation.verifiedPathReadId === pages.readId &&
      conversation.verifiedPathRevision === conversation.revision &&
      !!conversation.verifiedPathRootId &&
      !!conversation.verifiedPathTipId &&
      conversation.verifiedPathTipId === conversation.currentNodeId
    return { conversation, pages, captureCoverage, pathVerified, headReadMatches }
  }

  /** Bounded first/last preview without scanning or mounting the conversation. */
  async readPreview(
    accountId: string,
    conversationId: string,
    edgeSize = 3,
  ): Promise<ArchiveV4Preview> {
    const size = Number.isFinite(edgeSize) ? Math.max(1, Math.min(3, Math.floor(edgeSize))) : 3
    const [conversation, earliest, latest] = await Promise.all([
      this.getConversation(accountId, conversationId),
      this.readWindow(accountId, conversationId, size, 'oldest'),
      this.readWindow(accountId, conversationId, size, 'newest'),
    ])
    const current = await this.getConversation(accountId, conversationId)
    if (
      current?.revision !== conversation?.revision ||
      current?.currentNodeId !== conversation?.currentNodeId ||
      current?.projectId !== conversation?.projectId ||
      (current?.instanceId ?? null) !== (conversation?.instanceId ?? null)
    )
      throw new Error('archive.error.sourceChanged')
    const unique = new Set([...earliest, ...latest].map((message) => message.messageId))
    return {
      conversation,
      earliest,
      latest: [...latest].reverse(),
      hiddenKnownCount: Math.max(0, (conversation?.knownMessageCount ?? 0) - unique.size),
      hasUnsequencedMessages: (conversation?.unsequencedMessageCount ?? 0) > 0,
    }
  }

  /**
   * Verify exactly one selected native path. No chronological fallback, synthetic
   * ancestry, or blanket "complete" assertion on partially observed pages.
   * This read is for explicit prepare/export, not ordinary conversation listing.
   */
  private async selectedPathPreflight(
    accountId: string,
    conversationId: string,
    selectedTipId: string,
  ): Promise<ArchiveV4PathIndex> {
    identity(selectedTipId, 'selectedTipId')
    const evidence = await this.getExportEvidence(accountId, conversationId)
    const conversation = evidence.conversation
    const result: ArchiveV4PathIndex = {
      status: 'conversation_missing',
      messageIds: [],
      rootId: null,
      selectedTipId,
      coverageReadId: null,
      conversationRevision: conversation?.revision ?? null,
      conversationInstanceId: conversation?.instanceId ?? null,
    }
    if (!conversation) return result
    if (conversation.currentNodeId !== selectedTipId) {
      result.status = 'head_mismatch'
      return result
    }
    const coverage = evidence.pages
    result.coverageReadId = coverage.readId
    if (!evidence.headReadMatches) {
      result.status = 'source_changed'
      return result
    }
    if (!coverage.verified) {
      result.status = 'pagination_incomplete'
      return result
    }
    if (evidence.captureCoverage !== 'complete') {
      result.status = 'capture_omissions'
      return result
    }
    result.status = 'verified'
    return result
  }

  private async sourceStillMatches(
    accountId: string,
    conversationId: string,
    selectedTipId: string,
    revision: number | null,
    instanceId: string | null,
  ): Promise<boolean> {
    const latest = await this.getConversation(accountId, conversationId)
    return (
      !!latest &&
      latest.revision === revision &&
      latest.currentNodeId === selectedTipId &&
      (latest.instanceId ?? null) === instanceId
    )
  }

  /** One verified selected lineage with source-original objects in memory. */
  async readSelectedPath(
    accountId: string,
    conversationId: string,
    selectedTipId: string,
    maxDepth = 50_000,
    signal?: AbortSignal,
  ): Promise<ArchiveV4PathResult> {
    const preflight = await this.selectedPathPreflight(accountId, conversationId, selectedTipId)
    const { messageIds: _ids, ...result } = preflight
    void _ids
    if (result.status !== 'verified') return { ...result, messages: [] }
    const trace = await traceArchiveV4Path(
      selectedTipId,
      (messageId) => this.getMessage(accountId, conversationId, messageId),
      maxDepth,
      signal,
    )
    if (
      !(await this.sourceStillMatches(
        accountId,
        conversationId,
        selectedTipId,
        result.conversationRevision,
        result.conversationInstanceId ?? null,
      ))
    ) {
      return { ...result, status: 'source_changed', messages: [], rootId: null }
    }
    return { ...result, ...trace }
  }

  /** Persist only the exact verified root/tip for a stable native read. */
  private async saveVerifiedPath(
    accountId: string,
    conversationId: string,
    selectedTipId: string,
    rootId: string,
    readId: string,
    revision: number,
    instanceId: string | null,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted) throw new DOMException('Path checkpoint cancelled', 'AbortError')
    const db = await this.#db()
    const tx = db.transaction('conversations', 'readwrite')
    const done = settled(tx)
    const detach = guardArchiveTransaction(tx, signal)
    try {
      const store = tx.objectStore('conversations')
      const previous = await req<ArchiveV4Conversation | undefined>(
        store.get(key(accountId, conversationId)),
      )
      if (signal?.aborted) {
        tx.abort()
        await done.catch(() => undefined)
        throw new DOMException('Path checkpoint cancelled', 'AbortError')
      }
      if (
        !previous ||
        previous.accountId !== accountId ||
        previous.conversationId !== conversationId ||
        previous.revision !== revision ||
        previous.currentNodeId !== selectedTipId ||
        (previous.instanceId ?? null) !== instanceId ||
        previous.latestReadConflicted === true ||
        (previous.latestReadId && previous.latestReadId !== readId)
      ) {
        tx.abort()
        await done.catch(() => undefined)
        return false
      }
      if (
        previous.verifiedPathRootId !== rootId ||
        previous.verifiedPathTipId !== selectedTipId ||
        previous.verifiedPathReadId !== readId ||
        previous.verifiedPathRevision !== revision
      ) {
        store.put({
          ...previous,
          verifiedPathRootId: rootId,
          verifiedPathTipId: selectedTipId,
          verifiedPathReadId: readId,
          verifiedPathRevision: revision,
        } satisfies ArchiveV4Conversation)
      }
      await done
      return true
    } catch (cause) {
      try {
        tx.abort()
      } catch {
        /* transaction already finished */
      }
      await done.catch(() => undefined)
      throw cause
    } finally {
      detach()
    }
  }

  /** Two-pass technical export uses this index, then retrieves each raw record on demand. */
  async readSelectedPathIndex(
    accountId: string,
    conversationId: string,
    selectedTipId: string,
    maxDepth = 50_000,
    signal?: AbortSignal,
    onVisited?: (records: number) => void,
  ): Promise<ArchiveV4PathIndex> {
    const result = await this.selectedPathPreflight(accountId, conversationId, selectedTipId)
    if (result.status !== 'verified') return result
    const trace = await traceArchiveV4PathIds(
      selectedTipId,
      (messageId) => this.getMessage(accountId, conversationId, messageId),
      maxDepth,
      signal,
      onVisited,
    )
    const stillVerified =
      trace.status === 'verified' &&
      trace.rootId &&
      result.coverageReadId !== null &&
      result.conversationRevision !== null
        ? await this.saveVerifiedPath(
            accountId,
            conversationId,
            selectedTipId,
            trace.rootId,
            result.coverageReadId,
            result.conversationRevision,
            result.conversationInstanceId ?? null,
            signal,
          )
        : await this.sourceStillMatches(
            accountId,
            conversationId,
            selectedTipId,
            result.conversationRevision,
            result.conversationInstanceId ?? null,
          )
    if (!stillVerified) {
      return { ...result, status: 'source_changed', messageIds: [], rootId: null }
    }
    return { ...result, ...trace }
  }

  /** Read one history evidence row at a time; never materialize native envelopes. */
  private async scanHistoryPages(
    accountId: string,
    conversationId: string,
    visit: (item: ArchiveV4Metadata) => boolean | void,
  ): Promise<void> {
    const ownerKey = key(
      identity(accountId, 'accountId'),
      identity(conversationId, 'conversationId'),
    )
    const db = await this.#db()
    const tx = db.transaction('metadata', 'readonly')
    await new Promise<void>((resolve, reject) => {
      const cursor = tx
        .objectStore('metadata')
        .index('byKind')
        .openCursor(IDBKeyRange.only([ownerKey, 'history-page']))
      cursor.onerror = () => reject(cursor.error ?? new Error('Archive metadata cursor failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Archive metadata cursor aborted'))
      cursor.onsuccess = () => {
        const current = cursor.result
        if (!current) return resolve()
        try {
          if (visit(current.value as ArchiveV4Metadata) === true) return resolve()
          current.continue()
        } catch (cause) {
          reject(cause)
        }
      }
    })
  }

  /** One provenance snapshot powers both native pagination and capture omissions. */
  private async readHistoryEvidence(accountId: string, conversationId: string) {
    const pages: HistoryPageEvidence[] = []
    const observations = new Set<string>()
    const omitted = new Set<string>()
    await this.scanHistoryPages(accountId, conversationId, (item) => {
      if (
        item.kind !== 'history-page' ||
        item.ownerType !== 'conversation' ||
        item.ownerKey !== key(accountId, conversationId) ||
        !Number.isFinite(item.observedAt)
      )
        throw new Error('archive.error.sourceChanged')
      const entry = item.payload
      const readId = typeof entry.readId === 'string' && entry.readId ? entry.readId : null
      if (readId) {
        observations.add(readId)
        if (
          typeof entry.omittedRecordCount !== 'number' ||
          entry.omittedRecordCount !== 0 ||
          (entry.staleRecordCount !== undefined &&
            (typeof entry.staleRecordCount !== 'number' || entry.staleRecordCount !== 0))
        )
          omitted.add(readId)
      }
      pages.push({
        readId: readId ?? undefined,
        readStartedAt:
          typeof entry.readStartedAt === 'number' && Number.isFinite(entry.readStartedAt)
            ? entry.readStartedAt
            : undefined,
        isInitial: entry.isInitial === true,
        requestedBefore: typeof entry.requestedBefore === 'string' ? entry.requestedBefore : null,
        startCursor: typeof entry.startCursor === 'string' ? entry.startCursor : null,
        endCursor: typeof entry.endCursor === 'string' ? entry.endCursor : null,
        hasPreviousPage: typeof entry.hasPreviousPage === 'boolean' ? entry.hasPreviousPage : null,
        hasNextPage: typeof entry.hasNextPage === 'boolean' ? entry.hasNextPage : null,
        observedAt: item.observedAt,
      })
    })
    const captureFor = (readId: string): 'unknown' | 'omitted' | 'complete' =>
      !observations.has(readId) ? 'unknown' : omitted.has(readId) ? 'omitted' : 'complete'
    return { pages: historyCoverage(pages), captureFor }
  }

  async getCaptureCoverage(
    accountId: string,
    conversationId: string,
    readId: string | null,
  ): Promise<'unknown' | 'omitted' | 'complete'> {
    if (!readId) return 'unknown'
    return (await this.readHistoryEvidence(accountId, conversationId)).captureFor(readId)
  }

  async getPageCoverage(accountId: string, conversationId: string) {
    return (await this.readHistoryEvidence(accountId, conversationId)).pages
  }
}
