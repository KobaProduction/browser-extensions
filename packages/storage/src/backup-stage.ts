import type {
  BackupRecoveryReference,
  BackupRow,
  BackupRowReader,
  BackupScope,
  BackupSectionInfo,
} from '@kobaproduction/browser-core'
import Dexie, { type Table, type Transaction } from 'dexie'
import { assertMatchingScope, assertServiceScope } from './service-contract'

export type BackupStageBucket = 'input' | 'rollback'
export interface BackupStageSection {
  readonly id: string
  readonly label: string
  readonly kind: BackupSectionInfo['kind']
  readonly scope: BackupScope
  readonly schema: unknown
}
export interface BackupStageJob {
  readonly id: string
  readonly scope: BackupScope
  readonly createdAt: string
  readonly purpose: 'export' | 'inspect' | 'restore'
  readonly state: 'staging' | 'prepared' | 'restoring' | 'rollback-failed' | 'completed'
  readonly sections: readonly BackupStageSection[]
  readonly attempted: readonly string[]
}
export interface BackupStagePart {
  readonly path: string
  readonly sha256: string
  readonly rows: number
}
export interface BackupStage {
  readonly reference: BackupRecoveryReference
  job(): Promise<BackupStageJob>
  update(
    patch: Partial<Pick<BackupStageJob, 'purpose' | 'state' | 'sections' | 'attempted'>>,
  ): Promise<void>
  /** Unique insertion; an existing key is never replaced. Batches are at most 256 rows. */
  addRows(bucket: BackupStageBucket, section: string, rows: readonly BackupRow[]): Promise<void>
  seal(bucket: BackupStageBucket, section: string): Promise<BackupRowReader>
  reader(bucket: BackupStageBucket, section: string): Promise<BackupRowReader>
  addPart(part: BackupStagePart): Promise<void>
  part(path: string): Promise<BackupStagePart | undefined>
  partCount(): Promise<number>
  discard(): Promise<void>
  close(): void
}
export interface BackupStageFactory {
  readonly persistent: boolean
  create(scope: BackupScope, purpose: BackupStageJob['purpose']): Promise<BackupStage>
  open(scope: BackupScope, id: string): Promise<BackupStage>
  list(scope: BackupScope): Promise<readonly BackupStageJob[]>
}
interface StoredRow {
  job: string
  bucket: BackupStageBucket
  section: string
  key: string
  value: unknown
}
interface StoredSeal {
  job: string
  bucket: BackupStageBucket
  section: string
  count: number
  sealed: boolean
}
interface StoredPart extends BackupStagePart {
  job: string
}
const clone = <T>(value: T): T => structuredClone(value)
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
const validSection = (id: string) =>
  id.length <= 64 && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id)
