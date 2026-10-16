import type {
  ApplicationBackupSource,
  BackupFileOutput,
  BackupInspection,
  BackupRecoveryInfo,
  BackupRecoveryReference,
  BackupRow,
  BackupRowReader,
  BackupScope,
  BackupSectionInfo,
} from '@kobaproduction/browser-core'
import {
  BACKUP_WIRE_CHUNK,
  BackupFragmentDecoder,
  backupWireLines,
  serializedBackupRow,
} from './backup-fragments'
import {
  type BackupStage,
  type BackupStageFactory,
  type BackupStageJob,
  type BackupStageSection,
  backupStageDatabaseName,
  dexieBackupStageFactory,
} from './backup-stage'
import { assertMatchingScope, assertServiceScope } from './service-contract'
import { readTarEntries, TarStreamWriter } from './tar-stream'

interface Part {
  path: string
  sha256: string
  rows: number
}
interface Section extends BackupStageSection {
  rows: number
  parts: Part[]
}
interface Manifest {
  format: 'koba-sectioned-backup'
  version: 1 | 2
  createdAt: string
  sections: Section[]
}
export interface SectionedBackupOptions {
  readonly scope?: BackupScope
  readonly stageFactory?: BackupStageFactory
  readonly signal?: AbortSignal
}
/** Both sealed input and rollback remain locally recoverable after this error. */
export class SectionedBackupRecoveryError extends AggregateError {
  readonly recovery: BackupRecoveryReference
  constructor(
    errors: readonly unknown[],
    recovery: BackupRecoveryReference,
    message = 'Backup operation requires explicit local recovery',
  ) {
    super(errors, message)
    this.name = 'SectionedBackupRecoveryError'
    this.recovery = recovery
  }
}
const encode = new TextEncoder()
const decode = new TextDecoder('utf-8', { fatal: true })
const MEMORY_LIMIT = 128 * 1024 * 1024
const CHUNK = BACKUP_WIRE_CHUNK
const MAX_PARTS = 65536
const activeJobs = new Set<string>()
const guardedReaders = new WeakMap<BackupRowReader, WeakMap<AbortSignal, BackupRowReader>>()
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const json = (value: unknown) => JSON.stringify(value)
const validSection = (id: string) =>
  id.length <= 64 && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id)
