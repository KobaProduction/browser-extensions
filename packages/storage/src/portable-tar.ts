import type { PortableBackupPorts, PortableBackupRow } from './portable-backup'
import { assertMatchingScope, assertServiceScope, type ServiceScope } from './service-contract'
import { readTarEntries, TarStreamWriter } from './tar-stream'

export interface BackupTarChoice {
  readonly settings: boolean
  readonly indexeddb: boolean
  /** One continuous GZIP stream over the entire TAR, or plain TAR. */
  readonly compression: 'gzip' | 'none'
  readonly chunkRows?: number
}
export type BackupTarPhase = 'counting' | 'reading' | 'writing' | 'verifying' | 'restoring' | 'done'
export interface BackupTarProgress {
  readonly phase: BackupTarPhase
  readonly completed: number
  readonly total: number
  readonly percent: number
  readonly entries: number
}
export type BackupTarReporter = (value: BackupTarProgress) => void
export interface BackupTarOptions {
  readonly onProgress?: BackupTarReporter
  readonly sink?: WritableStream<Uint8Array<ArrayBuffer>>
}
interface Chunk {
  readonly path: string
  readonly store: string
  readonly rows: number
  readonly size: number
  readonly sha256: string
}
interface Manifest {
  readonly format: 'koba-portable-tar'
  readonly version: 1
  readonly scope: ServiceScope
  readonly createdAt: string
  readonly compression: 'gzip' | 'none'
  readonly includes: {
    readonly settings: boolean
    readonly indexeddb: boolean
    readonly session: false
    readonly attachments: false
  }
  readonly stores: readonly string[]
  readonly indexedSchema: number | null
  readonly counts: Record<string, number>
  readonly rows: number
  readonly chunks: readonly Chunk[]
  readonly schemaDigest: string
  readonly settingsDigest: string | null
}
export interface BackupTarInspection {
  readonly manifest: Manifest
  readonly rows: number
  readonly entries: number
}
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const CHUNK_LIMIT = 8 * 1024 * 1024
const SETTINGS_LIMIT = 512 * 1024
const RESTORE_LIMIT = 128 * 1024 * 1024
const FALLBACK_BLOB_LIMIT = 128 * 1024 * 1024
const MAX_RECORDS = Number.MAX_SAFE_INTEGER
const DEFAULT_ROWS = 1024
const MANIFEST = 'manifest.json'
const SCHEMA = 'indexeddb/schema.json'
const SETTINGS = 'persistent/settings.json'
const json = (value: unknown): string => JSON.stringify(value) as string
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
}
function notify(
  onProgress: BackupTarReporter | undefined,
  phase: BackupTarPhase,
  completed: number,
  total: number,
  entries: number,
) {
  onProgress?.({
    phase,
    completed,
    total,
    entries,
    percent: total === 0 ? 100 : Math.min(100, Math.floor((100 * completed) / total)),
  })
}
function validate<T>(
  ports: PortableBackupPorts<T>,
  choice: Pick<BackupTarChoice, 'settings' | 'indexeddb'>,
) {
  assertServiceScope(ports.scope)
  if (
    (!choice.settings && !choice.indexeddb) ||
    (choice.settings && !ports.settings) ||
    (choice.indexeddb && !ports.indexeddb)
  )
    throw Error('No supported persistent backup section selected')
  if (ports.settings) assertMatchingScope(ports.scope, ports.settings.scope)
  if (ports.indexeddb) assertMatchingScope(ports.scope, ports.indexeddb.scope)
}
function validateChunkRows(n: number): number {
  if (!Number.isSafeInteger(n) || n < 64 || n > 2048)
    throw Error('TAR chunk size must be 64–2048 records')
  return n
}
function schemaOf<T>(ports: PortableBackupPorts<T>, enabled: boolean) {
  const p = enabled ? ports.indexeddb : undefined
  if (enabled && (!p || Object.keys(p.schema).sort().join(',') !== [...p.stores].sort().join(',')))
    throw Error('IndexedDB schema layout must be declared explicitly')
  return {
    schemaVersion: p?.schemaVersion ?? null,
    stores: p ? [...p.stores] : [],
    layout: p?.schema ?? null,
  }
}
/** Exports a genuine single-file TAR or TAR.GZ. Only bounded plain JSONL chunks exist in the TAR. */
export async function exportBackupTar<T>(
  ports: PortableBackupPorts<T>,
  choice: BackupTarChoice,
  options: BackupTarOptions = {},
): Promise<Blob | null> {
  validate(ports, choice)
  if (choice.compression !== 'gzip' && choice.compression !== 'none')
    throw Error('Unknown TAR compression')
  const pageSize = validateChunkRows(choice.chunkRows ?? DEFAULT_ROWS)
  const schema = schemaOf(ports, choice.indexeddb)
  const counts = choice.indexeddb && ports.indexeddb ? await ports.indexeddb.countRows() : {}
  if (
    Object.keys(counts).sort().join(',') !== [...schema.stores].sort().join(',') ||
    Object.values(counts).some((n) => !Number.isSafeInteger(n) || n < 0)
  )
    throw Error('Invalid IndexedDB table counts')
  const total = Object.values(counts).reduce((a, b) => a + b, 0) + Number(choice.settings)
  if (!Number.isSafeInteger(total) || total > MAX_RECORDS) throw Error('Unsupported record count')
  notify(options.onProgress, 'counting', 0, total, 0)
  const parts: Uint8Array<ArrayBuffer>[] = []
  let fallbackBytes = 0
  const destination =
    options.sink ??
    new WritableStream<Uint8Array<ArrayBuffer>>({
      write(bytes) {
        fallbackBytes += bytes.length
        if (fallbackBytes > FALLBACK_BLOB_LIMIT)
          throw Error('Select a file destination for a large TAR backup')
        parts.push(bytes.slice())
      },
    })
  // One compressor sees metadata + every message: repeated provider keys are shared in the same DEFLATE window.
  const gzip = choice.compression === 'gzip' ? new CompressionStream('gzip') : null
  const pump = gzip ? gzip.readable.pipeTo(destination) : null
  const writer = new TarStreamWriter(
    gzip ? (gzip.writable as WritableStream<Uint8Array<ArrayBuffer>>) : destination,
  )
  let done = 0,
    entries = 0
  const chunks: Chunk[] = []
  let settingsDigest: string | null = null
  try {
    if (choice.settings && ports.settings) {
      const value = ports.settings.validateSettings(await ports.settings.exportSettings())
      const bytes = encoder.encode(json({ schemaVersion: ports.settings.schemaVersion, value }))
      if (bytes.length > SETTINGS_LIMIT) throw Error('Settings backup exceeds portable limit')
      await writer.add(SETTINGS, bytes)
      settingsDigest = await digest(bytes)
      done++
      notify(options.onProgress, 'writing', done, total, ++entries)
    }
    const schemaBytes = encoder.encode(json(schema))
    await writer.add(SCHEMA, schemaBytes)
    const schemaDigest = await digest(schemaBytes)
    entries++
    if (choice.indexeddb && ports.indexeddb) {
      const allowed = new Set(schema.stores)
      let current = '',
        lines: string[] = [],
        size = 0,
        sequence = 0
      const flush = async () => {
        if (!lines.length) return
        const bytes = encoder.encode(lines.join(''))
        const path = `indexeddb/${current}/${String(sequence++).padStart(8, '0')}.jsonl`
        await writer.add(path, bytes)
        chunks.push({
          path,
          store: current,
          rows: lines.length,
          size: bytes.length,
          sha256: await digest(bytes),
        })
        lines = []
        size = 0
        notify(options.onProgress, 'writing', done, total, ++entries)
      }
      for await (const row of ports.indexeddb.readRows(pageSize)) {
        if (!allowed.has(row.store) || !row.key || row.key.length > 1024)
          throw Error('Invalid IndexedDB export record')
        if (row.store !== current) {
          await flush()
          current = row.store
          sequence = 0
        }
        const line = `${json({ key: row.key, value: row.value })}\n`
        const length = encoder.encode(line).length
        if (length > CHUNK_LIMIT) throw Error('Record exceeds maximum TAR chunk size')
        if (lines.length >= pageSize || size + length > CHUNK_LIMIT) await flush()
        lines.push(line)
        size += length
        done++
        if ((done - Number(choice.settings)) % pageSize === 0)
          notify(options.onProgress, 'reading', done, total, entries)
      }
      await flush()
      if (done !== total) throw Error('IndexedDB row counts changed during backup')
      const after = await ports.indexeddb.countRows()
      if (json(after) !== json(counts)) throw Error('IndexedDB changed during backup')
    }
    const manifest: Manifest = {
      format: 'koba-portable-tar',
      version: 1,
      createdAt: new Date().toISOString(),
      scope: { ...ports.scope },
      compression: choice.compression,
      includes: {
        settings: choice.settings,
        indexeddb: choice.indexeddb,
        session: false,
        attachments: false,
      },
      stores: schema.stores,
      indexedSchema: schema.schemaVersion,
      counts,
      rows: total - Number(choice.settings),
      chunks,
      settingsDigest,
      schemaDigest,
    }
    const manifestBytes = encoder.encode(json(manifest))
    if (manifestBytes.length > CHUNK_LIMIT) throw Error('Manifest too large')
    await writer.add(MANIFEST, manifestBytes)
    entries++
    await writer.finish()
    if (pump) await pump
    notify(options.onProgress, 'done', total, total, entries)
    return options.sink
      ? null
      : new Blob(parts, {
          type: choice.compression === 'gzip' ? 'application/gzip' : 'application/x-tar',
        })
  } catch (error) {
    await writer.abort(error).catch(() => undefined)
    if (pump) await pump.catch(() => undefined)
    throw error
  }
}

