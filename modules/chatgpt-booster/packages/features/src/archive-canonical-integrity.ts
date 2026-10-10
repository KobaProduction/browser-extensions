import { projectNativeMessage } from '@chatgpt-booster/core'
import { legacyV3OwnerEvidence } from './archive-migration-plan'
import { ARCHIVE_DB_NAME } from './archive-store'
import type { ArchiveV4Store } from './archive-v4-store'
import { canonicalSourceJson, sourceFingerprint } from './archive-v4-write'

type Row = Record<string, unknown>
const key = (...parts: string[]) => JSON.stringify(parts)
const object = (value: unknown): Row | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null
const read = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Archive integrity read failed'))
  })

export interface ArchiveIntegrityIssue {
  conversationId: string
  title: string | null
  source: 'v3' | 'v4'
  reason:
    | 'owner_unverified'
    | 'invalid_source'
    | 'missing_canonical'
    | 'wrong_preferred_source'
    | 'missing_snapshot'
    | 'modified_snapshot'
    | 'modified_projection'
  messages: number
}
export interface ArchiveIntegrityReport {
  kind: 'read_only_source_fingerprint_comparison'
  sourceRecords: number
  verifiedSourceRecords: number
  quarantinedSourceRecords: number
  invalidSourceRecords: number
  missingCanonicalRecords: number
  mismatchedPreferredRecords: number
  missingSnapshotRecords: number
  changedSnapshotRecords: number
  changedProjectionRecords: number
  issues: ArchiveIntegrityIssue[]
}

/** A manual read-only audit. Each source item and its canonical snapshot are
 * compared by message identity + SHA-256 + canonical content projection.
 * It does not infer page/branch completeness or manufacture owners. */