function check(signal?: AbortSignal) {
  signal?.throwIfAborted()
}
async function hash(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('')
}
function sourcesById(sources: readonly ApplicationBackupSource[]) {
  if (sources.length > 64) throw Error('Too many backup sections')
  const result = new Map<string, ApplicationBackupSource>()
  for (const source of sources) {
    assertServiceScope(source.scope)
    if (!validSection(source.id) || source.label.length > 256 || result.has(source.id))
      throw Error('Invalid or duplicate backup section')
    result.set(source.id, source)
  }
  return result
}
function selectedSources(sources: readonly ApplicationBackupSource[], selected: readonly string[]) {
  const map = sourcesById(sources)
  if (!selected.length || new Set(selected).size !== selected.length)
    throw Error('Select distinct backup sections')
  return selected.map((id) => {
    const source = map.get(id)
    if (!source?.available) throw Error('Selected backup section is unavailable')
    if (source.kind === 'indexeddb' && (!source.validateStagedRows || !source.restoreStagedRows))
      throw Error('Selected archive requires staged recovery adapters')
    return source
  })
}
function registryScope(sources: readonly ApplicationBackupSource[], options: SectionedBackupOptions) {
  sourcesById(sources)
  const scope = options.scope ?? sources[0]?.scope
  if (!scope) throw Error('Backup registry scope is required')
  assertServiceScope(scope)
  if (sources.some((source) => source.scope.channel !== scope.channel))
    throw Error('Backup registry channel mismatch')
  return scope
}
async function withStageLock<T>(
  sources: readonly ApplicationBackupSource[],
  options: SectionedBackupOptions,
  action: () => Promise<T>,
): Promise<T> {
  check(options.signal)
  if (!(options.stageFactory ?? dexieBackupStageFactory).persistent) return action()
  if (typeof navigator === 'undefined' || !navigator.locks)
    throw Error('Safe persistent recovery requires scoped Web Locks')
  const name = await backupStageDatabaseName(registryScope(sources, options))
  check(options.signal)
  // Origin-bound mutual exclusion; it does not claim atomicity for cross-origin
  // GM preferences or different storage backends. Owner fences still apply.
  return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) throw Error('Another backup operation is active in this context')
    check(options.signal)
    return action()
  })
}
function sectionOf(source: ApplicationBackupSource): BackupStageSection {
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    scope: source.scope,
    schema: source.schema,
  }
}
function available(
  source: ApplicationBackupSource | undefined,
  section: BackupStageSection,
): { available: boolean; reason?: string } {
  if (!source?.available)
    return { available: false, reason: source?.reason ?? 'Раздел недоступен в текущем контексте' }
  try {
    assertMatchingScope(source.scope, section.scope)
  } catch {
    return { available: false, reason: 'Раздел другого аккаунта, канала или установки' }
  }
  if (source.kind !== section.kind || json(source.schema) !== json(section.schema))
    return { available: false, reason: 'Версия раздела несовместима с текущим приложением' }
  if (source.kind === 'indexeddb' && (!source.validateStagedRows || !source.restoreStagedRows))
    return { available: false, reason: 'Для архива недоступно поэтапное восстановление' }
  return { available: true }
}
function cancellable(reader: BackupRowReader, signal?: AbortSignal): BackupRowReader {
  if (!signal) return reader
  let readers = guardedReaders.get(reader)
  if (!readers) {
    readers = new WeakMap()
    guardedReaders.set(reader, readers)
  }
  const cached = readers.get(signal)
  if (cached) return cached
  const guarded: BackupRowReader = {
    count: reader.count,
    async *rows() {
      for await (const row of reader.rows()) {
        check(signal)
        yield row
      }
      check(signal)
    },
    async get(key) {
      check(signal)
      const row = await reader.get(key)
      check(signal)
      return row
    },
  }
  readers.set(signal, guarded)
  return guarded
}
async function boundedRows(reader: BackupRowReader, signal?: AbortSignal): Promise<BackupRow[]> {
  const rows: BackupRow[] = []
  let bytes = 0
  for await (const row of cancellable(reader, signal).rows()) {
    bytes += encode.encode(json(row)).length
    if (bytes > MEMORY_LIMIT) throw Error('Settings section exceeds the bounded array adapter')
    rows.push(row)
  }
  return rows
}
async function validate(source: ApplicationBackupSource, reader: BackupRowReader, signal?: AbortSignal) {
  check(signal)
  if (source.validateStagedRows) await source.validateStagedRows(cancellable(reader, signal))
  else if (source.kind !== 'indexeddb') await source.validateRows(await boundedRows(reader, signal))
  else throw Error('IndexedDB backup requires a staged validator')
  check(signal)
}
async function replace(source: ApplicationBackupSource, reader: BackupRowReader, signal?: AbortSignal) {
  check(signal)
  if (source.restoreStagedRows) await source.restoreStagedRows(cancellable(reader, signal))
  else if (source.kind !== 'indexeddb') await source.restoreRows(await boundedRows(reader, signal))
  else throw Error('IndexedDB restore requires a staged adapter')
  check(signal)
}
async function stageSource(
  stage: BackupStage,
  bucket: 'input' | 'rollback',
  source: ApplicationBackupSource,
  signal?: AbortSignal,
) {
  check(signal)
  let batch: BackupRow[] = [],
    size = 0
  for await (const row of source.readRows()) {
    check(signal)
    const { text, bytes } = serializedBackupRow(row)
    if (batch.length && (batch.length === 256 || size + bytes > CHUNK)) {
      await stage.addRows(bucket, source.id, batch)
      batch = []
      size = 0
    }
    batch.push(JSON.parse(text) as BackupRow)
    size += bytes
  }
  if (batch.length) await stage.addRows(bucket, source.id, batch)
  check(signal)
  const reader = await stage.seal(bucket, source.id)
  await validate(source, reader, signal)
  return reader
}
async function createStage(
  sources: readonly ApplicationBackupSource[],
  purpose: BackupStageJob['purpose'],
  options: SectionedBackupOptions,
) {
  check(options.signal)
  const stage = await (options.stageFactory ?? dexieBackupStageFactory).create(
    registryScope(sources, options),
    purpose,
  )
  activeJobs.add(stage.reference.id)
  return stage
}
async function cleanup(stage: BackupStage, preserve: boolean, committedResult = false) {
  let completed = committedResult
  try {
    completed ||= (await stage.job()).state === 'completed'
  } catch {
    /* Preserve the cleanup error's recovery identity below. */
  }
  try {
    if (!preserve) await stage.discard()
  } catch (error) {
    if (!completed)
      throw new SectionedBackupRecoveryError(
        [error],
        stage.reference,
        'Temporary backup data remains; discard it explicitly',
      )
  } finally {
    activeJobs.delete(stage.reference.id)
    stage.close()
  }
}
async function writeStagedExport(
  stage: BackupStage,
  chosen: readonly ApplicationBackupSource[],
  output: BackupFileOutput,
  signal?: AbortSignal,
) {
  const manifest: Manifest = {
    format: 'koba-sectioned-backup',
    version: 2,
    createdAt: (await stage.job()).createdAt,
    sections: [],
  }
  const gzip = new CompressionStream('gzip')
  const pump = gzip.readable.pipeTo(output.writable, { preventClose: true, signal })
  void pump.catch(() => undefined)
  const writer = new TarStreamWriter(gzip.writable as WritableStream<Uint8Array<ArrayBuffer>>)
  let partCount = 0
  try {
    for (const source of chosen) {
      const reader = await stage.reader('input', source.id)
      const section: Section = { ...sectionOf(source), rows: reader.count, parts: [] }
      let lines: string[] = [],
        size = 0,
        rows = 0,
        sequence = 0
      const flush = async () => {
        if (!lines.length) return
        check(signal)
        if (++partCount > MAX_PARTS) throw Error('Backup manifest has too many parts')
        const bytes = encode.encode(lines.join(''))
        const path = `sections/${source.id}/${String(sequence++).padStart(8, '0')}.jsonl`
        await writer.add(path, bytes)
        section.parts.push({ path, rows, sha256: await hash(bytes) })
        lines = []
        size = 0
        rows = 0
      }
      for await (const row of cancellable(reader, signal).rows()) {
        for await (const unit of backupWireLines(row)) {
          check(signal)
          const bytes = encode.encode(unit.line).length
          if (bytes > CHUNK) throw Error('Backup wire unit exceeds chunk limit')
          if (size + bytes > CHUNK || lines.length >= 1024) await flush()
          lines.push(unit.line)
          rows += unit.rows
          size += bytes
        }
      }
      await flush()
      manifest.sections.push(section)
      if (encode.encode(json(manifest)).length > CHUNK) throw Error('Backup manifest is too large')
    }
    await writer.add('manifest.json', encode.encode(json(manifest)))
    await writer.finish()
    await pump
    // The sink is still temporary. Recheck graph and current owner before publication.
    for (const source of chosen) await validate(source, await stage.reader('input', source.id), signal)
    check(signal)
    await stage.update({ state: 'prepared' })
    check(signal)
    await output.commit()
    // Native publication already succeeded. A metadata-only failure cannot
    // revoke it; a retained prepared job truthfully leaves publication unknown.
    await stage.update({ state: 'completed' }).catch(() => undefined)
  } catch (error) {
    await writer.abort(error).catch(() => undefined)
    await pump.catch(() => undefined)
    await output.abort(error).catch(() => undefined)
    throw error
  }
}
export async function exportSectionedBackupTo(
  sources: readonly ApplicationBackupSource[],
  selected: readonly string[],
  output: BackupFileOutput,
  options: SectionedBackupOptions = {},
): Promise<void> {
  try {
    await withStageLock(sources, options, () => exportToStage(sources, selected, output, options))
  } catch (error) {
    await output.abort(error).catch(() => undefined)
    throw error
  }
}
async function exportToStage(
  sources: readonly ApplicationBackupSource[],
  selected: readonly string[],
  output: BackupFileOutput,
  options: SectionedBackupOptions,
): Promise<void> {
  let stage: BackupStage | undefined
  let published = false
  try {
    const chosen = selectedSources(sources, selected)
    stage = await createStage(sources, 'export', options)
    await stage.update({ sections: chosen.map(sectionOf) })
    for (const source of chosen) await stageSource(stage, 'input', source, options.signal)
    await writeStagedExport(stage, chosen, output, options.signal)
    published = true
  } catch (error) {
    await output.abort(error).catch(() => undefined)
    throw error
  } finally {
    if (stage) await cleanup(stage, false, published)
  }
}
/** Only compressed Blob memory is bounded; a caller-owned file sink supports large output. */
export async function exportSectionedBackup(
  sources: readonly ApplicationBackupSource[],
  selected: readonly string[],
  options: SectionedBackupOptions = {},
): Promise<Blob> {
  let parts: Uint8Array<ArrayBuffer>[] = [],
    size = 0,
    result: Blob | undefined
  const writable = new WritableStream<Uint8Array<ArrayBuffer>>({
    write(bytes) {
      size += bytes.byteLength
      if (size > MEMORY_LIMIT)
        throw Error('Backup exceeds the 128 MiB in-memory download limit; choose a file destination')
      parts.push(bytes.slice())
    },
  })
  await exportSectionedBackupTo(
    sources,
    selected,
    {
      writable,
      async commit() {
        const writer = writable.getWriter()
        try {
          await writer.close()
        } finally {
          writer.releaseLock()
        }
        result = new Blob(parts, { type: 'application/gzip' })
        parts = []
      },
      async abort(reason) {
        parts = []
        await writable.abort(reason).catch(() => undefined)
      },
    },
    options,
  )
  if (!result) throw Error('Backup output was not committed')
  return result
}