function assertRows(section: string, rows: readonly BackupRow[]) {
  if (!validSection(section) || rows.length > 256) throw Error('Invalid staging batch')
  for (const row of rows)
    if (!row || typeof row.key !== 'string' || !row.key || row.key.length > 2048)
      throw Error('Invalid staging key')
}
function newJob(scope: BackupScope, purpose: BackupStageJob['purpose']): BackupStageJob {
  assertServiceScope(scope)
  return {
    id: crypto.randomUUID(),
    scope: clone(scope),
    createdAt: new Date().toISOString(),
    purpose,
    state: 'staging',
    sections: [],
    attempted: [],
  }
}
function assertJob(job: BackupStageJob | undefined, scope: BackupScope, id: string): BackupStageJob {
  if (!job || !validId(id) || job.id !== id) throw Error('Local backup stage is unavailable')
  assertMatchingScope(scope, job.scope)
  return job
}
function scopeToken(scope: BackupScope) {
  assertServiceScope(scope)
  return JSON.stringify([
    scope.productId,
    scope.channel,
    scope.installationId ?? null,
    scope.ownerId ?? null,
  ])
}
/** One known, separately scoped database; never enumerates or upgrades provider databases. */
export async function backupStageDatabaseName(scope: BackupScope): Promise<string> {
  const bytes = new TextEncoder().encode(scopeToken(scope))
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `koba-backup-stage-${scope.productId}-${scope.channel}-${digest}`
}
class StageDatabase extends Dexie {
  jobs!: Table<BackupStageJob, string>
  rows!: Table<StoredRow, [string, BackupStageBucket, string, string]>
  seals!: Table<StoredSeal, [string, BackupStageBucket, string]>
  parts!: Table<StoredPart, [string, string]>
  constructor(name: string) {
    super(name)
    this.version(1).stores({
      jobs: '&id',
      rows: '&[job+bucket+section+key], job, [job+bucket+section]',
      seals: '&[job+bucket+section], job',
      parts: '&[job+path], job',
    })
  }
}
class DexieBackupStage implements BackupStage {
  readonly reference: BackupRecoveryReference
  private readonly readers = new Map<string, BackupRowReader>()
  constructor(
    private readonly db: StageDatabase,
    scope: BackupScope,
    private readonly id: string,
  ) {
    this.reference = Object.freeze({ id, scope: Object.freeze(clone(scope)) })
  }
  async job() {
    return this.readJob()
  }
  private async readJob(transaction?: Transaction) {
    // Staged readers cross async iterators/provider transactions. Internal
    // writes bind their tables explicitly instead of relying on an ambient zone.
    const jobs = transaction?.table<BackupStageJob, string>('jobs') ?? this.db.jobs
    return clone(assertJob(await jobs.get(this.id), this.reference.scope, this.id))
  }
  async update(patch: Partial<Pick<BackupStageJob, 'purpose' | 'state' | 'sections' | 'attempted'>>) {
    await this.db.transaction('rw', this.db.jobs, async (transaction) => {
      const job = await this.readJob(transaction)
      await transaction.table<BackupStageJob, string>('jobs').put({ ...job, ...clone(patch) })
    })
  }
  async addRows(bucket: BackupStageBucket, section: string, rows: readonly BackupRow[]) {
    assertRows(section, rows)
    await this.db.transaction('rw', this.db.jobs, this.db.rows, this.db.seals, async (transaction) => {
      await this.readJob(transaction)
      const seals = transaction.table<StoredSeal, [string, BackupStageBucket, string]>('seals')
      const key: [string, BackupStageBucket, string] = [this.id, bucket, section]
      const seal = (await seals.get(key)) ?? {
        job: this.id,
        bucket,
        section,
        count: 0,
        sealed: false,
      }
      if (seal.sealed || !Number.isSafeInteger(seal.count + rows.length))
        throw Error('Sealed or excessive staging section')
      // BulkAdd failures escape the transaction, so a duplicate cannot leave a partial batch.
      await transaction
        .table<StoredRow, [string, BackupStageBucket, string, string]>('rows')
        .bulkAdd(rows.map((row) => ({ job: this.id, bucket, section, key: row.key, value: row.value })))
      await seals.put({ ...seal, count: seal.count + rows.length })
    })
  }
  async seal(bucket: BackupStageBucket, section: string): Promise<BackupRowReader> {
    if (!validSection(section)) throw Error('Invalid staging section')
    await this.db.transaction('rw', this.db.jobs, this.db.seals, async (transaction) => {
      await this.readJob(transaction)
      const seals = transaction.table<StoredSeal, [string, BackupStageBucket, string]>('seals')
      const seal = (await seals.get([this.id, bucket, section])) ?? {
        job: this.id,
        bucket,
        section,
        count: 0,
        sealed: false,
      }
      await seals.put({ ...seal, sealed: true })
    })
    return this.reader(bucket, section)
  }
  async reader(bucket: BackupStageBucket, section: string): Promise<BackupRowReader> {
    await this.job()
    const seal = await this.db.seals.get([this.id, bucket, section])
    if (!seal?.sealed) throw Error('Backup stage is not sealed')
    const cached = this.readers.get(`${bucket}:${section}`)
    if (cached) return cached
    const count = seal.count,
      db = this.db,
      job = this.id,
      requireJob = () => this.job()
    const reader: BackupRowReader = Object.freeze({
      count,
      async *rows() {
        let previous: string | undefined,
          seen = 0
        while (true) {
          await requireJob()
          // Page only bounded keys; fetch values one at a time, since one portable
          // record can itself be several MiB. 256 whole values would not be small.
          const page = await db.rows
            .where('[job+bucket+section+key]')
            .between(
              [job, bucket, section, previous ?? Dexie.minKey],
              [job, bucket, section, Dexie.maxKey],
              previous === undefined,
              true,
            )
            .limit(256)
            .primaryKeys()
          if (!page.length) break
          for (const key of page) {
            await requireJob()
            const row = await db.rows.get(key)
            if (!row || (previous !== undefined && row.key <= previous))
              throw Error('Changed or unordered staging rows')
            previous = row.key
            seen++
            yield { key: row.key, value: row.value }
          }
        }
        if (seen !== count) throw Error('Backup stage changed during reading')
      },
      async get(key: string) {
        await requireJob()
        const row = await db.rows.get([job, bucket, section, key])
        return row ? { key: row.key, value: row.value } : undefined
      },
    })
    this.readers.set(`${bucket}:${section}`, reader)
    return reader
  }
  async addPart(part: BackupStagePart) {
    await this.job()
    await this.db.parts.add({ ...clone(part), job: this.id })
  }
  async part(path: string) {
    await this.job()
    const row = await this.db.parts.get([this.id, path])
    return row ? { path: row.path, sha256: row.sha256, rows: row.rows } : undefined
  }
  async partCount() {
    await this.job()
    return this.db.parts.where('job').equals(this.id).count()
  }
  async discard() {
    await this.db.transaction(
      'rw',
      this.db.jobs,
      this.db.rows,
      this.db.seals,
      this.db.parts,
      async (transaction) => {
        await this.readJob(transaction)
        const rows = transaction.table<StoredRow, [string, BackupStageBucket, string, string]>('rows')
        const seals = transaction.table<StoredSeal, [string, BackupStageBucket, string]>('seals')
        const parts = transaction.table<StoredPart, [string, string]>('parts')
        // Collection.delete() can collect every matching key; purge bounded pages.
        while (true) {
          const keys = await rows.where('job').equals(this.id).limit(256).primaryKeys()
          if (!keys.length) break
          await rows.bulkDelete(keys)
        }
        while (true) {
          const keys = await seals.where('job').equals(this.id).limit(256).primaryKeys()
          if (!keys.length) break
          await seals.bulkDelete(keys)
        }
        while (true) {
          const keys = await parts.where('job').equals(this.id).limit(256).primaryKeys()
          if (!keys.length) break
          await parts.bulkDelete(keys)
        }
        await transaction.table<BackupStageJob, string>('jobs').delete(this.id)
      },
    )
  }
  close() {
    this.db.close()
  }
}
/** Lazy: no database is opened until an explicit backup/recovery operation. */
export const dexieBackupStageFactory: BackupStageFactory = {
  persistent: true,
  async create(scope, purpose) {
    const db = new StageDatabase(await backupStageDatabaseName(scope))
    try {
      const job = newJob(scope, purpose)
      await db.jobs.add(job)
      return new DexieBackupStage(db, scope, job.id)
    } catch (error) {
      db.close()
      throw error
    }
  },
  async open(scope, id) {
    if (!validId(id)) throw Error('Invalid recovery identity')
    const db = new StageDatabase(await backupStageDatabaseName(scope))
    try {
      assertJob(await db.jobs.get(id), scope, id)
      return new DexieBackupStage(db, scope, id)
    } catch (error) {
      db.close()
      throw error
    }
  },
  async list(scope) {
    const name = await backupStageDatabaseName(scope)
    // Checking only this exact scoped name does not enumerate the host's databases.
    if (!(await Dexie.exists(name))) return []
    const db = new StageDatabase(name)
    try {
      return (await db.jobs.toArray()).map((job) => clone(assertJob(job, scope, job.id)))
    } finally {
      db.close()
    }
  },
}

