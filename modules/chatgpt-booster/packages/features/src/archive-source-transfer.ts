import { archiveSha256Hex, createGzipFromChunks, encodeArchiveClone, decodeArchiveClone } from '@kobaproduction/browser-archive'
import { ARCHIVE_DB_NAME, ARCHIVE_DB_VERSION, ConversationArchiveStore } from './archive-store'
import { ARCHIVE_V4_DB_NAME, type ArchiveV4Store } from './archive-v4-store'

const VERSION = 'booster-native-source-transfer-v2'
const LEGACY_VERSION = 'booster-native-source-transfer-v1'
const SOURCE_STORES = {
  v3: ['conversations', 'messages', 'conversationPages', 'conversationCoverage',
    'projects', 'assets', 'preloadPages'],
  v4: ['projects', 'conversations', 'messages', 'metadata'],
} as const
export type SourceKind = keyof typeof SOURCE_STORES
type RecordRow = { kind: 'record'; source: SourceKind; table: string; value: unknown; encoding?: 'structured' }
type DataRow = Record<string, unknown>
type Totals = Record<string, number>
const read = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('Native source transfer failed'))
})
const committed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onabort = () => reject(tx.error ?? new Error('Native source transfer write aborted'))
})
function record(value: unknown): DataRow {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Native source backup row must be an object')
  return value as DataRow
}
function allowed(source: unknown, table: unknown): source is SourceKind {
  return (source === 'v3' || source === 'v4') && typeof table === 'string' &&
    (SOURCE_STORES[source] as readonly string[]).includes(table)
}
function assertJsonSafe(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || seen.has(value))
    throw new Error('Native source contains unsupported non-JSON or cyclic data')
  if (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null && !Array.isArray(value))
    throw new Error('Native source contains non-JSON binary or special object data')
  seen.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) throw new Error('Sparse native source array cannot be copied safely')
      assertJsonSafe(value[i], seen)
    }
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (!key) continue
      assertJsonSafe(item, seen)
    }
  }
  seen.delete(value)
}

async function existing(name: string): Promise<IDBDatabase | null> {
  if (!(await indexedDB.databases()).some(entry => entry.name === name)) return null
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Native source unavailable'))
    request.onupgradeneeded = () => {
      request.transaction?.abort()
      reject(new Error('Read-only backup must not create absent databases'))
    }
  })
}

async function* scan(db: IDBDatabase, table: string): AsyncGenerator<DataRow> {
  let after: IDBValidKey | undefined
  while (true) {
    const batch = await new Promise<{ values: DataRow[]; last?: IDBValidKey }>((resolve, reject) => {
      const values: DataRow[] = []
      let last: IDBValidKey | undefined
      const request = db.transaction(table, 'readonly').objectStore(table)
        .openCursor(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true))
      request.onerror = () => reject(request.error ?? new Error('Native source cursor failed'))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || values.length >= 32) { resolve({ values, last }); return }
        values.push(record(cursor.value))
        last = cursor.primaryKey
        if (values.length >= 32) resolve({ values, last })
        else cursor.continue()
      }
    })
    for (const row of batch.values) yield row
    if (batch.values.length < 32 || batch.last === undefined) return
    after = batch.last
  }
}

/** Explicit source preservation. Owner-unverified v3 rows remain unbound; all
 * v4 account identities remain exactly as captured. Binary IDB values abort
 * export rather than silently producing a lossy backup. */
