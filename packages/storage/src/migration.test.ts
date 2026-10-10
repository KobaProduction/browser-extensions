import { expect, test } from 'bun:test'
import {
  type ActiveMigrationGeneration,
  type MigrationDriver,
  type MigrationJournal,
  type MigrationStagedRecord,
  type MigrationState,
  runStagedMigration,
} from './migration'

function memoryDriver(previous: ActiveMigrationGeneration | null = null) {
  let active = previous
  let journal: MigrationJournal | null = null
  const staged = new Map<string, MigrationStagedRecord>()
  let failOnBatch = 0
  let committed = 0
  let activations = 0
  let backups = 0
  const same = (left: MigrationJournal | null, right: MigrationJournal) =>
    left?.generation === right.generation &&
    left.cursor === right.cursor &&
    left.committedBatches === right.committedBatches &&
    left.phase === right.phase
  const driver: MigrationDriver = {
    async read(): Promise<MigrationState> {
      return { active, journal }
    },
    async begin(next, expected) {
      if (
        (journal && !(journal.phase === 'ready' && journal.generation === active?.generation)) ||
        active?.generation !== expected?.generation
      )
        throw Error('stale migration start')
      journal = next
    },
    async resume(old) {
      if (!same(journal, old)) throw Error('stale migration resume')
      journal = { ...old, phase: old.resumePhase }
    },
    async commitBatch(old, next, records) {
      if (!same(journal, old)) throw Error('stale migration batch')
      if (++committed === failOnBatch) throw Error('interrupted durable commit')
      for (const record of records) {
        if (record.value.generation !== next.generation) throw Error('wrong generation')
        staged.set(String(record.value.key), record)
      }
      journal = next
    },
    async advance(old, next) {
      if (!same(journal, old)) throw Error('stale migration advance')
      journal = next
    },
    async activate(old, next) {
      if (!same(journal, old) || old.phase !== 'validating') throw Error('invalid activation')
      active = next
      journal = { ...old, phase: 'ready' }
      activations++
    },
    async markRecoverable(old) {
      if (!same(journal, old)) return
      journal = {
        ...old,
        phase: 'failed_recoverable',
        resumePhase: old.phase === 'validating' ? 'validating' : 'staging',
      }
    },
  }
  const sourceItems = ['a', 'b', 'c', 'd', 'e']
  const source = {
    fingerprint: async () => 'snapshot-v1',
    async readPage(cursor: string | null, count: number) {
      const start = cursor === null ? 0 : Number(cursor)
      return {
        records: sourceItems.slice(start, start + count),
        nextCursor: String(Math.min(start + count, sourceItems.length)),
        exhausted: start + count >= sourceItems.length,
        sourceFingerprint: 'snapshot-v1',
      }
    },
    async transform(items: readonly string[], generation: string) {
      return items.map((key) => ({
        store: 'staged',
        value: { key: generation + ':' + key, generation },
      }))
    },
  }
  const lock = { exclusive: async <T>(_scope: string, fn: () => Promise<T>) => fn() }
  const acceptance = {
    async verifyBackup() {
      backups++
    },
    async validate(current: MigrationJournal) {
      if (
        [...staged.values()].filter((row) => row.value.generation === current.generation).length !==
        sourceItems.length
      )
        throw Error('staged rows missing')
      return {
        valid: true as const,
        generation: current.generation,
        sourceFingerprint: current.sourceFingerprint,
      }
    },
  }
  const options = {
    scope: 'account-1',
    plan: 'convert-v1',
    pageSize: 2,
    driver,
    lock,
    source,
    acceptance,
    newGeneration: () => 'generation-new',
  }
  return {
    options,
    source,
    acceptance,
    staged,
    setFailOnBatch: (value: number) => {
      failOnBatch = value
    },
    get journal() {
      return journal
    },
    get active() {
      return active
    },
    get activations() {
      return activations
    },
    get backups() {
      return backups
    },
  }
}

test('journaled migration resumes from acknowledged pages without switching active generation early', async () => {
  const previous = {
    scope: 'account-1',
    plan: 'previous',
    sourceFingerprint: 'old',
    generation: 'generation-old',
    previousGeneration: null,
  }
  const fixture = memoryDriver(previous)
  fixture.setFailOnBatch(2)
  await expect(runStagedMigration(fixture.options)).rejects.toThrow('interrupted durable commit')
  expect(fixture.active?.generation).toBe('generation-old')
  expect(fixture.journal).toMatchObject({
    generation: 'generation-new',
    cursor: '2',
    stagedRecords: 2,
    committedBatches: 1,
    phase: 'failed_recoverable',
  })
  fixture.setFailOnBatch(0)
  const result = await runStagedMigration(fixture.options)
  expect(result).toEqual({
    status: 'ready',
    generation: 'generation-new',
    previousGeneration: 'generation-old',
    stagedRecords: 5,
  })
  expect(fixture.staged.size).toBe(5)
  expect(fixture.activations).toBe(1)
  expect(fixture.backups).toBe(2)
  await runStagedMigration(fixture.options)
  expect(fixture.activations).toBe(1)
})

test('refuses changing the source fingerprint or plan for a staged generation', async () => {
  const fixture = memoryDriver()
  fixture.setFailOnBatch(2)
  await expect(runStagedMigration(fixture.options)).rejects.toThrow('interrupted durable commit')
  const next = {
    ...fixture.options,
    source: { ...fixture.source, fingerprint: async () => 'changed-snapshot' },
  }
  await expect(runStagedMigration(next)).rejects.toThrow('Migration journal incompatible')
  await expect(runStagedMigration({ ...fixture.options, plan: 'different' })).rejects.toThrow(
    'Migration journal incompatible',
  )
  expect(fixture.journal?.cursor).toBe('2')
  expect(fixture.active).toBeNull()
})

test('requires backup and validation before activation; a validation failure is resumable', async () => {
  const fixture = memoryDriver()
  const noBackup = {
    ...fixture.options,
    acceptance: {
      ...fixture.acceptance,
      async verifyBackup() {
        throw Error('no backup')
      },
    },
  }
  await expect(runStagedMigration(noBackup)).rejects.toThrow('no backup')
  expect(fixture.journal).toBeNull()
  let accept = false
  const gate = {
    ...fixture.options,
    acceptance: {
      ...fixture.acceptance,
      async validate(journal: MigrationJournal) {
        if (!accept) throw Error('stage not verified')
        return fixture.acceptance.validate(journal)
      },
    },
  }
  await expect(runStagedMigration(gate)).rejects.toThrow('stage not verified')
  expect(fixture.active).toBeNull()
  expect(fixture.journal).toMatchObject({
    phase: 'failed_recoverable',
    resumePhase: 'validating',
    cursor: '5',
  })
  accept = true
  const next = await runStagedMigration(gate)
  expect(next.status).toBe('ready')
  expect(fixture.active?.generation).toBe('generation-new')
})

test('subsequent migration plan rotates only the already active READY generation', async () => {
  const fixture = memoryDriver()
  await runStagedMigration(fixture.options)
  const next = await runStagedMigration({
    ...fixture.options,
    plan: 'normalize-v2',
    newGeneration: () => 'generation-next',
  })
  expect(next).toMatchObject({
    status: 'ready',
    generation: 'generation-next',
    previousGeneration: 'generation-new',
  })
  expect(fixture.active?.generation).toBe('generation-next')
  expect(fixture.staged.size).toBe(10)
})
