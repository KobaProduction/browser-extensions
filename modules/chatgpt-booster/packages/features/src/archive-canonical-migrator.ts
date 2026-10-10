import { ArchiveCanonicalAudit, type ArchiveCoverageAudit, type ArchiveOwnerSkipInspection, type LegacySkipReason, type LegacySkippedConversation } from './archive-canonical-audit'
export type { ArchiveCoverageAudit, ArchiveOwnerSkipInspection, LegacySkipReason, LegacySkippedConversation } from './archive-canonical-audit'
import { ArchiveCanonicalReader } from './archive-canonical-reader'
import type { CanonicalStoredConversation, CanonicalStoredMessage, CanonicalSourceSnapshot } from './archive-canonical-model'
export type { CanonicalStoredConversation, CanonicalStoredMessage, CanonicalSourceSnapshot } from './archive-canonical-model'
import { requestResult as request, transactionComplete as finish } from '@kobaproduction/browser-storage'
import { type Row, object, scan, scanBatches, scanRecent, existingSource } from './archive-canonical-source-reader'
import { exportNativeSourceBackup, importNativeSourceBackup } from './archive-source-transfer'
import { archiveCompositeKey } from '@kobaproduction/browser-archive'
import { projectNativeMessage } from '@chatgpt-booster/core'
import type {
  ArchiveExportPreview,
  ArchiveThreadWindow,
  ArchiveWindowCursor,
} from '@chatgpt-booster/ui'
import { exportCanonicalBackup, restoreCanonicalBackup, undoCanonicalBackupRestore } from './archive-canonical-backup'
import type { ArchiveIntegrityReport } from './archive-canonical-integrity'
import { auditCanonicalSourceIntegrity } from './archive-canonical-integrity'
import { legacyV3OwnerEvidence } from './archive-migration-plan'
import { ARCHIVE_DB_NAME } from './archive-store'
import type { ArchiveV4Store } from './archive-v4-store'
import { canonicalSourceJson, sourceFingerprint } from './archive-v4-write'

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
  readonly #reader: ArchiveCanonicalReader
  readonly #audit: ArchiveCanonicalAudit
  constructor(private readonly store: ArchiveV4Store) {
    this.#reader = new ArchiveCanonicalReader(store, (accountId) => this.active(accountId))
    this.#audit = new ArchiveCanonicalAudit(store, (accountId) => this.active(accountId), (accountId) => this.listConversations(accountId))
  }
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

  async auditCoverage(accountId: string): Promise<ArchiveCoverageAudit> {
    return this.#audit.auditCoverage(accountId)
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
          this.#audit.inspectSkippedRecent(accountId, sinceMs, quickAfterLastImport),
        )
      : this.#audit.inspectSkippedRecent(accountId, sinceMs, quickAfterLastImport)
  }

  async inspectSkippedAll(accountId: string): Promise<ArchiveOwnerSkipInspection> {
    return this.#audit.inspectSkippedAll(accountId)
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

  // Stable public facade: migration orchestration no longer owns read/query/export implementations.
  async listConversations(accountId: string): Promise<CanonicalStoredConversation[]> {
    return this.#reader.listConversations(accountId)
  }

  async readMessages(accountId: string, conversationId: string): Promise<CanonicalStoredMessage[]> {
    return this.#reader.readMessages(accountId, conversationId)
  }

  async conversationCounts(accountId: string, conversationId: string) {
    return this.#reader.conversationCounts(accountId, conversationId)
  }

  async hasConversation(accountId: string, conversationId: string): Promise<boolean> {
    return this.#reader.hasConversation(accountId, conversationId)
  }

  async threadWindow(
    accountId: string,
    conversationId: string,
    before: ArchiveWindowCursor | null = null,
    direction: 'older' | 'newer' | 'first' = 'older',
    signal?: AbortSignal,
    focus?: string,
  ): Promise<ArchiveThreadWindow> {
    return this.#reader.threadWindow(accountId, conversationId, before, direction, signal, focus)
  }

  async preview(accountId: string, conversationId: string): Promise<ArchiveExportPreview> {
    return this.#reader.preview(accountId, conversationId)
  }

  async exportKnownRecords(
    accountId: string,
    conversationId: string,
    format: 'json' | 'markdown' | 'json-gzip' = 'json',
  ): Promise<Blob> {
    return this.#reader.exportKnownRecords(accountId, conversationId, format)
  }

}
