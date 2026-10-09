import { legacyV3OwnerEvidence } from './archive-migration-plan'
import { ARCHIVE_DB_NAME } from './archive-store'
import { ARCHIVE_V4_DB_NAME } from './archive-v4-store'

export interface ArchiveLegacyInventory {
  readonly namespace: 'v3' | 'v4'
  readonly present: boolean
  readonly physicalVersion: number | null
  readonly conversations: number
  readonly messages: number
  /** Null means a large source was counted, not exhaustively decoded. */
  readonly originalRecordsMissing: number | null
  readonly verifiedOwnerConversations: number
  readonly unboundOwnerConversations: number
  readonly conflictingOwnerConversations: number
}

export interface ArchiveMigrationPreflight {
  readonly kind: 'non_authoritative_read_only_inventory'
  /** No data is copied, deleted, linked or marked verified by this report. */
  readonly sources: readonly ArchiveLegacyInventory[]
  readonly needsOwnerBinding: boolean
  /** Null means that large legacy message bodies were not checked yet. */
  readonly sourceRecordDefects: boolean | null
}

/** Iterate without materializing message bodies or emitting source identifiers. */
async function scanRows(
  tx: IDBTransaction,
  table: string,
  inspect: (row: Record<string, unknown>) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cursor = tx.objectStore(table).openCursor()
    cursor.onsuccess = () => {
      const item = cursor.result
      if (!item) {
        resolve()
        return
      }
      const value = item.value
      if (value && typeof value === 'object' && !Array.isArray(value))
        inspect(value as Record<string, unknown>)
      else reject(new Error('Legacy archive row shape unrecognized'))
      if (value && typeof value === 'object' && !Array.isArray(value)) item.continue()
    }
    cursor.onerror = () => reject(cursor.error ?? new Error('Legacy archive cursor failed'))
  })
}

function requestCount(store: IDBObjectStore): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = store.count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Legacy archive count failed'))
  })
}

function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Legacy archive open failed'))
    req.onupgradeneeded = () => {
      // A missing name must never be created by a supposedly read-only audit.
      req.transaction?.abort()
      reject(new Error('Legacy archive missing during preflight'))
    }
    req.onblocked = () => reject(new Error('Legacy archive blocked during preflight'))
  })
}

async function inspectSource(
  factory: IDBFactory,
  namespace: 'v3' | 'v4',
  name: string,
  verifiedAccountId: string,
  exists: boolean,
): Promise<ArchiveLegacyInventory> {
  const summary = {
    namespace,
    present: exists,
    physicalVersion: null as number | null,
    conversations: 0,
    messages: 0,
    originalRecordsMissing: 0 as number | null,
    verifiedOwnerConversations: 0,
    unboundOwnerConversations: 0,
    conflictingOwnerConversations: 0,
  }
  if (!exists) return summary
  const db = await openExisting(factory, name)
  try {
    summary.physicalVersion = db.version
    if (!db.objectStoreNames.contains('conversations') || !db.objectStoreNames.contains('messages'))
      throw new Error('Legacy archive schema unrecognized')
    // Count first in a separate short-lived transaction. Keeping a transaction
    // open across an await before its cursors are scheduled risks it closing.
    const messageCount = await requestCount(
      db.transaction('messages', 'readonly').objectStore('messages'),
    )
    summary.messages = messageCount
    if (messageCount > 2048) summary.originalRecordsMissing = null
    const tx = db.transaction(['conversations', 'messages'], 'readonly')
    // Subscribe before the final cursor request can complete the IDB transaction.
    const settled = new Promise<void>((resolve, reject) => {
      tx.addEventListener('complete', () => resolve(), { once: true })
      tx.addEventListener(
        'abort',
        () => reject(tx.error ?? new Error('Legacy archive read aborted')),
        { once: true },
      )
      tx.addEventListener(
        'error',
        () => reject(tx.error ?? new Error('Legacy archive read error')),
        { once: true },
      )
    })
    // Count large message stores in IndexedDB without materializing every raw
    // ChatGPT object into page JavaScript. A user's legacy archive may contain
    // hundreds of thousands of records; exhaustive inspection belongs inside
    // the staged migration with bounded cursors and recoverable checkpoints.
    const counts = [
      scanRows(tx, 'conversations', (row) => {
        summary.conversations++
        if (namespace === 'v3') {
          const owner = legacyV3OwnerEvidence(row, verifiedAccountId)
          if (owner.status === 'verified') summary.verifiedOwnerConversations++
          else if (owner.status === 'mismatch') summary.conflictingOwnerConversations++
          else summary.unboundOwnerConversations++
        } else if (row.accountId === verifiedAccountId) summary.verifiedOwnerConversations++
        else if (typeof row.accountId !== 'string') summary.unboundOwnerConversations++
      }),
      ...(messageCount <= 2048
        ? [
            scanRows(tx, 'messages', (row) => {
              if (!row.raw || typeof row.raw !== 'object' || Array.isArray(row.raw))
                summary.originalRecordsMissing = (summary.originalRecordsMissing ?? 0) + 1
            }),
          ]
        : []),
    ]
    await Promise.all([...counts, settled])
    return summary
  } finally {
    db.close()
  }
}

/**
 * Browser-side preflight only. No store upgrades, backfills or migrations.
 * A final import must re-read and fence all sources against concurrent writes.
 */
export async function inspectExistingArchiveForMigration(
  verifiedAccountId: string,
  factory: IDBFactory = indexedDB,
): Promise<ArchiveMigrationPreflight> {
  if (!verifiedAccountId) throw new Error('Verified archive owner required')
  if (typeof factory.databases !== 'function')
    throw new Error('Non-mutating database discovery unavailable')
  const known = new Set((await factory.databases()).map((entry) => entry.name))
  const sources = await Promise.all([
    inspectSource(factory, 'v3', ARCHIVE_DB_NAME, verifiedAccountId, known.has(ARCHIVE_DB_NAME)),
    inspectSource(
      factory,
      'v4',
      ARCHIVE_V4_DB_NAME,
      verifiedAccountId,
      known.has(ARCHIVE_V4_DB_NAME),
    ),
  ])
  return {
    kind: 'non_authoritative_read_only_inventory',
    sources,
    needsOwnerBinding: sources.some(
      (source) => source.unboundOwnerConversations > 0 || source.conflictingOwnerConversations > 0,
    ),
    sourceRecordDefects: sources.some((source) => source.originalRecordsMissing === null)
      ? null
      : sources.some((source) => (source.originalRecordsMissing ?? 0) > 0),
  }
}
