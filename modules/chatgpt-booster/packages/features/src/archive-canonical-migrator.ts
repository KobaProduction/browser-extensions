import { exportNativeSourceBackup, importNativeSourceBackup } from './archive-source-transfer'
import { archiveCompositeKey } from '@kobaproduction/browser-archive'
import { archiveRecordText, buildArchiveThread } from '@chatgpt-booster/chatgpt'
import {
  type ArchiveRecordView,
  type CanonicalMessageProjection,
  projectNativeMessage,
} from '@chatgpt-booster/core'
import type {
  ArchiveExportPreview,
  ArchiveThreadWindow,
  ArchiveWindowCursor,
} from '@chatgpt-booster/ui'
import { exportCanonicalBackup, restoreCanonicalBackup, undoCanonicalBackupRestore } from './archive-canonical-backup'
import type { ArchiveIntegrityReport } from './archive-canonical-integrity'
import { auditCanonicalSourceIntegrity } from './archive-canonical-integrity'
import { legacyV3OwnerEvidence } from './archive-migration-plan'
import { createGzipFromBlob } from './archive-package'
import { ARCHIVE_DB_NAME } from './archive-store'
import type { ArchiveV4Store } from './archive-v4-store'
import { canonicalSourceJson, sourceFingerprint } from './archive-v4-write'
import { normalizeConversationMessage } from './conversation-records'

type Row = Record<string, unknown>
const object = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null
const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Archive migration request failed'))
  })
const finish = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Archive migration transaction aborted'))
  })
const key = archiveCompositeKey
export type CanonicalMigrationStatus =
  | 'idle'
  | 'checking'
  | 'transforming'
  | 'validating'
  | 'ready'
  | 'failed_recoverable'
  | 'waiting_for_owner'
  | 'reconciling'

export interface CanonicalMigrationProgress {
  status: CanonicalMigrationStatus
  conversations: number
  messages: number
  waitingForOwner: number
  message: string
}
export interface CanonicalStoredConversation {
  key: string
  accountId: string
  conversationId: string
  projectId: string | null
  title: string | null
  currentNodeId: string | null
  lastSeenAt: number
  source: 'legacy_v3' | 'legacy_v4'
  verifiedPagination: false
  generation: string
}
export interface CanonicalStoredMessage {
  key: string
  conversationKey: string
  accountId: string
  conversationId: string
  messageId: string
  sourceCreateTime: number | null
  sourceFingerprint: string
  source?: 'legacy_v3' | 'legacy_v4' | 'native'
  generation: string
  projection: CanonicalMessageProjection
}
/** Never write source body into canonical projection rows. */
export interface CanonicalSourceSnapshot {
  key: string
  messageKey: string
  generation: string
  fingerprint: string
  source: 'legacy_v3' | 'legacy_v4' | 'native'
  raw: Row
}

/** Read at most 128 records in one readonly transaction before yielding work.
 * Composite cursor identity must include the primary key, because every record
 * in the conversation index has the same index key. */
async function* scan(
  db: IDBDatabase,
  table: string,
  index: string,
  query: IDBValidKey,
  batchLimit = 128,
) {
  let after: IDBValidKey | null = null
  while (true) {
    const tx = db.transaction(table, 'readonly')
    const ix = tx.objectStore(table).index(index)
    const batch = await new Promise<{ rows: Row[]; last: IDBValidKey | null }>(
      (resolve, reject) => {
        const rows: Row[] = []
        let last: IDBValidKey | null = null
        let resumed = false
        const cursorRequest = ix.openCursor(IDBKeyRange.only(query))
        cursorRequest.onerror = () =>
          reject(cursorRequest.error ?? new Error('Legacy cursor failed'))
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) {
            resolve({ rows, last })
            return
          }
          if (after !== null && !resumed) {
            resumed = true
            cursor.continuePrimaryKey(query, after)
            return
          }
          // continuePrimaryKey() is inclusive of its target; the last
          // committed source row must not be counted a second time.
          if (after !== null && indexedDB.cmp(cursor.primaryKey, after) <= 0) {
            cursor.continue()
            return
          }
          const value = object(cursor.value)
          if (!value) {
            reject(new Error('Legacy source row malformed'))
            return
          }
          rows.push(value)
          last = cursor.primaryKey
          if (rows.length >= batchLimit) {
            resolve({ rows, last })
            return
          }
          cursor.continue()
        }
      },
    )
    if (!batch.rows.length) return
    for (const row of batch.rows) yield row
    if (batch.rows.length < batchLimit || batch.last === null) return
    after = batch.last
  }
}

/** A single IndexedDB transaction per bounded page, not per original message. */
async function* scanBatches(
  db: IDBDatabase,
  table: string,
  index: string,
  query: IDBValidKey,
): AsyncGenerator<Row[]> {
  let batch: Row[] = []
  for await (const row of scan(db, table, index, query)) {
    batch.push(row)
    if (batch.length === 128) {
      yield batch
      batch = []
    }
  }
  if (batch.length) yield batch
}

/** Read only rows changed since a caller-selected time. Resume by index key
 * plus primary key; duplicate timestamps must not skip or repeat records. */
async function* scanRecent(
  db: IDBDatabase,
  table: string,
  index: string,
  since: number,
  until: number,
): AsyncGenerator<Row[]> {
  let lastIndexKey: IDBValidKey | null = null
  let lastPrimaryKey: IDBValidKey | null = null
  const range = IDBKeyRange.bound(since, until)
  while (true) {
    const tx = db.transaction(table, 'readonly')
    const ix = tx.objectStore(table).index(index)
    const batch = await new Promise<{
      rows: Row[]
      indexKey: IDBValidKey | null
      primaryKey: IDBValidKey | null
    }>((resolve, reject) => {
      const rows: Row[] = []
      let indexKey: IDBValidKey | null = null
      let primaryKey: IDBValidKey | null = null
      let jumped = false
      const cursor = ix.openCursor(range)
      cursor.onerror = () => reject(cursor.error ?? new Error('Recent-source cursor failed'))
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) {
          resolve({ rows, indexKey, primaryKey })
          return
        }
        if (lastIndexKey !== null && lastPrimaryKey !== null && !jumped) {
          jumped = true
          const keyOrder = indexedDB.cmp(c.key, lastIndexKey)
          const primaryOrder = keyOrder === 0 ? indexedDB.cmp(c.primaryKey, lastPrimaryKey) : 0
          if (keyOrder < 0 || (keyOrder === 0 && primaryOrder < 0)) {
            c.continuePrimaryKey(lastIndexKey, lastPrimaryKey)
            return
          }
        }
        if (lastIndexKey !== null && lastPrimaryKey !== null) {
          const keyOrder = indexedDB.cmp(c.key, lastIndexKey)
          if (
            keyOrder < 0 ||
            (keyOrder === 0 && indexedDB.cmp(c.primaryKey, lastPrimaryKey) <= 0)
          ) {
            c.continue()
            return
          }
        }
        const v = object(c.value)
        if (!v) {
          reject(new Error('Recent-source row malformed'))
          return
        }
        rows.push(v)
        indexKey = c.key
        primaryKey = c.primaryKey
        if (rows.length === 128) resolve({ rows, indexKey, primaryKey })
        else c.continue()
      }
    })
    if (!batch.rows.length) return
    yield batch.rows
    if (batch.rows.length < 128 || batch.indexKey === null || batch.primaryKey === null) return
    lastIndexKey = batch.indexKey
    lastPrimaryKey = batch.primaryKey
  }
}

export type LegacySkipReason = 'missing_owner' | 'owner_mismatch'
export interface LegacySkippedConversation {
  readonly conversationId: string
  readonly title: string | null
  readonly reason: LegacySkipReason
  readonly messages: number
  /** Only IDs are exposed for inspection; no message text or owner identifier. */
  readonly messageIds: readonly string[]
}

export interface ArchiveOwnerSkipInspection {
  readonly examined: number
  readonly skippedMessages: number
  readonly skippedConversations: readonly LegacySkippedConversation[]
  readonly sinceMs: number
}