async function scan(
  file: Blob,
  sources: readonly ApplicationBackupSource[],
  stage: BackupStage,
  signal?: AbortSignal,
) {
  check(signal)
  if (!file.size) throw Error('Empty backup')
  const map = sourcesById(sources)
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const decoded =
    signature[0] === 0x1f && signature[1] === 0x8b
      ? file.stream().pipeThrough(new DecompressionStream('gzip'))
      : file.stream()
  let manifest: Manifest | undefined,
    postManifestBytes = 0,
    files = 0
  const fragments = new BackupFragmentDecoder()
  const sequences = new Map<string, number>()
  // Bound malicious zero tails without imposing a total decompressed archive limit.
  const stream = decoded.pipeThrough(
    new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
      transform(bytes, controller) {
        check(signal)
        if (manifest) {
          postManifestBytes += bytes.byteLength
          if (postManifestBytes > 1024 * 1024) throw Error('Excessive data after backup manifest')
        }
        controller.enqueue(bytes)
      },
    }),
    { signal },
  )
  for await (const entry of readTarEntries(stream, { signal })) {
    check(signal)
    if (manifest) throw Error('Data after backup manifest')
    if (entry.name === 'manifest.json') {
      fragments.assertComplete()
      if (entry.bytes.length > CHUNK) throw Error('Backup manifest is too large')
      const value: unknown = JSON.parse(decode.decode(entry.bytes))
      if (
        !object(value) ||
        value.format !== 'koba-sectioned-backup' ||
        (value.version !== 1 && value.version !== 2) ||
        (value.version === 1 && fragments.usedFragments) ||
        typeof value.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(value.createdAt)) ||
        !Array.isArray(value.sections) ||
        !value.sections.length ||
        value.sections.length > 64
      )
        throw Error('Unsupported backup manifest')
      manifest = value as unknown as Manifest
      continue
    }
    const match = /^sections\/([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)\/([0-9]{8})\.jsonl$/.exec(
      entry.name,
    )
    if (!match?.[1] || ++files > MAX_PARTS) throw Error('Unknown or excessive backup parts')
    if (Number(match[2]) !== (sequences.get(match[1]) ?? 0))
      throw Error('Duplicate or unordered backup part')
    sequences.set(match[1], Number(match[2]) + 1)
    if (entry.bytes.length > CHUNK) throw Error('Backup record is too large: part exceeds chunk limit')
    const lines = decode.decode(entry.bytes).split('\n')
    if (lines.pop() !== '' || !lines.length) throw Error('Malformed backup rows')
    let batch: BackupRow[] = []
    let rows = 0
    let batchBytes = 0
    for (const line of lines) {
      check(signal)
      if (encode.encode(line).length + 1 > CHUNK) throw Error('Backup record is too large')
      const row = await fragments.consume(JSON.parse(line), match[1])
      if (!row) continue
      if (batch.length && batchBytes + fragments.lastRowBytes > CHUNK) {
        await stage.addRows('input', match[1], batch)
        batch = []
        batchBytes = 0
      }
      batch.push(row)
      batchBytes += fragments.lastRowBytes
      rows++
      if (batch.length === 256) {
        await stage.addRows('input', match[1], batch)
        batch = []
        batchBytes = 0
      }
    }
    if (batch.length) await stage.addRows('input', match[1], batch)
    await stage.addPart({ path: entry.name, sha256: await hash(entry.bytes), rows })
  }
  if (!manifest) throw Error('Backup manifest missing')
  const ids = new Set<string>(),
    info: (BackupSectionInfo & { rows: number })[] = []
  let consumed = 0
  for (const section of manifest.sections) {
    check(signal)
    if (
      !object(section) ||
      typeof section.id !== 'string' ||
      !validSection(section.id) ||
      typeof section.label !== 'string' ||
      section.label.length > 256 ||
      !['settings', 'session', 'indexeddb'].includes(section.kind) ||
      !Number.isSafeInteger(section.rows) ||
      section.rows < 0 ||
      !Array.isArray(section.parts) ||
      !object(section.scope) ||
      ids.has(section.id)
    )
      throw Error('Invalid backup section')
    ids.add(section.id)
    assertServiceScope(section.scope)
    let rows = 0
    for (const [sequence, part] of section.parts.entries()) {
      check(signal)
      const expected = `sections/${section.id}/${String(sequence).padStart(8, '0')}.jsonl`
      const staged = await stage.part(expected)
      if (
        !object(part) ||
        part.path !== expected ||
        !staged ||
        part.sha256 !== staged.sha256 ||
        !Number.isSafeInteger(part.rows) ||
        part.rows !== staged.rows
      )
        throw Error('Backup part integrity mismatch')
      rows += staged.rows
      consumed++
      if (!Number.isSafeInteger(rows)) throw Error('Backup record count exceeds safe bounds')
    }
    const reader = await stage.seal('input', section.id)
    if (rows !== section.rows || reader.count !== rows) throw Error('Backup record count mismatch')
    const source = map.get(section.id),
      state = available(source, section)
    info.push({ id: section.id, label: section.label, kind: section.kind, rows, ...state })
  }
  if (consumed !== (await stage.partCount())) throw Error('Unlisted backup files')
  await stage.update({
    sections: manifest.sections.map(({ id, label, kind, scope, schema }) => ({
      id,
      label,
      kind,
      scope,
      schema,
    })),
  })
  // Validators only see immutable sections after the entire file is checked.
  for (const section of info)
    if (section.available) {
      const source = map.get(section.id)
      if (!source) throw Error('Backup source became unavailable')
      await validate(source, await stage.reader('input', section.id), signal)
    }
  return { createdAt: manifest.createdAt, sections: info } satisfies BackupInspection
}
export async function inspectSectionedBackup(
  file: Blob,
  sources: readonly ApplicationBackupSource[],
  options: SectionedBackupOptions = {},
): Promise<BackupInspection> {
  return withStageLock(sources, options, async () => {
    const stage = await createStage(sources, 'inspect', options)
    let finished = false
    try {
      const inspection = await scan(file, sources, stage, options.signal)
      await stage.update({ state: 'completed' })
      finished = true
      check(options.signal)
      return inspection
    } finally {
      await cleanup(stage, false, finished)
    }
  })
}
const priority = (source: ApplicationBackupSource) =>
  source.id === 'application.settings' ? 100 : source.kind === 'indexeddb' ? 0 : 10