export async function exportNativeSourceBackup(
  store: ArchiveV4Store, verifiedAccount: string,
): Promise<Blob> {
  if (!verifiedAccount || !navigator.locks?.request)
    throw new Error('Verified account and cross-tab archive lock required')
  return navigator.locks.request('chatgpt-booster:native-source-transfer-v1', { mode:'shared' }, async () => {
    const v3 = await existing(ARCHIVE_DB_NAME)
    const v4 = await store.canonicalDatabase()
    let checksum = 'start'
    const totals: Totals = {}
    const encode = async (row: DataRow, footer = false) => {
      assertJsonSafe(row)
      const line = JSON.stringify(row)
      if (!footer) checksum = await archiveSha256Hex(checksum + '\n' + line)
      return new TextEncoder().encode(line + '\n')
    }
    const records = async function* () {
      yield await encode({ kind: 'header', schema: VERSION, accountId: verifiedAccount,
        scope: 'all_local_sources_without_owner_rebinding', v3Version: v3?.version ?? null,
        includesCanonical: false, includesBinary: true })
      for (const [source, db] of [['v3', v3], ['v4', v4]] as const) {
        if (!db) continue
        for (const table of SOURCE_STORES[source]) {
          if (!db.objectStoreNames.contains(table)) continue
          const name = `${source}/${table}`
          totals[name] = 0
          for await (const value of scan(db, table)) {
            let row: RecordRow = { kind: 'record', source, table, value }
            try { assertJsonSafe(value) }
            catch {
              row = { kind: 'record', source, table, encoding: 'structured',
                value: await encodeArchiveClone(value) }
            }
            yield await encode(row)
            totals[name]++
          }
        }
      }
      yield await encode({ kind: 'footer', schema: VERSION, totals, checksum }, true)
    }
    try { return await createGzipFromChunks(records()) }
    finally { v3?.close() }
  })
}

export interface SourceImportResult { inserted: number; identical: number; tables: Totals }
/** Two-pass import: verify the entire compressed file before any IDB write.
 * Conflict detection never overwrites existing rows. Partial I/O failures are
 * idempotently retryable and cannot silently reassign a legacy owner. */