export interface ArchiveReconciliationReport {
  readonly sinceMs: number
  readonly effectiveSinceMs: number
  readonly checkpointApplied: boolean
  readonly examined: number
  readonly inserted: number
  readonly changed: number
  readonly unchanged: number
  readonly skippedOwnership: number
  readonly skippedConversations: readonly LegacySkippedConversation[]
  readonly conversationsTouched: number
}
export interface ArchiveCoverageAudit {
  readonly legacyConversations: number
  readonly canonicalConversations: number
  readonly conversationCountShortfall: number
  readonly conversationsWithMessageShortfall: number
  readonly sourceMessageCount: number
  readonly canonicalMessageCount: number
  /** Count comparisons do not prove message-ID, hash, page or branch identity. */
  readonly kind: 'count_only_read_only'
  readonly missingDetails: readonly {
    conversationId: string
    title: string | null
    v3Count: number
    v4Count: number
    canonicalCount: number
    ownerStatus: 'verified' | 'waiting_for_owner' | 'mismatch' | 'v4_only'
  }[]
}
async function existingSource(name: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB.databases !== 'function') throw new Error('IndexedDB inspection unavailable')
  const known = await indexedDB.databases()
  if (!known.some((x) => x.name === name)) return null
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onupgradeneeded = () => {
      req.transaction?.abort()
      reject(new Error('Legacy source was missing'))
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open legacy source'))
  })
}

/**
 * One-time consented archive conversion. Both old DBs remain untouched.
 * Stage in generation-specific records; expose only the manifest's active generation.
 * An ownerless v3 record requires direct user confirmation for THIS verified account.
 */