async function rollback(
  stage: BackupStage,
  sources: readonly ApplicationBackupSource[],
  attempted: readonly string[],
) {
  const map = sourcesById(sources),
    job = await stage.job()
  const chosen = attempted
    .map((id) => {
      const section = job.sections.find((section) => section.id === id),
        source = map.get(id)
      if (!section || !source || !available(source, section).available)
        throw Error('Recovery section is unavailable in the current context')
      return source
    })
    .sort((a, b) => priority(a) - priority(b))
  const readers = new Map<string, BackupRowReader>()
  for (const source of chosen) {
    const base = await stage.reader('rollback', source.id)
    // A new recovery attempt intentionally captures the CURRENT destination
    // stamp. Keep this view identical between its preflight and replacement.
    readers.set(
      source.id,
      Object.freeze({ count: base.count, rows: () => base.rows(), get: (key: string) => base.get(key) }),
    )
  }
  // Once primary writes were attempted, cancellation never interrupts recovery.
  const readerFor = (id: string) => {
    const reader = readers.get(id)
    if (!reader) throw Error('Missing rollback reader')
    return reader
  }
  for (const source of chosen) await validate(source, readerFor(source.id))
  const failures: unknown[] = []
  for (const source of chosen)
    try {
      await replace(source, readerFor(source.id))
    } catch (error) {
      failures.push(error)
    }
  if (failures.length) throw new AggregateError(failures, 'Local rollback is incomplete')
}
export async function restoreSectionedBackup(
  file: Blob,
  sources: readonly ApplicationBackupSource[],
  selected: readonly string[],
  options: SectionedBackupOptions = {},
): Promise<void> {
  return withStageLock(sources, options, () => restoreFromStage(file, sources, selected, options))
}
async function restoreFromStage(
  file: Blob,
  sources: readonly ApplicationBackupSource[],
  selected: readonly string[],
  options: SectionedBackupOptions,
): Promise<void> {
  const chosen = selectedSources(sources, selected),
    stage = await createStage(sources, 'restore', options)
  let preserve = false,
    finished = false,
    attempted: string[] = []
  try {
    const inspection = await scan(file, sources, stage, options.signal)
    for (const source of chosen)
      if (!inspection.sections.some((section) => section.id === source.id && section.available))
        throw Error('Requested backup section is missing or unavailable')
    for (const source of chosen) await stageSource(stage, 'rollback', source, options.signal)
    for (const source of chosen)
      await validate(source, await stage.reader('input', source.id), options.signal)
    check(options.signal)
    await stage.update({ state: 'restoring', sections: chosen.map(sectionOf), attempted: [] })
    try {
      for (const source of [...chosen].sort((a, b) => priority(a) - priority(b))) {
        check(options.signal)
        attempted = [...attempted, source.id]
        await stage.update({ attempted })
        await replace(source, await stage.reader('input', source.id), options.signal)
      }
      // Once this durable checkpoint commits, the restore is complete; a late
      // cancellation must not turn it into an unjournalled compensating write.
      await stage.update({ state: 'completed' })
      finished = true
    } catch (error) {
      try {
        await rollback(stage, sources, attempted)
        await stage.update({ state: 'completed' })
        finished = true
      } catch (failure) {
        preserve = true
        await stage.update({ state: 'rollback-failed' }).catch(() => undefined)
        throw new SectionedBackupRecoveryError(
          [error, failure],
          stage.reference,
          'Restore failed and rollback requires explicit recovery',
        )
      }
      throw error
    }
  } finally {
    await cleanup(stage, preserve, finished)
  }
}
/** No host DB enumeration and no provider DB access; only the exact scoped registry. */
export async function listSectionedBackupRecoveries(
  sources: readonly ApplicationBackupSource[],
  options: SectionedBackupOptions = {},
): Promise<readonly BackupRecoveryInfo[]> {
  check(options.signal)
  const map = sourcesById(sources),
    scope = registryScope(sources, options)
  const jobs = await (options.stageFactory ?? dexieBackupStageFactory).list(scope)
  check(options.signal)
  return jobs.map((job) => {
    const canRollback =
      job.purpose === 'restore' &&
      (job.state === 'restoring' || job.state === 'rollback-failed') &&
      job.attempted.length > 0
    const sections = canRollback
      ? job.sections.filter((section) => job.attempted.includes(section.id))
      : job.sections
    return {
      id: job.id,
      createdAt: job.createdAt,
      canRollback,
      sections: sections.map((section) => ({
        id: section.id,
        label: section.label,
        kind: section.kind,
        ...available(map.get(section.id), section),
      })),
      reason:
        job.state === 'completed'
          ? 'Операция завершена; остались временные данные для удаления'
          : job.state === 'prepared'
            ? 'Остались данные подготовленного файла; сохранение файла могло завершиться'
            : job.state === 'rollback-failed'
              ? 'Откат не завершён; исходные данные сохранены во временном хранилище'
              : job.state === 'restoring'
                ? 'Восстановление прервано; требуется явный откат или удаление временных данных'
                : 'Остались временные данные незавершённой операции',
    }
  })
}
async function openRecovery(
  sources: readonly ApplicationBackupSource[],
  id: string,
  options: SectionedBackupOptions,
) {
  check(options.signal)
  if (activeJobs.has(id)) throw Error('Backup operation is still active')
  const stage = await (options.stageFactory ?? dexieBackupStageFactory).open(
    registryScope(sources, options),
    id,
  )
  activeJobs.add(id)
  return stage
}
export async function retrySectionedBackupRollback(
  sources: readonly ApplicationBackupSource[],
  id: string,
  options: SectionedBackupOptions = {},
): Promise<void> {
  return withStageLock(sources, options, () => retryRollback(sources, id, options))
}
async function retryRollback(
  sources: readonly ApplicationBackupSource[],
  id: string,
  options: SectionedBackupOptions,
): Promise<void> {
  const stage = await openRecovery(sources, id, options)
  let preserve = true
  try {
    const job = await stage.job()
    if (
      job.purpose !== 'restore' ||
      (job.state !== 'restoring' && job.state !== 'rollback-failed') ||
      !job.attempted.length ||
      new Set(job.attempted).size !== job.attempted.length
    )
      throw Error('This stage has no interrupted restore to roll back')
    check(options.signal)
    try {
      await rollback(stage, sources, job.attempted)
      await stage.update({ state: 'completed' })
    } catch (error) {
      await stage.update({ state: 'rollback-failed' }).catch(() => undefined)
      throw new SectionedBackupRecoveryError(
        [error],
        stage.reference,
        'Local rollback still requires explicit recovery',
      )
    }
    preserve = false
  } finally {
    await cleanup(stage, preserve, !preserve)
  }
}
export async function discardSectionedBackupRecovery(
  sources: readonly ApplicationBackupSource[],
  id: string,
  options: SectionedBackupOptions = {},
): Promise<void> {
  return withStageLock(sources, options, async () => {
    const stage = await openRecovery(sources, id, options)
    try {
      check(options.signal)
      await stage.discard()
    } finally {
      activeJobs.delete(id)
      stage.close()
    }
  })
}
