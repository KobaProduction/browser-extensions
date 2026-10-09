import { buildArchiveThread } from '@chatgpt-booster/chatgpt'
import {
  type ArchiveRecordView,
  type CanonicalMessageProjection,
  projectNativeMessage,
} from '@chatgpt-booster/core'
import type { ArchiveThreadWindow, ArchiveWindowCursor } from '@chatgpt-booster/ui'
import { legacyV3OwnerEvidence } from './archive-migration-plan'
import { ARCHIVE_DB_NAME } from './archive-store'
import type { ArchiveV4Store } from './archive-v4-store'
import { canonicalSourceJson, sourceFingerprint } from './archive-v4-write'

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
const key = (...parts: string[]) => JSON.stringify(parts)
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
async function* scan(db: IDBDatabase, table: string, index: string, query: IDBValidKey) {
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
          if (rows.length >= 128) {
            resolve({ rows, last })
            return
          }
          cursor.continue()
        }
      },
    )
    if (!batch.rows.length) return
    for (const row of batch.rows) yield row
    if (batch.rows.length < 128 || batch.last === null) return
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

export interface ArchiveReconciliationReport {
  readonly sinceMs: number
  readonly effectiveSinceMs: number
  readonly checkpointApplied: boolean
  readonly examined: number
  readonly inserted: number
  readonly changed: number
  readonly unchanged: number
  readonly skippedOwnership: number
  readonly conversationsTouched: number
}
export interface ArchiveCoverageAudit {
  readonly legacyConversations: number
  readonly canonicalConversations: number
  readonly conversationCountShortfall: number
  readonly conversationsWithMessageShortfall: number
  readonly sourceMessageCount: number
  readonly canonicalMessageCount: number
  /** Counts are structural, not a byte-for-byte content fingerprint audit. */
  readonly kind: 'count_only_read_only'
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
    return row?.status === 'ready' && typeof row.generation === 'string' ? row.generation : null
  }
  async migrate(accountId: string, bindUnowned: boolean): Promise<void> {
    if (!accountId.trim()) throw new Error('Verified account required')
    if (this.#pending) return this.#pending
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
          !conversations ||
          !messages ||
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

  /** Count-only coverage audit: never loads or writes a saved message body. */
  async auditCoverage(accountId: string): Promise<ArchiveCoverageAudit> {
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    const legacy = await existingSource(ARCHIVE_DB_NAME)
    const target = await this.store.canonicalDatabase()
    const current = await this.listConversations(accountId)
    const canonicalIds = new Set(current.map((row) => row.conversationId))
    if (!legacy)
      return {
        kind: 'count_only_read_only',
        legacyConversations: 0,
        canonicalConversations: current.length,
        conversationCountShortfall: 0,
        conversationsWithMessageShortfall: 0,
        sourceMessageCount: 0,
        canonicalMessageCount: 0,
      }
    try {
      const requestHeaders = legacy
        .transaction('conversations', 'readonly')
        .objectStore('conversations')
        .getAll()
      const headers = await request<Row[]>(requestHeaders)
      let missing = 0
      let less = 0
      let sourceMessages = 0
      let destinationMessages = 0
      // Indexed counts avoid decoding 100k+ native objects.
      for (const header of headers) {
        const id = header.conversationId
        if (typeof id !== 'string' || !id) continue
        if (!canonicalIds.has(id)) missing++
        const readLegacy = legacy
          .transaction('messages', 'readonly')
          .objectStore('messages')
          .index('conversationId')
          .count(id)
        const readCanonical = target
          .transaction('canonicalMessages', 'readonly')
          .objectStore('canonicalMessages')
          .index('byConversation')
          .count(key(generation, key(accountId, id)))
        const [before, after] = await Promise.all([
          request<number>(readLegacy),
          request<number>(readCanonical),
        ])
        sourceMessages += before
        destinationMessages += after
        if (after < before) less++
      }
      return {
        kind: 'count_only_read_only',
        legacyConversations: headers.length,
        canonicalConversations: current.length,
        conversationCountShortfall: missing,
        conversationsWithMessageShortfall: less,
        sourceMessageCount: sourceMessages,
        canonicalMessageCount: destinationMessages,
      }
    } finally {
      legacy.close()
    }
  }

  /**
   * Fast opt-in reconciliation of recent v3/v4 writes only. The existing
   * verified generation stays active; each bounded batch is atomic, retryable,
   * and idempotent. Unsupported account ownership never auto-binds.
   */
  async reconcileRecent(
    accountId: string,
    sinceMs: number,
    bindUnknownLegacy = false,
    quickAfterLastImport = false,
  ): Promise<ArchiveReconciliationReport> {
    if (
      !accountId.trim() ||
      !Number.isSafeInteger(sinceMs) ||
      sinceMs > Date.now() ||
      sinceMs < Date.now() - 30 * 86_400_000
    )
      throw new Error('Invalid archive reconciliation scope')
    if (this.#pending) throw new Error('Archive migration is already running')
    const work = this.#reconcileRecentLocked(
      accountId,
      sinceMs,
      bindUnknownLegacy,
      quickAfterLastImport,
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
    bindUnknownLegacy: boolean,
    quickAfterLastImport: boolean,
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
          quickAfterLastImport && checkpoint !== null
            ? Math.max(sinceMs, checkpoint - 15 * 60_000)
            : sinceMs
        const v3 = await existingSource(ARCHIVE_DB_NAME)
        const changed = {
          sinceMs,
          effectiveSinceMs,
          checkpointApplied: effectiveSinceMs > sinceMs,
          examined: 0,
          inserted: 0,
          changed: 0,
          unchanged: 0,
          skippedOwnership: 0,
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
              if (
                !active.has(cid) &&
                source === 'legacy_v3' &&
                legacyV3OwnerEvidence(header, accountId).status !== 'verified' &&
                !bindUnknownLegacy
              )
                return null
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
            for await (const rows of scanRecent(
              v3,
              'messages',
              'lastSeenAt',
              effectiveSinceMs,
              until,
            ))
              await writeBatch(rows, 'legacy_v3', byId)
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
            if (typeof h.lastSeenAt !== 'number' || h.lastSeenAt < effectiveSinceMs) continue
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
      const entries = await this.readMessages(accountId, conversationId)
      const index = entries.findIndex((m) => m.messageId === focus)
      if (index < 0) throw new Error('archive.error.messageMissing')
      const start = Math.max(0, index - 20)
      rows = entries.slice(start, start + 40)
      knownCount = entries.length
      hasOlderStored = start > 0
      hasNewerStored = start + 40 < entries.length
      unsequenced = entries.some((m) => m.sourceCreateTime === null)
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
    }
    if (signal?.aborted) throw new DOMException('Archive read cancelled', 'AbortError')
    if ((await this.active(accountId)) !== generation)
      throw new Error('archive.error.sourceChanged')
    const records: ArchiveRecordView[] = rows.map((row) => {
      const p = row.projection
      const text = p.elements
        .filter((e) => e.kind === 'text' || e.kind === 'code')
        .map((e) => e.text ?? '')
        .join('\n')
      const kind = p.elements[0]?.kind
      return {
        messageKey: p.messageKey,
        conversationId,
        messageId: p.messageId,
        role: p.role,
        channel: p.channel,
        recipient: p.recipient,
        contentType: kind === 'code' ? 'code' : 'text',
        messageType: null,
        status: null,
        modelSlug: null,
        parentId: p.parentMessageId,
        turnExchangeId: null,
        createTime: p.sourceCreateTime,
        updateTime: p.sourceUpdateTime,
        raw: {
          content: { content_type: 'text', parts: [text] },
          author: { role: p.role },
          metadata: { parent_id: p.parentMessageId },
        },
      }
    })
    return {
      thread: buildArchiveThread(records),
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

  async exportKnownRecords(
    accountId: string,
    conversationId: string,
    format: 'json' | 'markdown' = 'json',
  ): Promise<Blob> {
    const rows = await this.readMessages(accountId, conversationId)
    if (!rows.length) throw new Error('No migrated records in the selected conversation')
    if (format === 'markdown') {
      const lines = [
        '# Восстановленный архив (неполная история)',
        '',
        '> Полнота пагинации и выбранной цепочки не подтверждена.',
        '> Исходные записи без потерь доступны в техническом JSON.',
        '',
      ]
      for (const row of rows) {
        const projection = row.projection
        lines.push('## ' + (projection.role ?? 'unknown'), '')
        for (const element of projection.elements.slice(1))
          lines.push(element.text ?? '[Неподдерживаемый элемент сохранён в JSON]', '')
      }
      return new Blob([lines.join('\n')], { type: 'text/markdown' })
    }
    const db = await this.store.canonicalDatabase()
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Archive migration is not active')
    const snapshots: { messageId: string; raw: Record<string, unknown>; source: string }[] = []
    for (const m of rows) {
      const tx = db.transaction('sourceSnapshots', 'readonly')
      const all = await request<CanonicalSourceSnapshot[]>(
        tx.objectStore('sourceSnapshots').index('byMessage').getAll(m.key),
      )
      for (const source of all)
        if (source.generation === generation)
          snapshots.push({ messageId: m.messageId, raw: source.raw, source: source.source })
    }
    return new Blob(
      [
        JSON.stringify(
          {
            archiveFormat: 'booster-recovery-unverified-v1',
            warning: 'Partial recovered archive. Pagination and selected lineage are not verified.',
            conversationId,
            canonicalModelVersion: 1,
            records: rows.map((m) => m.projection),
            sourceSnapshots: snapshots,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
  }
}