/** Synthetic Lab factory. All rows/jobs live only in this closure; it never touches IndexedDB. */
export function createMemoryBackupStage(maxBytes = 128 * 1024 * 1024): BackupStageFactory {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw Error('Invalid synthetic staging memory limit')
  interface MemoryJob {
    job: BackupStageJob
    bytes: number
    rows: Map<string, Map<string, BackupRow>>
    seals: Map<string, number>
    parts: Map<string, BackupStagePart>
  }
  let retainedBytes = 0
  const scopes = new Map<string, Map<string, MemoryJob>>()
  const collection = (scope: BackupScope) => {
    const key = scopeToken(scope)
    let jobs = scopes.get(key)
    if (!jobs) {
      jobs = new Map()
      scopes.set(key, jobs)
    }
    return jobs
  }
  const wrap = (scope: BackupScope, id: string): BackupStage => {
    const readers = new Map<string, BackupRowReader>()
    const jobs = collection(scope),
      require = () => {
        const stored = jobs.get(id)
        assertJob(stored?.job, scope, id)
        return stored as MemoryJob
      }
    const keyOf = (bucket: BackupStageBucket, section: string) => `${bucket}:${section}`
    const reader = async (bucket: BackupStageBucket, section: string): Promise<BackupRowReader> => {
      const key = keyOf(bucket, section),
        stored = require(),
        count = stored.seals.get(key)
      if (count === undefined) throw Error('Backup stage is not sealed')
      const cached = readers.get(key)
      if (cached) return cached
      const result: BackupRowReader = Object.freeze({
        count,
        async *rows() {
          const values = require().rows.get(key)
          const keys = [...(values?.keys() ?? [])].sort()
          if (keys.length !== count) throw Error('Backup stage changed')
          for (const rowKey of keys) {
            require()
            const row = values?.get(rowKey)
            if (!row) throw Error('Backup stage changed')
            yield clone(row)
          }
        },
        async get(rowKey: string) {
          const row = require().rows.get(key)?.get(rowKey)
          return row && clone(row)
        },
      })
      readers.set(key, result)
      return result
    }
    return {
      reference: Object.freeze({ id, scope: Object.freeze(clone(scope)) }),
      async job() {
        return clone(require().job)
      },
      async update(patch) {
        const stored = require()
        stored.job = { ...stored.job, ...clone(patch) }
      },
      async addRows(bucket, section, rows) {
        assertRows(section, rows)
        const stored = require(),
          key = keyOf(bucket, section)
        if (stored.seals.has(key)) throw Error('Sealed staging section')
        const map = stored.rows.get(key) ?? new Map<string, BackupRow>()
        const keys = new Set<string>()
        let bytes = 0
        for (const row of rows) {
          if (map.has(row.key) || keys.has(row.key)) throw Error('Duplicate staging row')
          keys.add(row.key)
          bytes += new TextEncoder().encode(JSON.stringify(row)).length
        }
        if (retainedBytes + bytes > maxBytes)
          throw Error('Synthetic backup exceeds the in-memory Lab limit')
        const copies = rows.map(clone)
        for (const row of copies) map.set(row.key, row)
        stored.rows.set(key, map)
        stored.bytes += bytes
        retainedBytes += bytes
      },
      async seal(bucket, section) {
        if (!validSection(section)) throw Error('Invalid staging section')
        const stored = require(),
          key = keyOf(bucket, section)
        stored.seals.set(key, stored.rows.get(key)?.size ?? 0)
        return reader(bucket, section)
      },
      reader,
      async addPart(part) {
        const stored = require()
        if (stored.parts.has(part.path)) throw Error('Duplicate backup part')
        stored.parts.set(part.path, clone(part))
      },
      async part(path) {
        const part = require().parts.get(path)
        return part && clone(part)
      },
      async partCount() {
        return require().parts.size
      },
      async discard() {
        const stored = require()
        retainedBytes -= stored.bytes
        jobs.delete(id)
      },
      close() {},
    }
  }
  return {
    persistent: false,
    async create(scope, purpose) {
      const job = newJob(scope, purpose)
      collection(scope).set(job.id, {
        job,
        bytes: 0,
        rows: new Map(),
        seals: new Map(),
        parts: new Map(),
      })
      return wrap(scope, job.id)
    },
    async open(scope, id) {
      const stage = wrap(scope, id)
      await stage.job()
      return stage
    },
    async list(scope) {
      return [...collection(scope).values()].map((stored) => clone(stored.job))
    },
  }
}
