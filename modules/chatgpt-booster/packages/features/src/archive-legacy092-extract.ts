import {
  archiveSha256Hex, createGzipFromChunks, encodeArchiveClone,
} from '@kobaproduction/browser-archive'

/**
 * One-time original 0.8.92/v3 archival extraction, explicitly triggered by
 * the owner. This DOES NOT open the canonical model or modify an old table.
 */
export const LEGACY_092_V3_DATABASE = 'chatgpt-booster-archive'
export const LEGACY_092_BACKUP_FORMAT = 'koba-native-v3-readonly-v1'

type NativeRow = { key: IDBValidKey; value: unknown }
export interface Legacy092BackupResult {
  readonly blob: Blob
  readonly counts: Readonly<Record<string, number>>
  readonly databaseVersion: number
}
async function openExistingLegacyDatabase(
  name: string,
  factory: IDBFactory,
): Promise<IDBDatabase> {
  if (name !== LEGACY_092_V3_DATABASE)
    throw Error('Only the historical stable v3 database can be extracted')
  if (typeof factory.databases !== 'function')
    throw Error('Browser cannot verify that the original archive database exists')
  const known = await factory.databases()
  if (!known.some(item => item.name === name))
    throw Error('Original 0.8.92 v3 database not found in this browser storage context')
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    request.onupgradeneeded = () => {
      request.transaction?.abort()
      reject(Error('Read-only extraction must never create or upgrade an IndexedDB'))
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? Error('Original archive unavailable'))
  })
}

/** Read only a bounded cursor page, including out-of-line original primary keys.
 * Never await binary encoding while an IDB transaction is active. */
async function readNativePage(
  db: IDBDatabase,
  store: string,
  after: IDBValidKey | null,
): Promise<{ rows: NativeRow[]; last: IDBValidKey | null; exhausted: boolean }> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const rows: NativeRow[] = []
    let last: IDBValidKey | null = null
    let exhausted = false
    tx.oncomplete = () => resolve({ rows, last, exhausted })
    tx.onerror = () => reject(tx.error ?? Error('Legacy read failed'))
    tx.onabort = () => reject(tx.error ?? Error('Legacy readonly transaction aborted'))
    const request = tx.objectStore(store).openCursor(
      after === null ? undefined : IDBKeyRange.lowerBound(after, true),
    )
    request.onerror = () => reject(request.error ?? Error('Legacy cursor failed'))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { exhausted = true; return }
      rows.push({ key: cursor.primaryKey, value: cursor.value })
      last = cursor.primaryKey
      if (rows.length < 32) cursor.continue()
    }
  })
}
async function* readNativeRows(db: IDBDatabase, store: string): AsyncGenerator<NativeRow> {
  let after: IDBValidKey | null = null
  while (true) {
    const page = await readNativePage(db, store, after)
    for (const row of page.rows) yield row
    if (page.exhausted || page.rows.length === 0) return
    if (page.last === null) throw Error('Original database scan did not advance')
    after = page.last
  }
}

/** Each original store is counted independently; no cross-store ACID snapshot is claimed. */
async function countNativeStore(db: IDBDatabase, name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readonly')
    const request = tx.objectStore(name).count()
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error ?? Error('Legacy count failed'))
    tx.onabort = () => reject(tx.error ?? Error('Legacy count aborted'))
  })
}

/** No database mutation, automatic conversion, owner inference or network. */
export async function exportLegacy092NativeV3(
  factory: IDBFactory = indexedDB,
): Promise<Legacy092BackupResult> {
  const db = await openExistingLegacyDatabase(LEGACY_092_V3_DATABASE, factory)
  const stores = [...db.objectStoreNames].sort()
  const sourceSchema = stores.map(name => {
    const table = db.transaction(name, 'readonly').objectStore(name)
    return {
      name, keyPath: table.keyPath, autoIncrement: table.autoIncrement,
      indexes: [...table.indexNames].map(indexName => {
        const index = table.index(indexName)
        return { name: indexName, keyPath: index.keyPath,
          unique: index.unique, multiEntry: index.multiEntry }
      }),
    }
  })
  if (db.version !== 3 || !stores.includes('conversations') || !stores.includes('messages')) {
    db.close()
    throw Error('Unexpected 0.8.92 source schema; no backup was produced')
  }
  const counts: Record<string, number> = {}
  const initialCounts: Record<string, number> = {}
  for (const store of stores) initialCounts[store] = await countNativeStore(db, store)
  let digest = 'start'
  const encoder = new TextEncoder()
  const encodeLine = async (row: Record<string, unknown>, footer = false) => {
    const line = JSON.stringify(row)
    if (!footer) digest = await archiveSha256Hex(digest + '\n' + line)
    return encoder.encode(line + '\n')
  }
  const content = async function* (): AsyncGenerator<Uint8Array> {
    yield await encodeLine({
      kind: 'header', format: LEGACY_092_BACKUP_FORMAT,
      originalDatabase: LEGACY_092_V3_DATABASE, originalDatabaseVersion: db.version,
      stores, sourceSchema, owner: 'preserved_as_recorded_no_guessing',
      consistency: 'read_only_page_snapshots_no_cross_store_atomicity_pause_capture',
    })
    for (const store of stores) {
      counts[store] = 0
      for await (const row of readNativeRows(db, store)) {
        yield await encodeLine({
          kind: 'record', store, primaryKey: await encodeArchiveClone(row.key),
          // Fully tagged source preservation, including binary, dates and sparse arrays.
          value: await encodeArchiveClone(row.value),
        })
        counts[store]++
      }
      if (counts[store] !== initialCounts[store] || counts[store] !== await countNativeStore(db, store))
        throw Error('Legacy archive changed during export; retry while capture is paused')
    }
    yield await encodeLine({ kind: 'footer', format: LEGACY_092_BACKUP_FORMAT, counts, digest }, true)
  }
  try {
    return { blob: await createGzipFromChunks(content()), counts, databaseVersion: db.version }
  } finally {
    db.close()
  }
}
