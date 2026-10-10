/** Provider-neutral journaled migration application logic. No source schema or UI. */
export type MigrationPhase = 'staging' | 'validating' | 'failed_recoverable' | 'ready'
export type WorkingMigrationPhase = 'staging' | 'validating'

export interface MigrationJournal {
  readonly scope: string
  readonly plan: string
  readonly sourceFingerprint: string
  readonly generation: string
  readonly previousGeneration: string | null
  readonly phase: MigrationPhase
  readonly resumePhase: WorkingMigrationPhase
  readonly cursor: string | null
  readonly stagedRecords: number
  readonly committedBatches: number
}
export interface ActiveMigrationGeneration {
  readonly scope: string
  readonly plan: string
  readonly sourceFingerprint: string
  readonly generation: string
  readonly previousGeneration: string | null
}
export interface MigrationState {
  readonly active: ActiveMigrationGeneration | null
  readonly journal: MigrationJournal | null
}
export interface MigrationBatch<T> {
  readonly records: readonly T[]
  readonly nextCursor: string | null
  readonly exhausted: boolean
  readonly sourceFingerprint: string
}
export interface MigrationStagedRecord {
  readonly store: string
  readonly value: Record<string, unknown>
}
export interface MigrationDriver {
  read(scope: string): Promise<MigrationState>
  begin(journal: MigrationJournal, previous: ActiveMigrationGeneration | null): Promise<void>
  resume(journal: MigrationJournal): Promise<void>
  /** Must write staged rows AND checkpoint atomically, checking the old journal. */
  commitBatch(
    old: MigrationJournal,
    next: MigrationJournal,
    rows: readonly MigrationStagedRecord[],
  ): Promise<void>
  advance(old: MigrationJournal, next: MigrationJournal): Promise<void>
  /** Must atomically fence previous active generation and activate the new one. */
  activate(old: MigrationJournal, manifest: ActiveMigrationGeneration): Promise<void>
  markRecoverable(journal: MigrationJournal): Promise<void>
}
export interface MigrationLock {
  /** Must be exclusive across browser tabs for this scope. */
  exclusive<T>(scope: string, operation: () => Promise<T>): Promise<T>
}
export interface MigrationSource<T> {
  fingerprint(): Promise<string>
  readPage(cursor: string | null, count: number): Promise<MigrationBatch<T>>
  transform(records: readonly T[], generation: string): Promise<readonly MigrationStagedRecord[]>
}
export interface MigrationAcceptance {
  /** Must confirm an independently restorable backup, including when resuming. */
  verifyBackup(sourceFingerprint: string, prior: ActiveMigrationGeneration | null): Promise<void>
  /** Must validate staged generation, source evidence, identities and counts. */
  validate(journal: MigrationJournal): Promise<{
    readonly generation: string
    readonly sourceFingerprint: string
    readonly valid: true
  }>
}
export interface StagedMigrationOptions<T> {
  readonly scope: string
  readonly plan: string
  readonly pageSize: number
  readonly driver: MigrationDriver
  readonly lock: MigrationLock
  readonly source: MigrationSource<T>
  readonly acceptance: MigrationAcceptance
  readonly newGeneration: () => string
  readonly stopped?: () => boolean
  readonly signal?: AbortSignal
}
export interface StagedMigrationResult {
  readonly status: 'ready' | 'paused'
  readonly generation: string
  readonly previousGeneration: string | null
  readonly stagedRecords: number
}
function required(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024)
    throw Error('Invalid migration ' + label)
  return value
}
function aborted(): DOMException {
  return new DOMException('Migration cancelled', 'AbortError')
}
function ensureRunning(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted()
}
function assertJournal(j: MigrationJournal, scope: string, plan: string, fingerprint: string): void {
  if (
    j.scope !== scope ||
    j.plan !== plan ||
    j.sourceFingerprint !== fingerprint ||
    typeof j.generation !== 'string' ||
    !j.generation ||
    (j.previousGeneration !== null && typeof j.previousGeneration !== 'string') ||
    (j.cursor !== null && (typeof j.cursor !== 'string' || !j.cursor)) ||
    !Number.isSafeInteger(j.stagedRecords) ||
    j.stagedRecords < 0 ||
    !Number.isSafeInteger(j.committedBatches) ||
    j.committedBatches < 0 ||
    !['staging', 'validating', 'failed_recoverable', 'ready'].includes(j.phase) ||
    !['staging', 'validating'].includes(j.resumePhase)
  )
    throw Error('Migration journal incompatible with source or plan')
}
export async function runStagedMigration<T>(
  options: StagedMigrationOptions<T>,
): Promise<StagedMigrationResult> {
  const scope = required(options.scope, 'scope'),
    plan = required(options.plan, 'plan')
  if (!Number.isSafeInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1024)
    throw RangeError('Invalid migration page size')
  return options.lock.exclusive(scope, async () => {
    ensureRunning(options.signal)
    const fingerprint = required(await options.source.fingerprint(), 'source fingerprint')
    const snapshot = await options.driver.read(scope)
    const active = snapshot.active
    if (
      active &&
      (active.scope !== scope ||
        !active.generation ||
        !active.plan ||
        !active.sourceFingerprint ||
        (active.previousGeneration !== null && typeof active.previousGeneration !== 'string'))
    )
      throw Error('Invalid active migration manifest')
    if (
      active &&
      active.plan === plan &&
      active.sourceFingerprint === fingerprint &&
      (!snapshot.journal ||
        (snapshot.journal.generation === active.generation && snapshot.journal.phase === 'ready'))
    )
      return {
        status: 'ready' as const,
        generation: active.generation,
        previousGeneration: active.previousGeneration,
        stagedRecords: snapshot.journal?.stagedRecords ?? 0,
      }
    // A READY journal belongs to the previously active generation. A new
    // explicit plan can rotate it; unfinished work is never silently discarded.
    let journal = snapshot.journal
    if (journal?.phase === 'ready') {
      if (
        !active ||
        journal.scope !== scope ||
        journal.generation !== active.generation ||
        journal.plan !== active.plan ||
        journal.sourceFingerprint !== active.sourceFingerprint
      )
        throw Error('Ready migration journal lacks its matching active manifest')
      journal = null
    } else if (journal) {
      assertJournal(journal, scope, plan, fingerprint)
      if (journal.previousGeneration !== (active?.generation ?? null))
        throw Error('Migration previous generation changed')
    }
    await options.acceptance.verifyBackup(fingerprint, active)
    ensureRunning(options.signal)
    if (!journal) {
      journal = {
        scope,
        plan,
        sourceFingerprint: fingerprint,
        generation: required(options.newGeneration(), 'generation'),
        previousGeneration: active?.generation ?? null,
        phase: 'staging',
        resumePhase: 'staging',
        cursor: null,
        stagedRecords: 0,
        committedBatches: 0,
      }
      if (journal.generation === active?.generation) throw Error('Migration generation reused')
      await options.driver.begin(journal, active)
    } else if (journal.phase === 'failed_recoverable') {
      await options.driver.resume(journal)
      journal = { ...journal, phase: journal.resumePhase }
    }
    let working = journal
    try {
      while (working.phase === 'staging') {
        ensureRunning(options.signal)
        if (options.stopped?.())
          return {
            status: 'paused' as const,
            generation: working.generation,
            previousGeneration: working.previousGeneration,
            stagedRecords: working.stagedRecords,
          }
        const page = await options.source.readPage(working.cursor, options.pageSize)
        if (page.sourceFingerprint !== fingerprint)
          throw Error('Migration source changed during staging')
        if (!Array.isArray(page.records) || typeof page.exhausted !== 'boolean')
          throw Error('Invalid migration source page')
        if (page.records.length > options.pageSize) throw Error('Migration page exceeds bound')
        if (!page.records.length && !page.exhausted) throw Error('Migration source made no progress')
        if (page.records.length) {
          const nextCursor = required(page.nextCursor ?? '', 'cursor')
          if (nextCursor === working.cursor) throw Error('Migration cursor did not advance')
          const staged = await options.source.transform(page.records, working.generation)
          if (!Array.isArray(staged)) throw Error('Invalid staged migration rows')
          ensureRunning(options.signal)
          const next: MigrationJournal = {
            ...working,
            cursor: nextCursor,
            stagedRecords: working.stagedRecords + page.records.length,
            committedBatches: working.committedBatches + 1,
          }
          await options.driver.commitBatch(working, next, staged)
          working = next
        }
        if (page.exhausted) {
          const next: MigrationJournal = { ...working, phase: 'validating', resumePhase: 'validating' }
          await options.driver.advance(working, next)
          working = next
        }
      }
      ensureRunning(options.signal)
      if (options.stopped?.())
        return {
          status: 'paused' as const,
          generation: working.generation,
          previousGeneration: working.previousGeneration,
          stagedRecords: working.stagedRecords,
        }
      const proof = await options.acceptance.validate(working)
      if (
        proof.valid !== true ||
        proof.generation !== working.generation ||
        proof.sourceFingerprint !== fingerprint
      )
        throw Error('Staged generation validation failed')
      ensureRunning(options.signal)
      const manifest: ActiveMigrationGeneration = {
        scope,
        plan,
        sourceFingerprint: fingerprint,
        generation: working.generation,
        previousGeneration: working.previousGeneration,
      }
      await options.driver.activate(working, manifest)
      return {
        status: 'ready' as const,
        generation: working.generation,
        previousGeneration: working.previousGeneration,
        stagedRecords: working.stagedRecords,
      }
    } catch (error) {
      // An annotation failure must never replace the original write/validation error.
      try {
        await options.driver.markRecoverable(working)
      } catch {
        /* original error wins */
      }
      throw error
    }
  })
}
/** No per-tab in-memory fallback: the provider must support cross-tab Web Locks. */
export function browserMigrationLock(prefix: string): MigrationLock {
  required(prefix, 'lock prefix')
  return {
    async exclusive<T>(scope: string, operation: () => Promise<T>): Promise<T> {
      if (typeof navigator === 'undefined' || !navigator.locks?.request)
        throw Error('Cross-tab migration lock unavailable')
      return navigator.locks.request(prefix + ':' + scope, { mode: 'exclusive' }, operation)
    },
  }
}