export async function importNativeSourceBackup(
  store: ArchiveV4Store,
  accountId: string,
  compressed: Blob,
  stillAuthorized: () => boolean = () => true,
): Promise<SourceImportResult> {
  if (!accountId || !stillAuthorized() || !navigator.locks?.request)
    throw new Error('Verified account required for native source import')
  return navigator.locks.request('chatgpt-booster:native-source-transfer-v1', { mode: 'exclusive' }, async () => {
    const visit = async (onRow: (row: DataRow) => Promise<void>) => {
      const reader = compressed.stream().pipeThrough(new DecompressionStream('gzip')).getReader()
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let tail = ''
      try {
        while (true) {
          if (!stillAuthorized()) throw new Error('Account changed during native import')
          const next = await reader.read()
          if (next.done) break
          tail += decoder.decode(next.value, { stream: true })
          if (tail.length > 256 * 1024 * 1024)
            throw new Error('Native source row exceeds safety limit')
          let lineBreak = tail.indexOf('\n')
          while (lineBreak !== -1) {
            const line = tail.slice(0, lineBreak)
            tail = tail.slice(lineBreak + 1)
            if (line) await onRow(record(JSON.parse(line)))
            lineBreak = tail.indexOf('\n')
          }
        }
        tail += decoder.decode()
        if (tail) throw new Error('Native source backup is truncated')
      } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
    }
    let digest = 'start', header = false, completed = false
    let fileSchema: string | null = null
    const totals: Totals = {}
    await visit(async (row) => {
      if (completed) throw new Error('Unexpected data after native source footer')
      if (row.kind === 'footer') {
        const declared = record(row.totals)
        const validCounts = Object.entries(declared).every(([name, value]) =>
          /^(v3|v4)\/[a-zA-Z]+$/.test(name) &&
          Number.isSafeInteger(value) && (value as number) >= 0 &&
          (totals[name] ?? 0) === value,
        ) && Object.keys(totals).every(name => Object.hasOwn(declared, name))
        if (!header || row.schema !== fileSchema || row.checksum !== digest || !validCounts)
          throw new Error('Native source checksum or row counts do not match')
        completed = true
        return
      }
      digest = await archiveSha256Hex(digest + '\n' + JSON.stringify(row))
      if (row.kind === 'header') {
        if (header || (row.schema !== VERSION && row.schema !== LEGACY_VERSION) ||
            row.accountId !== accountId || row.scope !== 'all_local_sources_without_owner_rebinding' ||
            row.includesCanonical !== false)
          throw new Error('Native source backup account or schema differs')
        fileSchema = row.schema as string
        header = true
        return
      }
      if (!header || row.kind !== 'record' || !allowed(row.source, row.table))
        throw new Error('Invalid native source backup table')
      if (row.encoding === 'structured') {
        if (fileSchema !== VERSION) throw new Error('Unsupported native source encoding')
        record(decodeArchiveClone(row.value))
      } else if (row.encoding !== undefined) throw new Error('Unknown native source encoding')
      else assertJsonSafe(row.value)
      const name = `${row.source}/${row.table}`
      totals[name] = (totals[name] ?? 0) + 1
    })
    if (!completed) throw new Error('Native source backup footer is missing')
    if (!stillAuthorized()) throw new Error('Archive account changed before import')
    // Create the exact historical schemas using their original adapters;
    // never invent a parallel IndexedDB schema or remove existing data.
    if (Object.keys(totals).some(table => table.startsWith('v3/'))) {
      const old = await existing(ARCHIVE_DB_NAME)
      const incompatible = old !== null && old.version > 0 && old.version < 2
      old?.close()
      if (incompatible) throw new Error('Legacy source v1 must be migrated before restoration')
      await new ConversationArchiveStore().warmup()
    }
    await store.warmup()
    const v3 = await existing(ARCHIVE_DB_NAME)
    const v4 = await store.canonicalDatabase()
    const result: SourceImportResult = { inserted: 0, identical: 0, tables: { ...totals } }
    const target = (row: DataRow) => {
      if (!allowed(row.source, row.table)) throw new Error('Invalid source store')
      const db = row.source === 'v3' ? v3 : v4
      const storeName = row.table as string
      if (!db || !db.objectStoreNames.contains(storeName))
        throw new Error('Source store is unavailable in this browser')
      const value = record(row.encoding === 'structured' ? decodeArchiveClone(row.value) : row.value)
      const path = db.transaction(storeName, 'readonly').objectStore(storeName).keyPath
      if (typeof path !== 'string' || !Object.hasOwn(value, path))
        throw new Error('Source record identity missing')
      return { db, storeName, value, key: value[path] as IDBValidKey }
    }
    const verifyExisting = async (row: DataRow) => {
      if (row.kind !== 'record') return
      const { db, storeName, value, key } = target(row)
      const previous = await read<unknown>(db.transaction(storeName, 'readonly')
        .objectStore(storeName).get(key))
      if (previous !== undefined) {
        let identical: boolean
        try {
          assertJsonSafe(previous)
          assertJsonSafe(value)
          identical = JSON.stringify(previous) === JSON.stringify(value)
        } catch {
          identical = JSON.stringify(await encodeArchiveClone(previous)) ===
            JSON.stringify(await encodeArchiveClone(value))
        }
        if (!identical) throw new Error('Existing native source differs; refusing overwrite')
      }
    }
    try {
      // Fail on ANY existing conflict before committing the first new source
      // record. The subsequent write pass repeats the guard against races.
      await visit(verifyExisting)
      await visit(async row => {
        if (row.kind !== 'record') return
        const { db, storeName, value, key } = target(row)
        const tx = db.transaction(storeName, 'readwrite')
        const done = committed(tx)
        const table = tx.objectStore(storeName)
        const previous = await read<unknown>(table.get(key))
        if (previous !== undefined) {
          // Binary/structured equality was verified for the entire file before
          // any write. Never overwrite a newer existing source row here.
          if (row.encoding !== 'structured') {
            assertJsonSafe(previous)
            if (JSON.stringify(previous) !== JSON.stringify(value)) {
              tx.abort()
              throw new Error('Existing native source differs; refusing overwrite')
            }
          }
          result.identical++
        } else {
          table.put(value)
          result.inserted++
        }
        await done
      })
      if (!stillAuthorized()) throw new Error('Account changed before native import completed')
      return result
    } finally { v3?.close() }
  })
}
