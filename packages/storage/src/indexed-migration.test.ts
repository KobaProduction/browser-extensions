import { expect, test } from 'bun:test'
import { indexedMigrationDriver } from './indexed-migration'
import { runStagedMigration } from './migration'

// Narrow transaction mock: requests complete asynchronously; writes become
// visible only at the transaction's complete event, abort discards them.
function syntheticDatabase() {
  const tables = new Map<string, Map<string, unknown>>([
    ['migrationManifest', new Map()],
    ['migrationJournal', new Map()],
    ['staged', new Map()],
  ])
  const db = {
    objectStoreNames: [...tables.keys()],
    transaction(stores: string[], mode: 'readonly' | 'readwrite') {
      const events = new EventTarget()
      let pending = 0
      let completed = false
      let scheduled = false
      const writes: Array<() => void> = []
      const check = () => {
        if (scheduled || completed) return
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          if (pending || completed) return
          completed = true
          for (const apply of writes) apply()
          events.dispatchEvent(new Event('complete'))
        })
      }
      const tx = Object.assign(events, {
        error: null,
        abort() {
          if (completed) throw Error('already settled')
          completed = true
          writes.length = 0
          events.dispatchEvent(new Event('abort'))
        },
        objectStore(name: string) {
          if (!stores.includes(name)) throw Error('store not in transaction')
          const table = tables.get(name)
          if (!table) throw Error('Unknown store')
          return {
            get(key: string) {
              pending++
              const request: {
                result: unknown
                onsuccess: ((event: Event) => void) | null
                onerror: null
              } = {
                result: undefined,
                onsuccess: null,
                onerror: null,
              }
              queueMicrotask(() => {
                if (completed) return
                request.result = table.get(key)
                pending--
                request.onsuccess?.(new Event('success'))
                check()
              })
              return request
            },
            put(value: Record<string, unknown>) {
              if (mode !== 'readwrite') throw Error('readonly transaction')
              const key = String(value.scope ?? value.key)
              if (!key || key === 'undefined') throw Error('missing key')
              writes.push(() => table.set(key, structuredClone(value)))
              check()
            },
          }
        },
      })
      check()
      return tx
    },
  } as unknown as IDBDatabase
  return { db, tables }
}

test('IndexedDB migration journal and generation activation commit atomically', async () => {
  const { db, tables } = syntheticDatabase()
  const driver = indexedMigrationDriver({
    db,
    journalStore: 'migrationJournal',
    manifestStore: 'migrationManifest',
    stagingStores: ['staged'],
    validateStagedRecord: (record, generation) => record.value.key === generation + ':one',
  })
  let verifiedBackup = false
  const ready = await runStagedMigration({
    scope: 'account',
    plan: 'normalize',
    pageSize: 2,
    driver,
    lock: { exclusive: async (_scope, execute) => execute() },
    newGeneration: () => 'generation-1',
    source: {
      fingerprint: async () => 'fingerprint-v1',
      readPage: async () => ({
        records: ['one'],
        sourceFingerprint: 'fingerprint-v1',
        nextCursor: 'end',
        exhausted: true,
      }),
      transform: async (records, generation) =>
        records.map((value) => ({
          store: 'staged',
          value: { key: generation + ':' + value, generation },
        })),
    },
    acceptance: {
      async verifyBackup() {
        verifiedBackup = true
      },
      async validate(journal) {
        expect(verifiedBackup).toBe(true)
        expect(tables.get('staged')?.has('generation-1:one')).toBe(true)
        expect(tables.get('migrationManifest')?.size).toBe(0)
        return {
          valid: true,
          generation: journal.generation,
          sourceFingerprint: journal.sourceFingerprint,
        }
      },
    },
  })
  expect(ready.status).toBe('ready')
  expect(tables.get('migrationManifest')?.get('account')).toMatchObject({
    generation: 'generation-1',
    previousGeneration: null,
  })
  expect(tables.get('migrationJournal')?.get('account')).toMatchObject({
    phase: 'ready',
    cursor: 'end',
    committedBatches: 1,
  })
  const snapshot = await driver.read('account')
  const newJournal = {
    scope: 'account',
    plan: 'normalize-next',
    sourceFingerprint: 'fingerprint-v2',
    generation: 'generation-2',
    previousGeneration: 'generation-1',
    phase: 'staging' as const,
    resumePhase: 'staging' as const,
    cursor: null,
    stagedRecords: 0,
    committedBatches: 0,
  }
  await driver.begin(newJournal, snapshot.active)
  expect((await driver.read('account')).active?.generation).toBe('generation-1')
  expect((await driver.read('account')).journal).toMatchObject({
    plan: 'normalize-next',
    generation: 'generation-2',
    phase: 'staging',
  })
})

test('IndexedDB driver rejects wrong-generation rows without corrupting checkpoint', async () => {
  const { db, tables } = syntheticDatabase()
  const driver = indexedMigrationDriver({
    db,
    journalStore: 'migrationJournal',
    manifestStore: 'migrationManifest',
    stagingStores: ['staged'],
    validateStagedRecord: () => true,
  })
  const journal = {
    scope: 'account',
    plan: 'normalize',
    sourceFingerprint: 'fingerprint-v1',
    generation: 'generation-2',
    previousGeneration: null,
    phase: 'staging' as const,
    resumePhase: 'staging' as const,
    cursor: null,
    stagedRecords: 0,
    committedBatches: 0,
  }
  await driver.begin(journal, null)
  await expect(
    driver.commitBatch(
      journal,
      {
        ...journal,
        cursor: 'page-1',
        stagedRecords: 1,
        committedBatches: 1,
      },
      [{ store: 'staged', value: { key: 'generation-old:one', generation: 'generation-old' } }],
    ),
  ).rejects.toThrow('not generation-scoped')
  expect(tables.get('staged')?.size).toBe(0)
  expect(await driver.read('account')).toMatchObject({
    active: null,
    journal: { generation: 'generation-2', cursor: null, committedBatches: 0 },
  })
})