export async function auditCanonicalSourceIntegrity(
  store: ArchiveV4Store,
  accountId: string,
  generation: string,
): Promise<ArchiveIntegrityReport> {
  if (!accountId || !generation) throw new Error('Verified canonical account required')
  if (!navigator.locks?.request) throw new Error('Cross-tab archive lock is unavailable')
  return navigator.locks.request(
    'chatgpt-booster:canonical-migration-v1',
    { mode: 'shared' },
    async () => {
      const target = await store.canonicalDatabase()
      const exists = await indexedDB.databases()
      const legacy = exists.some((item) => item.name === ARCHIVE_DB_NAME)
        ? await new Promise<IDBDatabase>((resolve, reject) => {
            const opening = indexedDB.open(ARCHIVE_DB_NAME)
            opening.onsuccess = () => resolve(opening.result)
            opening.onerror = () =>
              reject(opening.error ?? new Error('Legacy audit source unavailable'))
            opening.onupgradeneeded = () => {
              opening.transaction?.abort()
              reject(new Error('Legacy audit may not create an empty database'))
            }
          })
        : null
      const report: ArchiveIntegrityReport = {
        kind: 'read_only_source_fingerprint_comparison',
        sourceRecords: 0,
        verifiedSourceRecords: 0,
        quarantinedSourceRecords: 0,
        invalidSourceRecords: 0,
        missingCanonicalRecords: 0,
        mismatchedPreferredRecords: 0,
        missingSnapshotRecords: 0,
        changedSnapshotRecords: 0,
        changedProjectionRecords: 0,
        issues: [],
      }
      const issues = new Map<string, ArchiveIntegrityIssue>()
      const problem = (
        conversationId: string,
        title: string | null,
        source: 'v3' | 'v4',
        reason: ArchiveIntegrityIssue['reason'],
      ) => {
        const id = key(conversationId, source, reason)
        const existing = issues.get(id)
        if (existing) existing.messages++
        else issues.set(id, { conversationId, title, source, reason, messages: 1 })
      }
      const checkSource = async (
        db: IDBDatabase,
        source: 'v3' | 'v4',
        id: string,
        title: string | null,
        ownerVerified: boolean,
      ) => {
        const query = source === 'v3' ? id : key(accountId, id)
        // Bounded cursor pages. The expensive hashes happen after the cursor has
        // yielded one page, never during a live IndexedDB transaction.
        let after: IDBValidKey | null = null
        while (true) {
          const batch = await new Promise<{ rows: Row[]; end: IDBValidKey | null }>(
            (resolve, reject) => {
              const rows: Row[] = []
              let end: IDBValidKey | null = null
              let jumped = false
              const cursor = db
                .transaction('messages', 'readonly')
                .objectStore('messages')
                .index(source === 'v3' ? 'conversationId' : 'byConversation')
                .openCursor(IDBKeyRange.only(query))
              cursor.onerror = () => reject(cursor.error ?? new Error('Source audit cursor failed'))
              cursor.onsuccess = () => {
                const item = cursor.result
                if (!item) {
                  resolve({ rows, end })
                  return
                }
                if (after !== null && !jumped) {
                  jumped = true
                  item.continuePrimaryKey(query, after)
                  return
                }
                if (after !== null && indexedDB.cmp(item.primaryKey, after) <= 0) {
                  item.continue()
                  return
                }
                rows.push(item.value as Row)
                end = item.primaryKey
                if (rows.length === 16) resolve({ rows, end })
                else item.continue()
              }
            },
          )
          for (const item of batch.rows) {
            report.sourceRecords++
            const raw = object(item.raw)
            if (!raw || typeof raw.id !== 'string' || !raw.id) {
              report.invalidSourceRecords++
              problem(id, title, source, 'invalid_source')
              continue
            }
            const cid = key(generation, key(accountId, id))
            const messageKey = key(cid, raw.id)
            const canonical = await read<Row | undefined>(
              target
                .transaction('canonicalMessages', 'readonly')
                .objectStore('canonicalMessages')
                .get(messageKey),
            )
            try {
              // Never infer a legacy v3 owner from a matching v4 chat ID.
              // An existing v3 SourceSnapshot is evidence of a previous
              // explicit per-conversation account-binding decision.
              if (!ownerVerified && !(canonical && canonical.source === 'legacy_v3')) {
                const v3Copies = canonical
                  ? await read<Row[]>(
                      target
                        .transaction('sourceSnapshots', 'readonly')
                        .objectStore('sourceSnapshots')
                        .index('byMessage')
                        .getAll(messageKey),
                    )
                  : []
                if (
                  !v3Copies.some(
                    (copy) => copy.source === 'legacy_v3' && copy.generation === generation,
                  )
                ) {
                  report.quarantinedSourceRecords++
                  problem(id, title, source, 'owner_unverified')
                  continue
                }
              }
              if (!canonical) {
                report.missingCanonicalRecords++
                problem(id, title, source, 'missing_canonical')
                continue
              }
              const originalJson = canonicalSourceJson(raw)
              const fingerprint = await sourceFingerprint(originalJson)
              // Current native capture uses source='native'. A migrated v4
              // snapshot uses source='legacy_v4'. Both correspond to the v4
              // source store and neither must generate a false missing alert.
              const sourceCandidates = source === 'v3' ? ['legacy_v3'] : ['legacy_v4', 'native']
              let snapshot: Row | undefined
              for (const snapSource of sourceCandidates) {
                snapshot = await read<Row | undefined>(
                  target
                    .transaction('sourceSnapshots', 'readonly')
                    .objectStore('sourceSnapshots')
                    .get(key(messageKey, snapSource, fingerprint)),
                )
                if (snapshot) break
              }
              if (!snapshot) {
                report.missingSnapshotRecords++
                problem(id, title, source, 'missing_snapshot')
                continue
              }
              if (
                snapshot.generation !== generation ||
                snapshot.messageKey !== messageKey ||
                snapshot.fingerprint !== fingerprint ||
                canonicalSourceJson(snapshot.raw) !== originalJson
              ) {
                report.changedSnapshotRecords++
                problem(id, title, source, 'modified_snapshot')
                continue
              }
              if (sourceCandidates.includes(String(canonical.source))) {
                if (canonical.sourceFingerprint !== fingerprint) {
                  report.mismatchedPreferredRecords++
                  problem(id, title, source, 'wrong_preferred_source')
                  continue
                }
                const expected = projectNativeMessage(raw, { accountId, conversationId: id })
                if (canonicalSourceJson(canonical.projection) !== canonicalSourceJson(expected)) {
                  report.changedProjectionRecords++
                  problem(id, title, source, 'modified_projection')
                  continue
                }
              }
              report.verifiedSourceRecords++
            } catch {
              report.invalidSourceRecords++
              problem(id, title, source, 'invalid_source')
            }
          }
          if (batch.rows.length < 16 || batch.end === null) break
          after = batch.end
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      }
      try {
        if (legacy) {
          const headers = await read<Row[]>(
            legacy.transaction('conversations', 'readonly').objectStore('conversations').getAll(),
          )
          for (const header of headers) {
            if (typeof header.conversationId !== 'string' || !header.conversationId) continue
            await checkSource(
              legacy,
              'v3',
              header.conversationId,
              typeof header.title === 'string' ? header.title : null,
              legacyV3OwnerEvidence(header, accountId).status === 'verified',
            )
          }
        }
        const v4 = await read<Row[]>(
          target
            .transaction('conversations', 'readonly')
            .objectStore('conversations')
            .index('byAccount')
            .getAll(accountId),
        )
        for (const header of v4) {
          if (typeof header.conversationId !== 'string' || !header.conversationId) continue
          await checkSource(
            target,
            'v4',
            header.conversationId,
            typeof header.title === 'string' ? header.title : null,
            true,
          )
        }
        const latest = await read<Row | undefined>(
          target
            .transaction('migrationManifest', 'readonly')
            .objectStore('migrationManifest')
            .get(key(accountId)),
        )
        const active = latest?.status === 'ready' ? latest.generation : latest?.previousGeneration
        if (active !== generation) throw new Error('Canonical generation changed during audit')
        report.issues = [...issues.values()].sort((a, b) => b.messages - a.messages)
        return report
      } finally {
        legacy?.close()
      }
    },
  )
}