export class ArchiveCanonicalMigrator {
  #listeners = new Set<(p: CanonicalMigrationProgress) => void>()
  #progress: CanonicalMigrationProgress = {
    status: 'idle',
    conversations: 0,
    messages: 0,
    waitingForOwner: 0,
    message: '',
  }
  #pending: Promise<void> | null = null
  constructor(private readonly store: ArchiveV4Store) {}
  subscribe(fn: (p: CanonicalMigrationProgress) => void) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }
  snapshot() {
    return { ...this.#progress }
  }
  #set(update: Partial<CanonicalMigrationProgress>) {
    this.#progress = { ...this.#progress, ...update }
    for (const fn of this.#listeners) fn(this.snapshot())
  }
  async active(accountId: string): Promise<string | null> {
    const db = await this.store.canonicalDatabase()
    const row = await request<Row | undefined>(
      db
        .transaction('migrationManifest', 'readonly')
        .objectStore('migrationManifest')
        .get(key(accountId)),
    )
    // A tab can die after fencing an import but before activation. Its staging
    // generation is NOT readable; keep the previously verified generation live.
    // A fresh import uses previousGeneration as its rollback fence as well.
    return row?.status === 'ready' && typeof row.generation === 'string'
      ? row.generation
      : row?.status === 'transforming' && typeof row.previousGeneration === 'string'
        ? row.previousGeneration
        : null
  }
  async migrate(accountId: string, bindUnowned: boolean): Promise<void> {
    if (!accountId.trim()) throw new Error('Verified account required')
    if (this.#pending) return this.#pending
    if (await this.active(accountId))
      throw new Error('Canonical archive already activated; use all-history reconciliation')
    this.#pending = this.#run(accountId, bindUnowned).finally(() => {
      this.#pending = null
    })
    return this.#pending
  }
  async #run(accountId: string, bindUnowned: boolean): Promise<void> {
    const lockName = 'chatgpt-booster:canonical-migration-v1'
    if (!navigator.locks?.request) throw new Error('Cross-tab archive lock is unavailable')
    await navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
      this.#set({
        status: 'checking',
        conversations: 0,
        messages: 0,
        waitingForOwner: 0,
        message: '',
      })
      const target = await this.store.canonicalDatabase()
      const sources = [await existingSource(ARCHIVE_DB_NAME), target] as const
      const generation = crypto.randomUUID()
      const manifestKey = key(accountId)
      const previous = await request<Row | undefined>(
        target
          .transaction('migrationManifest', 'readonly')
          .objectStore('migrationManifest')
          .get(manifestKey),
      )
      // The first caller may have checked before another tab completed its
      // own activation. Recheck UNDER the exclusive lock: no second full
      // generation may silently supersede a verified one.
      if (previous?.status === 'ready')
        throw new Error('Canonical archive already activated; use all-history reconciliation')
      const fallbackGeneration =
        previous?.status === 'ready' ? previous.generation : previous?.previousGeneration
      try {
        // A durable fence prevents native writers in other tabs from changing
        // the source generation while a staged import is in progress.
        const begin = target.transaction('migrationManifest', 'readwrite')
        const beginDone = finish(begin)
        begin.objectStore('migrationManifest').put({
          key: manifestKey,
          accountId,
          generation,
          status: 'transforming',
          previousGeneration: typeof fallbackGeneration === 'string' ? fallbackGeneration : null,
          storageSchemaVersion: 2,
          canonicalModelVersion: 1,
          startedAt: Date.now(),
        })
        await beginDone
        // Staging records are invisible to active canonical readers.
        this.#set({ status: 'transforming' })
        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
          const db = sources[sourceIndex]
          if (!db) continue
          const source = sourceIndex === 0 ? 'legacy_v3' : 'legacy_v4'
          const conversations = db
            .transaction('conversations', 'readonly')
            .objectStore('conversations')
          // Cursor queue contains only headers, not message bodies.
          const headers = await request<Row[]>(conversations.getAll())
          for (const header of headers) {
            const conversationId = header.conversationId
            if (typeof conversationId !== 'string' || !conversationId) continue
            if (source === 'legacy_v4' && header.accountId !== accountId) continue
            if (source === 'legacy_v3') {
              const binding = legacyV3OwnerEvidence(header, accountId)
              // DEV-only, explicit one-time binding: old v3 owner.user_id may
              // not equal ChatGPT account_id / account_user_id. Never silently
              // attribute either unknown OR mismatched local legacy owners.
              if (binding.status !== 'verified' && !bindUnowned) {
                this.#set({ waitingForOwner: this.#progress.waitingForOwner + 1 })
                continue
              }
            }
            const scoped = key(accountId, conversationId)
            const conversationKey = key(generation, scoped)
            const txHeader = target.transaction('canonicalConversations', 'readwrite')
            const hdrDone = finish(txHeader)
            const headers = txHeader.objectStore('canonicalConversations')
            const previous = await request<CanonicalStoredConversation | undefined>(
              headers.get(conversationKey),
            )
            headers.put({
              key: conversationKey,
              accountId,
              conversationId,
              projectId:
                typeof header.projectId === 'string'
                  ? header.projectId
                  : (previous?.projectId ?? null),
              title:
                typeof header.title === 'string' && header.title.trim()
                  ? header.title
                  : (previous?.title ?? null),
              currentNodeId:
                typeof header.currentNodeId === 'string'
                  ? header.currentNodeId
                  : (previous?.currentNodeId ?? null),
              lastSeenAt: Math.max(
                previous?.lastSeenAt ?? 0,
                typeof header.lastSeenAt === 'number' ? header.lastSeenAt : 0,
              ),
              verifiedPagination: false,
              source,
              generation,
            } satisfies CanonicalStoredConversation)
            await hdrDone
            // Read one conversation's indexed rows. Individual writes are atomic;
            // a failed migration generation never becomes active.
            const ix = source === 'legacy_v3' ? 'conversationId' : 'byConversation'
            const query = source === 'legacy_v3' ? conversationId : scoped
            for await (const batch of scanBatches(db, 'messages', ix, query)) {
              // CPU-heavy fingerprints are calculated outside any IndexedDB
              // transaction, in parallel, for a bounded batch of 128.
              const prepared = await Promise.all(
                batch.map(async (row) => {
                  const raw = object(row.raw)
                  if (!raw || typeof raw.id !== 'string' || !raw.id)
                    throw new Error('Legacy source record is malformed')
                  const projection = projectNativeMessage(raw, { accountId, conversationId })
                  const fingerprint = await sourceFingerprint(canonicalSourceJson(raw))
                  const messageKey = key(conversationKey, raw.id)
                  return {
                    raw,
                    projection,
                    fingerprint,
                    messageKey,
                    snapKey: key(messageKey, source, fingerprint),
                  }
                }),
              )
              const tx = target.transaction(
                ['canonicalMessages', 'canonicalElements', 'sourceSnapshots'],
                'readwrite',
              )
              const done = finish(tx)
              const table = tx.objectStore('canonicalMessages')
              // The new staging generation has no v3 rows yet. Only v4
              // source messages can conflict with already-staged v3 entries.
              const previous =
                source === 'legacy_v3'
                  ? prepared.map(() => undefined)
                  : await Promise.all(
                      prepared.map((row) =>
                        request<CanonicalStoredMessage | undefined>(table.get(row.messageKey)),
                      ),
                    )
              const elements = tx.objectStore('canonicalElements')
              const snapshots = tx.objectStore('sourceSnapshots')
              const staleElements =
                source === 'legacy_v4'
                  ? await Promise.all(
                      prepared.map((row, i) =>
                        previous[i]
                          ? request<IDBValidKey[]>(
                              elements.index('byMessage').getAllKeys(row.messageKey),
                            )
                          : Promise.resolve([] as IDBValidKey[]),
                      ),
                    )
                  : []
              prepared.forEach((row, i) => {
                if (!previous[i] || source === 'legacy_v4') {
                  // A newer v4 revision may have fewer content elements.
                  // Delete earlier staged elements atomically to avoid ghosts.
                  for (const oldKey of staleElements[i] ?? []) elements.delete(oldKey)
                  table.put({
                    key: row.messageKey,
                    conversationKey,
                    accountId,
                    conversationId,
                    messageId: row.projection.messageId,
                    sourceCreateTime: row.projection.sourceCreateTime,
                    sourceFingerprint: row.fingerprint,
                    source,
                    generation,
                    projection: row.projection,
                  } satisfies CanonicalStoredMessage)
                  for (const element of row.projection.elements)
                    elements.put({
                      ...element,
                      elementId: key(generation, element.elementId),
                      messageKey: row.messageKey,
                      generation,
                    })
                }
                // IDB.put clones its argument; a second structuredClone(raw)
                // would waste time and memory for every large native message.
                snapshots.put({
                  key: row.snapKey,
                  messageKey: row.messageKey,
                  generation,
                  fingerprint: row.fingerprint,
                  source,
                  raw: row.raw,
                } satisfies CanonicalSourceSnapshot)
              })
              await done
              this.#set({ messages: this.#progress.messages + batch.length })
            }
            this.#set({ conversations: this.#progress.conversations + 1 })
          }
        }
        this.#set({ status: 'validating' })
        const tx = target.transaction(
          [
            'canonicalConversations',
            'canonicalMessages',
            'canonicalElements',
            'sourceSnapshots',
            'migrationManifest',
          ],
          'readwrite',
        )
        const done = finish(tx)
        const [conversations, messages, elements, snapshots] = await Promise.all([
          request<number>(
            tx.objectStore('canonicalConversations').index('byGeneration').count(generation),
          ),
          request<number>(
            tx.objectStore('canonicalMessages').index('byGeneration').count(generation),
          ),
          request<number>(
            tx.objectStore('canonicalElements').index('byGeneration').count(generation),
          ),
          request<number>(
            tx.objectStore('sourceSnapshots').index('byGeneration').count(generation),
          ),
        ])
        if (
          // An empty verified generation is valid when every old chat still
          // needs explicit owner approval. This must not strand v3-only users
          // without a way to inspect and bind their saved conversations.
          conversations > this.#progress.conversations ||
          snapshots !== this.#progress.messages ||
          elements < messages
        ) {
          tx.abort()
          throw new Error('Staged canonical archive verification failed')
        }
        const current = await request<Row | undefined>(
          tx.objectStore('migrationManifest').get(manifestKey),
        )
        if (current?.generation !== generation || current.status !== 'transforming')
          throw new Error('Archive migration generation changed')
        const record = {
          key: key(accountId),
          accountId,
          generation,
          status: 'ready',
          storageSchemaVersion: 2,
          canonicalModelVersion: 1,
          messages,
          conversations,
          sourceSnapshots: snapshots,
          contentElements: elements,
          waitingForOwner: this.#progress.waitingForOwner,
          verifiedAt: Date.now(),
        }
        tx.objectStore('migrationManifest').put(record)
        await done
        this.#set({ status: 'ready' })
      } catch (error) {
        // Preserve a previously verified active generation after failed retry.
        const tx = target.transaction('migrationManifest', 'readwrite')
        const done = finish(tx)
        tx.objectStore('migrationManifest').put(
          typeof fallbackGeneration === 'string'
            ? {
                key: manifestKey,
                accountId,
                generation: fallbackGeneration,
                status: 'ready',
                storageSchemaVersion: 2,
                canonicalModelVersion: 1,
                restoredAt: Date.now(),
              }
            : {
                key: manifestKey,
                accountId,
                generation,
                status: 'failed_recoverable',
                storageSchemaVersion: 2,
                canonicalModelVersion: 1,
                failedAt: Date.now(),
              },
        )
        await done
        this.#set({
          status: 'failed_recoverable',
          message: error instanceof Error ? error.message : 'Migration failed',
        })
        throw error
      } finally {
        sources[0]?.close()
      }
    })
  }

  async exportSources(accountId: string): Promise<Blob> {
    return exportNativeSourceBackup(this.store, accountId)
  }

  async restoreSources(accountId: string, backup: Blob, stillAuthorized?: () => boolean) {
    return importNativeSourceBackup(this.store, accountId, backup, stillAuthorized)
  }

  async exportBackup(accountId: string): Promise<Blob> {
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    return exportCanonicalBackup(this.store, accountId, generation)
  }

  async restoreBackup(accountId: string, file: Blob, stillAuthorized?: () => boolean) {
    return restoreCanonicalBackup(this.store, accountId, file, stillAuthorized)
  }

  async canUndoBackupRestore(accountId: string): Promise<boolean> {
    if (!accountId) return false
    const db = await this.store.canonicalDatabase()
    const manifest = await request<Row | undefined>(db.transaction('migrationManifest', 'readonly')
      .objectStore('migrationManifest').get(key(accountId)))
    return manifest?.status === 'ready' &&
      typeof manifest.generation === 'string' &&
      typeof manifest.previousGeneration === 'string' &&
      manifest.previousGeneration !== manifest.generation &&
      typeof manifest.restoredFromBackupAt === 'number'
  }

  async undoBackupRestore(accountId: string, stillAuthorized?: () => boolean) {
    return undoCanonicalBackupRestore(this.store, accountId, stillAuthorized)
  }

  async auditIntegrity(accountId: string): Promise<ArchiveIntegrityReport> {
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    return auditCanonicalSourceIntegrity(this.store, accountId, generation)
  }

  /** Count-only inventory of the UNION of v3 and account-scoped v4 IDs.
   * No native bodies are loaded and no archive is mutated. Overlapping v3/v4
   * records may share message IDs, so source counts are not additive proofs. */
  async auditCoverage(accountId: string): Promise<ArchiveCoverageAudit> {
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    const v3 = await existingSource(ARCHIVE_DB_NAME)
    const target = await this.store.canonicalDatabase()
    const current = await this.listConversations(accountId)
    const ids = new Map<
      string,
      {
        title: string | null
        v3Count: number
        v4Count: number
        ownerStatus: 'verified' | 'waiting_for_owner' | 'mismatch' | 'v4_only'
      }
    >()
    try {
      if (v3) {
        const headers = await request<Row[]>(
          v3.transaction('conversations', 'readonly').objectStore('conversations').getAll(),
        )
        for (const header of headers) {
          const id = header.conversationId
          if (typeof id !== 'string' || !id) continue
          const evidence = legacyV3OwnerEvidence(header, accountId)
          const count = await request<number>(
            v3
              .transaction('messages', 'readonly')
              .objectStore('messages')
              .index('conversationId')
              .count(id),
          )
          ids.set(id, {
            title: typeof header.title === 'string' ? header.title : null,
            v3Count: count,
            v4Count: 0,
            ownerStatus: evidence.status,
          })
        }
      }
      const v4 = await request<Row[]>(
        target
          .transaction('conversations', 'readonly')
          .objectStore('conversations')
          .index('byAccount')
          .getAll(accountId),
      )
      for (const header of v4) {
        const id = header.conversationId
        if (typeof id !== 'string' || !id) continue
        const count = await request<number>(
          target
            .transaction('messages', 'readonly')
            .objectStore('messages')
            .index('byConversation')
            .count(key(accountId, id)),
        )
        const previous = ids.get(id)
        ids.set(id, {
          title: (typeof header.title === 'string' && header.title) || previous?.title || null,
          v3Count: previous?.v3Count ?? 0,
          v4Count: count,
          ownerStatus: previous?.ownerStatus ?? 'v4_only',
        })
      }
      const canonical = new Set(current.map((row) => row.conversationId))
      let missing = 0,
        less = 0,
        before = 0,
        after = 0
      const missingDetails: ArchiveCoverageAudit['missingDetails'][number][] = []
      for (const [id, old] of ids) {
        const count = await request<number>(
          target
            .transaction('canonicalMessages', 'readonly')
            .objectStore('canonicalMessages')
            .index('byConversation')
            .count(key(generation, key(accountId, id))),
        )
        const sourceMax = Math.max(old.v3Count, old.v4Count)
        before += old.v3Count + old.v4Count
        after += count
        if (!canonical.has(id)) missing++
        if (count < sourceMax) less++
        if (!canonical.has(id) || count < sourceMax)
          missingDetails.push({
            conversationId: id,
            title: old.title,
            v3Count: old.v3Count,
            v4Count: old.v4Count,
            canonicalCount: count,
            ownerStatus: old.ownerStatus,
          })
      }
      if ((await this.active(accountId)) !== generation)
        throw new Error('Archive generation changed during audit')
      missingDetails.sort(
        (a, b) =>
          Math.max(b.v3Count, b.v4Count) -
            b.canonicalCount -
            (Math.max(a.v3Count, a.v4Count) - a.canonicalCount) ||
          a.conversationId.localeCompare(b.conversationId),
      )
      return {
        kind: 'count_only_read_only',
        legacyConversations: ids.size,
        canonicalConversations: current.length,
        conversationCountShortfall: missing,
        conversationsWithMessageShortfall: less,
        sourceMessageCount: before,
        canonicalMessageCount: after,
        missingDetails,
      }
    } finally {
      v3?.close()
    }
  }

  /**
   * Inspect unmatched-owner records without changing v3, v4 or the canonical
   * generation. Only titles/counts and bounded message IDs leave the storage
   * adapter; native message bodies and old owner identifiers remain private.
   */
  async inspectSkippedRecent(
    accountId: string,
    sinceMs: number,
    quickAfterLastImport = false,
  ): Promise<ArchiveOwnerSkipInspection> {
    if (
      !accountId.trim() ||
      !Number.isSafeInteger(sinceMs) ||
      sinceMs > Date.now() ||
      sinceMs < Date.now() - 30 * 86_400_000
    )
      throw new Error('Invalid archive inspection scope')
    if (this.#pending) throw new Error('Archive reconciliation already running')
    return navigator.locks?.request
      ? navigator.locks.request('chatgpt-booster:canonical-migration-v1', { mode: 'shared' }, () =>
          this.#inspectSkippedRecent(accountId, sinceMs, quickAfterLastImport),
        )
      : this.#inspectSkippedRecent(accountId, sinceMs, quickAfterLastImport)
  }

  async #inspectSkippedRecent(
    accountId: string,
    sinceMs: number,
    quickAfterLastImport: boolean,
  ): Promise<ArchiveOwnerSkipInspection> {
    const target = await this.store.canonicalDatabase()
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    const manifest = await request<Row | undefined>(
      target
        .transaction('migrationManifest', 'readonly')
        .objectStore('migrationManifest')
        .get(key(accountId)),
    )
    const checkpoint =
      typeof manifest?.lastReconciledAt === 'number' &&
      manifest.lastReconciledSkippedOwnership === 0
        ? manifest.lastReconciledAt
        : typeof manifest?.verifiedAt === 'number'
          ? manifest.verifiedAt
          : null
    const effectiveSince =
      quickAfterLastImport && checkpoint !== null
        ? Math.max(sinceMs, checkpoint - 15 * 60_000)
        : sinceMs
    const active = new Set(
      (await this.listConversations(accountId)).map((row) => row.conversationId),
    )
    const legacy = await existingSource(ARCHIVE_DB_NAME)
    if (!legacy)
      return { examined: 0, skippedMessages: 0, skippedConversations: [], sinceMs: effectiveSince }
    try {
      const headers = await request<Row[]>(
        legacy.transaction('conversations', 'readonly').objectStore('conversations').getAll(),
      )
      const reasons = new Map<string, { header: Row; reason: LegacySkipReason }>()
      for (const header of headers) {
        const id = header.conversationId
        if (typeof id !== 'string' || !id || active.has(id)) continue
        const evidence = legacyV3OwnerEvidence(header, accountId)
        if (evidence.status !== 'verified')
          reasons.set(id, {
            header,
            reason: evidence.status === 'mismatch' ? 'owner_mismatch' : 'missing_owner',
          })
      }
      const groups = new Map<string, LegacySkippedConversation>()
      let examined = 0
      if (reasons.size) {
        for await (const batch of scanRecent(
          legacy,
          'messages',
          'lastSeenAt',
          effectiveSince,
          Date.now(),
        )) {
          examined += batch.length
          for (const row of batch) {
            const id = row.conversationId
            if (typeof id !== 'string') continue
            const target = reasons.get(id)
            if (!target) continue
            const old = groups.get(id)
            const rawId =
              typeof object(row.raw)?.id === 'string' ? (object(row.raw)?.id as string) : null
            const entry: LegacySkippedConversation = {
              conversationId: id,
              title: typeof target.header.title === 'string' ? target.header.title : null,
              reason: target.reason,
              messages: (old?.messages ?? 0) + 1,
              messageIds:
                rawId && (old?.messageIds.length ?? 0) < 10
                  ? [...(old?.messageIds ?? []), rawId]
                  : (old?.messageIds ?? []),
            }
            groups.set(id, entry)
          }
        }
      }
      if ((await this.active(accountId)) !== generation)
        throw new Error('Archive owner changed while inspecting')
      const skippedConversations = [...groups.values()].sort(
        (a, b) => b.messages - a.messages || a.conversationId.localeCompare(b.conversationId),
      )
      return {
        examined,
        sinceMs: effectiveSince,
        skippedMessages: skippedConversations.reduce((sum, row) => sum + row.messages, 0),
        skippedConversations,
      }
    } finally {
      legacy.close()
    }
  }

  /** All-time, read-only owner inventory. Unlike the recent-history scanner,
   * this sees old conversations even when their messages were never modified. */
  async inspectSkippedAll(accountId: string): Promise<ArchiveOwnerSkipInspection> {
    if (!accountId.trim()) throw new Error('Verified account required')
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    const existing = new Set((await this.listConversations(accountId)).map((c) => c.conversationId))
    const legacy = await existingSource(ARCHIVE_DB_NAME)
    if (!legacy) return { examined: 0, skippedMessages: 0, skippedConversations: [], sinceMs: 0 }
    const skippedConversations: LegacySkippedConversation[] = []
    let examined = 0
    try {
      const headers = await request<Row[]>(
        legacy.transaction('conversations', 'readonly').objectStore('conversations').getAll(),
      )
      for (const header of headers) {
        const id = header.conversationId
        if (typeof id !== 'string' || !id || existing.has(id)) continue
        const owner = legacyV3OwnerEvidence(header, accountId)
        if (owner.status === 'verified') continue
        const index = legacy
          .transaction('messages', 'readonly')
          .objectStore('messages')
          .index('conversationId')
        const messages = await request<number>(index.count(id))
        examined += messages
        skippedConversations.push({
          conversationId: id,
          title: typeof header.title === 'string' ? header.title : null,
          reason: owner.status === 'mismatch' ? 'owner_mismatch' : 'missing_owner',
          messages,
          messageIds: [],
        })
      }
      if ((await this.active(accountId)) !== generation)
        throw new Error('Archive generation changed during owner inspection')
      skippedConversations.sort(
        (a, b) => b.messages - a.messages || a.conversationId.localeCompare(b.conversationId),
      )
      return { examined, skippedMessages: examined, skippedConversations, sinceMs: 0 }
    } finally {
      legacy.close()
    }
  }

  /** Explicit all-history reconciliation, including records older than 30 days.
   * Unknown/mismatched legacy owners require a specific selected conversation ID.
   * Existing source databases are never modified. */
  /** Restore the last activated generation after a crashed, uncommitted
   * staging import. Called only while owning the exclusive cross-tab lock;
   * never activates the interrupted staging generation or deletes its rows. */
  async #restoreInterruptedManifest(
    db: IDBDatabase,
    accountId: string,
    generation: string,
  ): Promise<void> {
    const tx = db.transaction(['migrationManifest', 'canonicalConversations'], 'readwrite')
    const done = finish(tx)
    const manifest = tx.objectStore('migrationManifest')
    const current = await request<Row | undefined>(manifest.get(key(accountId)))
    if (current?.status !== 'transforming') {
      await done
      return
    }
    if (current.previousGeneration !== generation || current.generation === generation)
      throw new Error('Archive recovery fence mismatch')
    const confirmed = await request<number>(
      tx.objectStore('canonicalConversations').index('byGeneration').count(generation),
    )
    if (confirmed === 0) throw new Error('Previous archive generation is not readable')
    manifest.put({
      ...current,
      generation,
      status: 'ready',
      previousGeneration: null,
      interruptedStagingGeneration: current.generation,
      recoveredAt: Date.now(),
    })
    await done
  }

  async reconcileAll(
    accountId: string,
    approvedLegacy: readonly string[] = [],
  ): Promise<ArchiveReconciliationReport> {
    return this.reconcileRecent(accountId, 0, approvedLegacy, false, true)
  }

  /**
   * Fast opt-in reconciliation of recent v3/v4 writes only. The existing
   * verified generation stays active; each bounded batch is atomic, retryable,
   * and idempotent. Unsupported account ownership never auto-binds.
   */
  async reconcileRecent(
    accountId: string,
    sinceMs: number,
    bindUnknownLegacy: boolean | readonly string[] = false,
    quickAfterLastImport = false,
    allHistory = false,
  ): Promise<ArchiveReconciliationReport> {
    if (
      !accountId.trim() ||
      !Number.isSafeInteger(sinceMs) ||
      sinceMs > Date.now() ||
      (allHistory ? sinceMs !== 0 : sinceMs < Date.now() - 30 * 86_400_000)
    )
      throw new Error('Invalid archive reconciliation scope')
    if (this.#pending) throw new Error('Archive migration is already running')
    const work = this.#reconcileRecentLocked(
      accountId,
      sinceMs,
      bindUnknownLegacy,
      quickAfterLastImport,
      allHistory,
    )
    this.#pending = work.finally(() => {
      this.#pending = null
    })
    try {
      await this.#pending
    } finally {
      /* report is assigned by the locked executor */
    }
    if (!this.#recentReport) throw new Error('Archive reconciliation did not return a report')
    return this.#recentReport
  }
  #recentReport: ArchiveReconciliationReport | null = null

  async #reconcileRecentLocked(
    accountId: string,
    sinceMs: number,
    bindUnknownLegacy: boolean | readonly string[],
    quickAfterLastImport: boolean,
    allHistory: boolean,
  ): Promise<void> {
    if (!navigator.locks?.request) throw new Error('Cross-tab archive lock is unavailable')
    await navigator.locks.request(
      'chatgpt-booster:canonical-migration-v1',
      { mode: 'exclusive' },
      async () => {
        const generation = await this.active(accountId)
        if (!generation) throw new Error('No activated canonical archive to reconcile')
        this.#recentReport = null
        this.#set({
          status: 'reconciling',
          messages: 0,
          conversations: 0,
          waitingForOwner: 0,
          message: '',
        })
        const target = await this.store.canonicalDatabase()
        await this.#restoreInterruptedManifest(target, accountId, generation)
        const manifest = await request<Row | undefined>(
          target
            .transaction('migrationManifest', 'readonly')
            .objectStore('migrationManifest')
            .get(key(accountId)),
        )
        const checkpoint =
          typeof manifest?.lastReconciledAt === 'number' &&
          manifest.lastReconciledSkippedOwnership === 0
            ? manifest.lastReconciledAt
            : typeof manifest?.verifiedAt === 'number'
              ? manifest.verifiedAt
              : null
        // This opt-in fast mode reconciles writes since the last activated
        // generation (with a 15-minute overlap), not old already migrated
        // history. The 7-day path remains an explicit broader recheck.
        const effectiveSinceMs =
          !allHistory && quickAfterLastImport && checkpoint !== null
            ? Math.max(sinceMs, checkpoint - 15 * 60_000)
            : sinceMs
        const v3 = await existingSource(ARCHIVE_DB_NAME)
        const skipDetails = new Map<string, LegacySkippedConversation>()
        const approved = Array.isArray(bindUnknownLegacy) ? new Set(bindUnknownLegacy) : null
        const allowUnknown = (id: string) =>
          approved ? approved.has(id) : bindUnknownLegacy === true
        const rememberSkip = (
          cid: string,
          header: Row,
          reason: LegacySkipReason,
          messageId: string,
        ) => {
          const existing = skipDetails.get(cid)
          if (existing) {
            skipDetails.set(cid, {
              ...existing,
              messages: existing.messages + 1,
              messageIds:
                existing.messageIds.length < 10
                  ? [...existing.messageIds, messageId]
                  : existing.messageIds,
            })
            return
          }
          skipDetails.set(cid, {
            conversationId: cid,
            title: typeof header.title === 'string' ? header.title : null,
            reason,
            messages: 1,
            messageIds: [messageId],
          })
        }
        const changed = {
          sinceMs,
          effectiveSinceMs,
          checkpointApplied: effectiveSinceMs > sinceMs,
          examined: 0,
          inserted: 0,
          changed: 0,
          unchanged: 0,
          skippedOwnership: 0,
          skippedConversations: [] as LegacySkippedConversation[],
          conversationsTouched: 0,
        }
        const touched = new Set<string>()
        const until = Date.now()
        // Existing account-bound conversation headers are the proof of the
        // user's earlier explicit consent. Unknown new legacy headers are not.
        const active = new Set(
          (await this.listConversations(accountId)).map((row) => row.conversationId),
        )
        const writeBatch = async (
          rows: Row[],
          source: 'legacy_v3' | 'legacy_v4',
          headers: ReadonlyMap<string, Row>,
        ): Promise<void> => {
          const prepared = await Promise.all(
            rows.map(async (row) => {
              const cid = row.conversationId
              const raw = object(row.raw)
              if (typeof cid !== 'string' || !cid || !raw || typeof raw.id !== 'string' || !raw.id)
                throw new Error('Malformed recent archive source record')
              const header = headers.get(cid)
              if (!header) throw new Error('Recent source references unknown conversation')
              if (!active.has(cid) && source === 'legacy_v3') {
                const evidence = legacyV3OwnerEvidence(header, accountId)
                if (evidence.status !== 'verified' && !allowUnknown(cid)) {
                  rememberSkip(
                    cid,
                    header,
                    evidence.status === 'mismatch' ? 'owner_mismatch' : 'missing_owner',
                    raw.id,
                  )
                  return null
                }
              }
              if (source === 'legacy_v4' && header.accountId !== accountId) return null
              const projection = projectNativeMessage(raw, { accountId, conversationId: cid })
              const fingerprint = await sourceFingerprint(canonicalSourceJson(raw))
              const conversationKey = key(generation, key(accountId, cid))
              const messageKey = key(conversationKey, raw.id)
              return {
                cid,
                raw,
                header,
                projection,
                fingerprint,
                conversationKey,
                messageKey,
                snapshotKey: key(messageKey, source, fingerprint),
              }
            }),
          )
          const valid = prepared.filter((row) => row !== null)
          changed.examined += rows.length
          changed.skippedOwnership += rows.length - valid.length
          if (!valid.length) return
          const tx = target.transaction(
            ['canonicalMessages', 'canonicalElements', 'sourceSnapshots', 'canonicalConversations'],
            'readwrite',
          )
          const done = finish(tx)
          const messages = tx.objectStore('canonicalMessages')
          const elements = tx.objectStore('canonicalElements')
          const snapshots = tx.objectStore('sourceSnapshots')
          const conversations = tx.objectStore('canonicalConversations')
          // A repeated all-history scan must not structured-clone unchanged
          // multi-megabyte source raw into IndexedDB on every pass.
          const existingSnapshotKeys = await Promise.all(
            valid.map((row) => request<IDBValidKey | undefined>(snapshots.getKey(row.snapshotKey))),
          )
          const current = await Promise.all(
            valid.map((v) =>
              request<CanonicalStoredMessage | undefined>(messages.get(v.messageKey)),
            ),
          )
          const previousHeaders = new Map<string, CanonicalStoredConversation | undefined>()
          for (const row of valid) {
            if (previousHeaders.has(row.cid)) continue
            previousHeaders.set(
              row.cid,
              await request<CanonicalStoredConversation | undefined>(
                conversations.get(row.conversationKey),
              ),
            )
          }
          let i = 0
          for (const row of valid) {
            const previous = current[i++]
            const oldV4 =
              source === 'legacy_v3' && previous && previous.source !== 'legacy_v3'
                ? previous.source === 'legacy_v4' ||
                  previous.source === 'native' ||
                  (previous.source === undefined &&
                    (
                      await request<CanonicalSourceSnapshot[]>(
                        snapshots.index('byMessage').getAll(row.messageKey),
                      )
                    ).some((s) => s.generation === generation && s.source !== 'legacy_v3'))
                : false
            if (previous?.sourceFingerprint === row.fingerprint || oldV4) {
              // A matching v4 snapshot still wins source precedence. Without
              // this marker, a later legacy-v3 recheck could overwrite it.
              if (previous && source === 'legacy_v4' && previous.source !== 'legacy_v4' && !oldV4)
                messages.put({ ...previous, source: 'legacy_v4' })
              changed.unchanged++
            } else {
              // Old element count may differ after an edited message; remove
              // stale nodes in the SAME transaction as the new projection.
              const stale = await request<IDBValidKey[]>(
                elements.index('byMessage').getAllKeys(row.messageKey),
              )
              for (const k of stale) elements.delete(k)
              messages.put({
                key: row.messageKey,
                conversationKey: row.conversationKey,
                accountId,
                conversationId: row.cid,
                messageId: row.projection.messageId,
                sourceCreateTime: row.projection.sourceCreateTime,
                sourceFingerprint: row.fingerprint,
                source,
                generation,
                projection: row.projection,
              } satisfies CanonicalStoredMessage)
              for (const element of row.projection.elements)
                elements.put({
                  ...element,
                  messageKey: row.messageKey,
                  generation,
                  elementId: key(generation, element.elementId),
                })
              if (previous) changed.changed++
              else changed.inserted++
            }
            if (existingSnapshotKeys[i - 1] === undefined)
              snapshots.put({
                key: row.snapshotKey,
                messageKey: row.messageKey,
                generation,
                fingerprint: row.fingerprint,
                source,
                raw: row.raw,
              } satisfies CanonicalSourceSnapshot)
            const prior = previousHeaders.get(row.cid)
            conversations.put({
              key: row.conversationKey,
              accountId,
              conversationId: row.cid,
              projectId:
                typeof row.header.projectId === 'string'
                  ? row.header.projectId
                  : (prior?.projectId ?? null),
              title:
                typeof row.header.title === 'string' && row.header.title.trim()
                  ? row.header.title
                  : (prior?.title ?? null),
              currentNodeId:
                typeof row.header.currentNodeId === 'string'
                  ? row.header.currentNodeId
                  : (prior?.currentNodeId ?? null),
              lastSeenAt: Math.max(
                prior?.lastSeenAt ?? 0,
                typeof row.header.lastSeenAt === 'number' ? row.header.lastSeenAt : 0,
              ),
              source,
              verifiedPagination: false,
              generation,
            } satisfies CanonicalStoredConversation)
            touched.add(row.cid)
          }
          await done
          for (const v of valid) active.add(v.cid)
          this.#set({ messages: changed.examined, conversations: touched.size })
        }
        try {
          if (v3) {
            const headers = await request<Row[]>(
              v3.transaction('conversations', 'readonly').objectStore('conversations').getAll(),
            )
            const byId = new Map(
              headers
                .filter((h) => typeof h.conversationId === 'string')
                .map((h) => [h.conversationId as string, h]),
            )
            if (allHistory) {
              for (const id of byId.keys()) {
                let batch: Row[] = []
                for await (const row of scan(v3, 'messages', 'conversationId', id)) {
                  batch.push(row)
                  if (batch.length === 128) {
                    await writeBatch(batch, 'legacy_v3', byId)
                    batch = []
                  }
                }
                if (batch.length) await writeBatch(batch, 'legacy_v3', byId)
              }
            } else {
              for await (const rows of scanRecent(
                v3,
                'messages',
                'lastSeenAt',
                effectiveSinceMs,
                until,
              ))
                await writeBatch(rows, 'legacy_v3', byId)
            }
          }
          const headers = await request<Row[]>(
            target.transaction('conversations', 'readonly').objectStore('conversations').getAll(),
          )
          const byId = new Map(
            headers
              .filter((h) => h.accountId === accountId && typeof h.conversationId === 'string')
              .map((h) => [h.conversationId as string, h]),
          )
          // v4 indexes chronology, not lastSeenAt. Only scan conversations
          // whose header changed in the requested recent period.
          for (const h of byId.values()) {
            if (
              !allHistory &&
              (typeof h.lastSeenAt !== 'number' || h.lastSeenAt < effectiveSinceMs)
            )
              continue
            const cid = h.conversationId as string
            const scoped = key(accountId, cid)
            let batch: Row[] = []
            for await (const row of scan(target, 'messages', 'byConversation', scoped)) {
              batch.push({ ...row, conversationId: cid })
              if (batch.length === 128) {
                await writeBatch(batch, 'legacy_v4', byId)
                batch = []
              }
            }
            if (batch.length) await writeBatch(batch, 'legacy_v4', byId)
          }
          if ((await this.active(accountId)) !== generation)
            throw new Error('Archive generation changed during reconciliation')
          const tx = target.transaction(
            [
              'migrationManifest',
              'canonicalMessages',
              'sourceSnapshots',
              'canonicalConversations',
              'canonicalElements',
            ],
            'readwrite',
          )
          const done = finish(tx)
          const manifestStore = tx.objectStore('migrationManifest')
          const manifest = await request<Row | undefined>(manifestStore.get(key(accountId)))
          if (!manifest || manifest.generation !== generation || manifest.status !== 'ready')
            throw new Error('Archive manifest changed during reconciliation')
          const [messages, snapshots, conversations, elements] = await Promise.all([
            request<number>(
              tx.objectStore('canonicalMessages').index('byGeneration').count(generation),
            ),
            request<number>(
              tx.objectStore('sourceSnapshots').index('byGeneration').count(generation),
            ),
            request<number>(
              tx.objectStore('canonicalConversations').index('byGeneration').count(generation),
            ),
            request<number>(
              tx.objectStore('canonicalElements').index('byGeneration').count(generation),
            ),
          ])
          manifestStore.put({
            ...manifest,
            messages,
            sourceSnapshots: snapshots,
            conversations,
            contentElements: elements,
            lastReconciledAt: Date.now(),
            lastReconciledSince: sinceMs,
            lastReconciledExamined: changed.examined,
            lastReconciledMutated: changed.inserted + changed.changed,
            lastReconciledSkippedOwnership: changed.skippedOwnership,
          })
          await done
          changed.conversationsTouched = touched.size
          changed.skippedConversations = [...skipDetails.values()].sort(
            (a, b) => b.messages - a.messages || a.conversationId.localeCompare(b.conversationId),
          )
          this.#recentReport = { ...changed }
          this.#set({ status: 'ready', message: '' })
        } catch (error) {
          this.#set({
            status: 'failed_recoverable',
            message: error instanceof Error ? error.message : 'Recent archive sync failed',
          })
          throw error
        } finally {
          v3?.close()
        }
      },
    )
  }

  async listConversations(accountId: string): Promise<CanonicalStoredConversation[]> {
    const generation = await this.active(accountId)
    if (!generation) return []
    const db = await this.store.canonicalDatabase()
    const all = await request<CanonicalStoredConversation[]>(
      db
        .transaction('canonicalConversations', 'readonly')
        .objectStore('canonicalConversations')
        .index('byAccount')
        .getAll(accountId),
    )
    return all.filter((entry) => entry.generation === generation)
  }
  async readMessages(accountId: string, conversationId: string): Promise<CanonicalStoredMessage[]> {
    const generation = await this.active(accountId)
    if (!generation) return []
    const db = await this.store.canonicalDatabase()
    const conversationKey = key(generation, key(accountId, conversationId))
    const all = await request<CanonicalStoredMessage[]>(
      db
        .transaction('canonicalMessages', 'readonly')
        .objectStore('canonicalMessages')
        .index('byConversation')
        .getAll(conversationKey),
    )
    return all.sort(
      (a, b) =>
        (a.sourceCreateTime ?? Infinity) - (b.sourceCreateTime ?? Infinity) ||
        a.messageId.localeCompare(b.messageId),
    )
  }
  /** Bounded count scan: do not materialize every saved message and its raw
   * content just to display a Reader status line. */
  async conversationCounts(
    accountId: string,
    conversationId: string,
  ): Promise<{
    total: number
    visible: number
    internal: number
    firstId: string | null
    lastId: string | null
  }> {
    const generation = await this.active(accountId)
    if (!generation) return { total: 0, visible: 0, internal: 0, firstId: null, lastId: null }
    const db = await this.store.canonicalDatabase()
    const id = key(generation, key(accountId, conversationId))
    return new Promise((resolve, reject) => {
      let total = 0,
        visible = 0,
        internal = 0
      let first: { id: string; time: number } | null = null
      let last: { id: string; time: number } | null = null
      const ix = db
        .transaction('canonicalMessages', 'readonly')
        .objectStore('canonicalMessages')
        .index('byConversation')
      const scan = ix.openCursor(IDBKeyRange.only(id))
      scan.onerror = () => reject(scan.error ?? new Error('Canonical count cursor failed'))
      scan.onsuccess = () => {
        const cursor = scan.result
        if (!cursor) {
          resolve({
            total,
            visible,
            internal,
            firstId: first?.id ?? null,
            lastId: last?.id ?? null,
          })
          return
        }
        const row = cursor.value as CanonicalStoredMessage
        if (
          row.generation !== generation ||
          row.accountId !== accountId ||
          row.conversationId !== conversationId
        ) {
          reject(new Error('Canonical account scope mismatch'))
          return
        }
        total++
        const p = row.projection
        const shown =
          p.role === 'user' ||
          (p.role === 'assistant' &&
            (p.channel === null || p.channel === 'final') &&
            (p.recipient === null || p.recipient === 'all') &&
            p.elements[0]?.kind !== 'reasoning')
        if (shown) visible++
        else internal++
        if (shown && row.sourceCreateTime !== null) {
          const time = row.sourceCreateTime
          if (!first || time < first.time || (time === first.time && row.messageId < first.id))
            first = { id: row.messageId, time }
          if (!last || time > last.time || (time === last.time && row.messageId > last.id))
            last = { id: row.messageId, time }
        }
        cursor.continue()
      }
    })
  }

  /** IndexedDB's chronology index excludes null timestamps. Only for such
   * conversations, use a key-scoped cursor and a bounded top-41 selection.
   * This scans O(n) records but never materializes O(n) bodies in JS memory. */
  async #unsequencedWindow(
    db: IDBDatabase,
    conversationKey: string,
    before: ArchiveWindowCursor | null,
    direction: 'older' | 'newer' | 'first',
    signal?: AbortSignal,
  ): Promise<{ rows: CanonicalStoredMessage[]; hasOlder: boolean; hasNewer: boolean }> {
    const compare = (
      a: Pick<CanonicalStoredMessage, 'sourceCreateTime' | 'messageId'>,
      b: Pick<ArchiveWindowCursor, 'sourceCreateTime' | 'messageId'>,
    ) =>
      (a.sourceCreateTime ?? Infinity) - (b.sourceCreateTime ?? Infinity) ||
      a.messageId.localeCompare(b.messageId)
    const backwards = direction === 'older'
    return new Promise((resolve, reject) => {
      const ranked: CanonicalStoredMessage[] = []
      let count = 0
      const cursorRequest = db
        .transaction('canonicalMessages', 'readonly')
        .objectStore('canonicalMessages')
        .index('byConversation')
        .openCursor(IDBKeyRange.only(conversationKey))
      cursorRequest.onerror = () =>
        reject(cursorRequest.error ?? new Error('Canonical cursor failed'))
      cursorRequest.onsuccess = () => {
        if (signal?.aborted) {
          reject(new DOMException('Archive read cancelled', 'AbortError'))
          return
        }
        const cursor = cursorRequest.result
        if (!cursor) {
          const extra = count > 40
          resolve({
            rows: backwards ? ranked.slice(-40) : ranked.slice(0, 40),
            hasOlder: backwards ? extra : direction === 'newer' && !!before,
            hasNewer: backwards ? !!before : extra,
          })
          return
        }
        const row = cursor.value as CanonicalStoredMessage
        const diff = before ? compare(row, before) : 0
        if (!before || (backwards ? diff < 0 : direction === 'first' || diff > 0)) {
          count++
          // Top/bottom 41 only; avoid O(history size) arrays for 100k+ chats.
          const place = ranked.findIndex((candidate) => compare(row, candidate) < 0)
          ranked.splice(place < 0 ? ranked.length : place, 0, row)
          if (ranked.length > 41) {
            if (backwards) ranked.shift()
            else ranked.pop()
          }
        }
        cursor.continue()
      }
    })
  }

  async hasConversation(accountId: string, conversationId: string): Promise<boolean> {
    const generation = await this.active(accountId)
    if (!generation) return false
    const db = await this.store.canonicalDatabase()
    const row = await request<CanonicalStoredConversation | undefined>(
      db
        .transaction('canonicalConversations', 'readonly')
        .objectStore('canonicalConversations')
        .get(key(generation, key(accountId, conversationId))),
    )
    return row?.generation === generation && row.accountId === accountId
  }

  async threadWindow(
    accountId: string,
    conversationId: string,
    before: ArchiveWindowCursor | null = null,
    direction: 'older' | 'newer' | 'first' = 'older',
    signal?: AbortSignal,
    focus?: string,
  ): Promise<ArchiveThreadWindow> {
    if (signal?.aborted) throw new DOMException('Archive read cancelled', 'AbortError')
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Archive migration is not active')
    const db = await this.store.canonicalDatabase()
    const conversationKey = key(generation, key(accountId, conversationId))
    const point = (m: CanonicalStoredMessage) => ({
      sourceCreateTime: m.sourceCreateTime,
      messageId: m.messageId,
    })
    let rows: CanonicalStoredMessage[]
    let hasOlderStored = false
    let hasNewerStored = false
    let knownCount: number
    let unsequenced = false
    if (focus) {
      // Focused navigation must never getAll() an entire large conversation.
      const found = await request<CanonicalStoredMessage | undefined>(
        db
          .transaction('canonicalMessages', 'readonly')
          .objectStore('canonicalMessages')
          .get(key(conversationKey, focus)),
      )
      if (!found || found.generation !== generation || found.accountId !== accountId)
        throw new Error('archive.error.messageMissing')
      const compare = (a: CanonicalStoredMessage, b: CanonicalStoredMessage) =>
        (a.sourceCreateTime ?? Infinity) - (b.sourceCreateTime ?? Infinity) ||
        a.messageId.localeCompare(b.messageId)
      const older: CanonicalStoredMessage[] = []
      const newer: CanonicalStoredMessage[] = []
      let olderCount = 0,
        newerCount = 0
      unsequenced = false
      for await (const entry of scan(
        db,
        'canonicalMessages',
        'byConversation',
        conversationKey,
        16,
      )) {
        if (signal?.aborted) throw new DOMException('Archive read cancelled', 'AbortError')
        const row = entry as unknown as CanonicalStoredMessage
        if (row.sourceCreateTime === null) unsequenced = true
        const order = compare(row, found)
        if (order < 0) {
          olderCount++
          const position = older.findIndex((candidate) => compare(row, candidate) < 0)
          older.splice(position < 0 ? older.length : position, 0, row)
          if (older.length > 20) older.shift()
        } else if (order > 0) {
          newerCount++
          const position = newer.findIndex((candidate) => compare(row, candidate) < 0)
          newer.splice(position < 0 ? newer.length : position, 0, row)
          if (newer.length > 19) newer.pop()
        }
      }
      rows = [...older, found, ...newer]
      knownCount = olderCount + 1 + newerCount
      hasOlderStored = olderCount > older.length
      hasNewerStored = newerCount > newer.length
    } else {
      const tx = db.transaction('canonicalMessages', 'readonly')
      const table = tx.objectStore('canonicalMessages')
      const byConversation = table.index('byConversation')
      const chrono = table.index('byChronology')
      const done = finish(tx)
      const start = [conversationKey]
      const end = [conversationKey, []]
      let range: IDBKeyRange
      if (before?.sourceCreateTime !== null && before?.sourceCreateTime !== undefined) {
        const cursorPoint = [conversationKey, before.sourceCreateTime, before.messageId]
        range =
          direction === 'newer'
            ? IDBKeyRange.bound(cursorPoint, end, true, false)
            : IDBKeyRange.bound(start, cursorPoint, false, true)
      } else range = IDBKeyRange.bound(start, end)
      const backwards = direction !== 'first' && direction !== 'newer'
      const bounded = new Promise<CanonicalStoredMessage[]>((resolve, reject) => {
        const result: CanonicalStoredMessage[] = []
        const cursor = chrono.openCursor(range, backwards ? 'prev' : 'next')
        cursor.onerror = () => reject(cursor.error ?? new Error('Canonical cursor failed'))
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item || result.length >= 41) {
            resolve(result)
            return
          }
          result.push(item.value as CanonicalStoredMessage)
          if (result.length >= 41) resolve(result)
          else item.continue()
        }
      })
      const [total, timedCount, obtained] = await Promise.all([
        request<number>(byConversation.count(conversationKey)),
        request<number>(chrono.count(IDBKeyRange.bound(start, end))),
        bounded,
      ])
      await done
      knownCount = total
      unsequenced = total > timedCount
      const extra = obtained.length > 40
      rows = obtained.slice(0, 40)
      if (backwards) rows.reverse()
      hasOlderStored = backwards ? extra : !!before && direction === 'newer'
      hasNewerStored = backwards ? !!before : extra
      if (unsequenced) {
        // The chronological index excludes records with a null timestamp.
        // Fall back to an all-message cursor, never an unbounded getAll().
        const page = await this.#unsequencedWindow(db, conversationKey, before, direction, signal)
        rows = page.rows
        hasOlderStored = page.hasOlder
        hasNewerStored = page.hasNewer
      }
    }
    if (signal?.aborted) throw new DOMException('Archive read cancelled', 'AbortError')
    if ((await this.active(accountId)) !== generation)
      throw new Error('archive.error.sourceChanged')
    // Read only this bounded window's matching immutable source snapshots.
    // The native record is essential for model/tool/reasoning metadata and raw
    // inspection. Synthesizing a fake native raw loses that information.
    const snapshotsTx = db.transaction('sourceSnapshots', 'readonly')
    const snapshotsDone = finish(snapshotsTx)
    const snapshots = snapshotsTx.objectStore('sourceSnapshots')
    const records: ArchiveRecordView[] = await Promise.all(
      rows.map(async (row) => {
        const preferredSource = row.source ?? 'native'
        const snapshot = await request<CanonicalSourceSnapshot | undefined>(
          snapshots.get(key(row.key, preferredSource, row.sourceFingerprint)),
        )
        if (
          !snapshot ||
          snapshot.generation !== generation ||
          snapshot.fingerprint !== row.sourceFingerprint ||
          snapshot.messageKey !== row.key ||
          snapshot.raw.id !== row.messageId
        )
          throw new Error('archive.error.sourceChanged')
        const record = normalizeConversationMessage(snapshot.raw, conversationId, null, 0)
        if (!record) throw new Error('archive.error.sourceChanged')
        return { ...record, messageKey: row.projection.messageKey }
      }),
    )
    await snapshotsDone
    return {
      thread: buildArchiveThread(records, { unknownTimeLast: true }),
      source: 'saved',
      accountId,
      sourceRevision: null,
      sourceInstanceId: null,
      olderCursor: hasOlderStored && rows[0] ? point(rows[0]) : null,
      newerCursor:
        hasNewerStored && rows.length
          ? point(rows[rows.length - 1] as CanonicalStoredMessage)
          : null,
      hasOlderStored,
      hasNewerStored,
      loadedRecordCount: rows.length,
      totalKnownRecordCount: knownCount,
      hasUnsequencedRecords: unsequenced,
    }
  }

  /** Preview migrated local data independently from today's native adapter. */
  async preview(accountId: string, conversationId: string): Promise<ArchiveExportPreview> {
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Archive migration is not active')
    const db = await this.store.canonicalDatabase()
    const header = await request<CanonicalStoredConversation | undefined>(
      db
        .transaction('canonicalConversations', 'readonly')
        .objectStore('canonicalConversations')
        .get(key(generation, key(accountId, conversationId))),
    )
    if (!header || header.accountId !== accountId) throw new Error('Archive conversation missing')
    const [first, last] = await Promise.all([
      this.threadWindow(accountId, conversationId, null, 'first'),
      this.threadWindow(accountId, conversationId, null, 'older'),
    ])
    const mapWindow = (window: ArchiveThreadWindow) =>
      window.thread.turns
        .flatMap((turn) => [...turn.messages, ...turn.details])
        .map((item) => ({
          messageId: item.record.messageId,
          role: item.record.role,
          text: archiveRecordText(item.record).slice(0, 280),
        }))
    const earliest = mapWindow(first).slice(0, 3)
    const latest = mapWindow(last).slice(-3)
    const seen = new Set([...earliest, ...latest].map((item) => item.messageId))
    return {
      earliest,
      latest,
      hiddenKnownCount: Math.max(0, first.totalKnownRecordCount - seen.size),
      knownCount: first.totalKnownRecordCount,
      hasUnsequencedMessages: first.hasUnsequencedRecords,
      selectedTipId: header.currentNodeId,
      sourcePageContinuity: 'unknown',
      captureCoverage: 'unknown',
      latestHeadMatches: null,
    }
  }

  /** Stream known saved source snapshots in bounded batches. Never repeat the
   * same large tool response as a projected text field AND a native raw object.
   * A complete verified selected-path export is a separate capability. */
  async exportKnownRecords(
    accountId: string,
    conversationId: string,
    format: 'json' | 'markdown' | 'json-gzip' = 'json',
  ): Promise<Blob> {
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    const db = await this.store.canonicalDatabase()
    const conversationKey = key(generation, key(accountId, conversationId))
    const header = await request<CanonicalStoredConversation | undefined>(
      db
        .transaction('canonicalConversations', 'readonly')
        .objectStore('canonicalConversations')
        .get(conversationKey),
    )
    if (!header || header.accountId !== accountId || header.generation !== generation)
      throw new Error('Recovered conversation not found in active generation')
    const parts: BlobPart[] = []
    const markdown = format === 'markdown'
    parts.push(
      markdown
        ? `# ${header.title ?? 'Восстановленный архив'}\n\n> Неполная история: пагинация и выбранная ветка не подтверждены.\n\n`
        : JSON.stringify({
            archiveFormat: 'booster-recovery-unverified-v2',
            warning: 'Partial saved history: source pages and selected lineage unverified.',
            conversationId,
            canonicalModelVersion: 1,
            sourceOriginals: null,
          }).replace('"sourceOriginals":null}', '"sourceOriginals":['),
    )
    let buffered = ''
    let included = 0
    const flush = () => {
      if (buffered) parts.push(buffered)
      buffered = ''
    }
    for await (const source of scan(
      db,
      'canonicalMessages',
      'byConversation',
      conversationKey,
      16,
    )) {
      const row = source as unknown as CanonicalStoredMessage
      if (
        row.generation !== generation ||
        row.accountId !== accountId ||
        row.conversationId !== conversationId ||
        !row.messageId
      )
        throw new Error('Canonical source identity mismatch')
      const tx = db.transaction('sourceSnapshots', 'readonly')
      const stored = await request<CanonicalSourceSnapshot[]>(
        tx.objectStore('sourceSnapshots').index('byMessage').getAll(row.key),
      )
      const versions = stored.filter(
        (snap) =>
          snap.generation === generation &&
          snap.messageKey === row.key &&
          snap.raw.id === row.messageId,
      )
      if (!versions.some((snap) => snap.fingerprint === row.sourceFingerprint))
        throw new Error('Canonical source snapshot missing or mismatched')
      if (markdown) {
        const selected = versions.find(
          (snap) =>
            snap.fingerprint === row.sourceFingerprint && snap.source === (row.source ?? 'native'),
        )
        if (!selected) throw new Error('Canonical source snapshot missing')
        const record = normalizeConversationMessage(
          selected.raw,
          conversationId,
          header.projectId,
          0,
        )
        if (!record) throw new Error('Canonical source message malformed')
        const role = record.role ?? record.channel ?? 'unknown'
        buffered += `## ${role}\n\n${archiveRecordText(record)}\n\n`
      } else {
        // Equal fingerprints represent the same source JSON; preserve source
        // provenance labels without writing duplicate raw message bodies.
        const byFingerprint = new Map<
          string,
          { fingerprint: string; sources: string[]; raw: Row }
        >()
        for (const snap of versions) {
          const previous = byFingerprint.get(snap.fingerprint)
          if (previous) {
            if (!previous.sources.includes(snap.source)) previous.sources.push(snap.source)
          } else
            byFingerprint.set(snap.fingerprint, {
              fingerprint: snap.fingerprint,
              sources: [snap.source],
              raw: snap.raw,
            })
        }
        buffered +=
          (included ? ',' : '') +
          JSON.stringify({
            messageId: row.messageId,
            preferredFingerprint: row.sourceFingerprint,
            snapshots: [...byFingerprint.values()],
          })
      }
      included++
      if (buffered.length >= 256 * 1024) flush()
    }
    if (!included) throw new Error('No migrated records in the selected conversation')
    flush()
    if (!markdown) parts.push(']}')
    if ((await this.active(accountId)) !== generation)
      throw new Error('Archive generation changed during export')
    const blob = new Blob(parts, {
      type: markdown ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
    })
    return format === 'json-gzip' ? createGzipFromBlob(blob) : blob
  }
}