interface Scan<T> {
  readonly manifest: Manifest
  readonly settings: T | undefined
  readonly records: PortableBackupRow[]
  readonly entries: number
}
/** Fully validates the gzip stream and TAR, including all file hashes, before restore. */
async function scan<T>(
  ports: PortableBackupPorts<T>,
  blob: Blob,
  collect: boolean,
  progress?: BackupTarReporter,
): Promise<Scan<T>> {
  assertServiceScope(ports.scope)
  if (!blob.size) throw Error('Empty TAR archive')
  const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
  const compressed = header[0] === 0x1f && header[1] === 0x8b
  const stream = compressed ? blob.stream().pipeThrough(new DecompressionStream('gzip')) : blob.stream()
  const observed: Chunk[] = []
  const byStore: Record<string, number> = Object.create(null) as Record<string, number>
  const records: PortableBackupRow[] = []
  const unique = new Set<string>()
  let schemaBytes: Uint8Array | null = null,
    settingsBytes: Uint8Array | null = null
  let settings: T | undefined,
    manifest: Manifest | undefined,
    rows = 0,
    entries = 0,
    retained = 0
  for await (const file of readTarEntries(stream)) {
    entries++
    if (manifest) throw Error('Unexpected files after TAR manifest')
    if (file.name === SETTINGS) {
      if (settingsBytes || file.bytes.length > SETTINGS_LIMIT)
        throw Error('Duplicate or oversized settings file')
      settingsBytes = file.bytes
      continue
    }
    if (file.name === SCHEMA) {
      if (schemaBytes) throw Error('Duplicate TAR schema')
      schemaBytes = file.bytes
      continue
    }
    if (file.name === MANIFEST) {
      const value: unknown = JSON.parse(decoder.decode(file.bytes))
      if (
        !isObject(value) ||
        value.format !== 'koba-portable-tar' ||
        value.version !== 1 ||
        !isObject(value.scope) ||
        !isObject(value.includes) ||
        value.includes.session !== false ||
        value.includes.attachments !== false ||
        typeof value.includes.settings !== 'boolean' ||
        typeof value.includes.indexeddb !== 'boolean' ||
        !Array.isArray(value.stores) ||
        !Array.isArray(value.chunks) ||
        !isObject(value.counts) ||
        !Number.isSafeInteger(value.rows) ||
        typeof value.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(value.createdAt))
      )
        throw Error('Unsupported TAR manifest')
      assertMatchingScope(ports.scope, value.scope as unknown as ServiceScope)
      manifest = value as unknown as Manifest
      if (manifest.compression !== (compressed ? 'gzip' : 'none'))
        throw Error('TAR compression mismatch')
      continue
    }
    const match = /^indexeddb\/([a-z][a-z0-9_-]*)\/([0-9]{8})\.jsonl$/.exec(file.name)
    if (!match || !ports.indexeddb?.stores.includes(match[1] ?? ''))
      throw Error('Unknown or disallowed TAR file')
    const store = match[1] as string
    const lines = decoder.decode(file.bytes).split('\n')
    if (lines.pop() !== '' || !lines.length) throw Error('Malformed TAR JSONL chunk')
    for (const line of lines) {
      const data: unknown = JSON.parse(line)
      if (
        !isObject(data) ||
        Object.keys(data).sort().join(',') !== 'key,value' ||
        typeof data.key !== 'string' ||
        !data.key ||
        data.key.length > 1024
      )
        throw Error('Invalid TAR record')
      const id = `${store}:${data.key}`
      if (unique.has(id)) throw Error('Duplicate TAR IndexedDB primary key')
      unique.add(id)
      rows++
      if (!Number.isSafeInteger(rows)) throw Error('Excessive TAR record count')
      if (collect) {
        retained += encoder.encode(line).length
        if (retained > RESTORE_LIMIT)
          throw Error('Full restore exceeds current transaction memory; staged restore required')
        records.push({ store, key: data.key, value: data.value })
      }
    }
    byStore[store] = (byStore[store] ?? 0) + lines.length
    observed.push({
      path: file.name,
      store,
      rows: lines.length,
      size: file.bytes.length,
      sha256: await digest(file.bytes),
    })
    notify(progress, 'verifying', rows, 0, entries)
  }
  if (
    !manifest ||
    !schemaBytes ||
    manifest.rows !== rows ||
    json(manifest.chunks) !== json(observed) ||
    json(manifest.counts) !== json(Object.fromEntries(manifest.stores.map((s) => [s, byStore[s] ?? 0])))
  )
    throw Error('TAR manifest counts or chunk checksums disagree')
  validate(ports, manifest.includes)
  const schema = schemaOf(ports, manifest.includes.indexeddb)
  if (
    json(JSON.parse(decoder.decode(schemaBytes))) !== json(schema) ||
    (await digest(schemaBytes)) !== manifest.schemaDigest ||
    manifest.indexedSchema !== schema.schemaVersion ||
    json(manifest.stores) !== json(schema.stores)
  )
    throw Error('TAR IndexedDB schema mismatch')
  if (manifest.includes.settings) {
    if (!settingsBytes || (await digest(settingsBytes)) !== manifest.settingsDigest || !ports.settings)
      throw Error('TAR persistent settings integrity mismatch')
    const entry: unknown = JSON.parse(decoder.decode(settingsBytes))
    if (!isObject(entry) || entry.schemaVersion !== ports.settings.schemaVersion)
      throw Error('Unsupported TAR settings schema')
    settings = ports.settings.validateSettings(entry.value)
    if (json(settings) !== json(entry.value)) throw Error('Noncanonical settings restore')
  } else if (settingsBytes || manifest.settingsDigest !== null)
    throw Error('Unexpected TAR settings file')
  notify(progress, 'done', rows, rows, entries)
  return { manifest, settings, records, entries }
}
export async function inspectBackupTar<T>(
  ports: PortableBackupPorts<T>,
  blob: Blob,
  progress?: BackupTarReporter,
): Promise<BackupTarInspection> {
  const scanned = await scan(ports, blob, false, progress)
  return { manifest: scanned.manifest, rows: scanned.manifest.rows, entries: scanned.entries }
}
export async function restoreBackupTar<T>(
  ports: PortableBackupPorts<T>,
  blob: Blob,
  selection: Pick<BackupTarChoice, 'settings' | 'indexeddb'>,
  progress?: BackupTarReporter,
): Promise<BackupTarInspection> {
  if (!selection.settings && !selection.indexeddb) throw Error('No restore sections selected')
  // First pass verifies the entire file, second pass revalidates and loads bounded transaction input.
  const inspected = await inspectBackupTar(ports, blob, progress)
  if (
    (selection.settings && !inspected.manifest.includes.settings) ||
    (selection.indexeddb && !inspected.manifest.includes.indexeddb)
  )
    throw Error('Requested restore section missing')
  const payload = await scan(ports, blob, selection.indexeddb, progress)
  notify(progress, 'restoring', 0, inspected.rows + Number(selection.settings), inspected.entries)
  if (selection.settings && ports.settings) {
    const before = ports.settings.validateSettings(await ports.settings.exportSettings())
    await ports.settings.restoreSettingsAtomically(payload.settings as T)
    try {
      if (selection.indexeddb && ports.indexeddb)
        await ports.indexeddb.restoreAtomically(payload.records)
    } catch (error) {
      await ports.settings.restoreSettingsAtomically(before)
      throw error
    }
  } else if (selection.indexeddb && ports.indexeddb)
    await ports.indexeddb.restoreAtomically(payload.records)
  notify(
    progress,
    'done',
    inspected.rows + Number(selection.settings),
    inspected.rows + Number(selection.settings),
    inspected.entries,
  )
  return inspected
}
