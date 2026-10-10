import { requestResult, transactionComplete } from './indexed-requests'
import type {
  ActiveMigrationGeneration,
  MigrationDriver,
  MigrationJournal,
  MigrationStagedRecord,
  MigrationState,
} from './migration'

/** Existing DB stores are provided by the product's versioned schema upgrader. */
export interface IndexedMigrationStoreOptions {
  readonly db: IDBDatabase
  readonly journalStore: string
  readonly manifestStore: string
  readonly stagingStores: readonly string[]
  /**
   * Mandatory domain validation: records must be generation-scoped and must
   * never overwrite currently active records. Key format is source-owned.
   */
  readonly validateStagedRecord: (record: MigrationStagedRecord, generation: string) => boolean
}
function sameJournal(a: MigrationJournal | undefined, b: MigrationJournal): boolean {
  return (
    !!a &&
    a.scope === b.scope &&
    a.plan === b.plan &&
    a.sourceFingerprint === b.sourceFingerprint &&
    a.generation === b.generation &&
    a.previousGeneration === b.previousGeneration &&
    a.phase === b.phase &&
    a.resumePhase === b.resumePhase &&
    a.cursor === b.cursor &&
    a.stagedRecords === b.stagedRecords &&
    a.committedBatches === b.committedBatches
  )
}
function sameActive(a: ActiveMigrationGeneration | null, b: ActiveMigrationGeneration | null): boolean {
  return (
    a?.generation === b?.generation &&
    a?.plan === b?.plan &&
    a?.sourceFingerprint === b?.sourceFingerprint &&
    a?.scope === b?.scope
  )
}
function requireSchema(options: IndexedMigrationStoreOptions): void {
  if (options.journalStore === options.manifestStore)
    throw Error('Migration journal and manifest stores must differ')
  const names = new Set(options.db.objectStoreNames)
  for (const name of [options.journalStore, options.manifestStore, ...options.stagingStores])
    if (!names.has(name)) throw Error('Migration schema missing store: ' + name)
  if (
    options.stagingStores.includes(options.journalStore) ||
    options.stagingStores.includes(options.manifestStore)
  )
    throw Error('Journal/manifest stores cannot stage source records')
  if (typeof options.validateStagedRecord !== 'function')
    throw Error('Migration staging validator is required')
}
export function indexedMigrationDriver(options: IndexedMigrationStoreOptions): MigrationDriver {
  requireSchema(options)
  const allowed = new Set(options.stagingStores)
  const { db, journalStore, manifestStore } = options

  /** Every transaction completes before the next mutation stage is acknowledged. */
  async function mutation(
    stores: readonly string[],
    apply: (tx: IDBTransaction, fail: (error: unknown) => void) => void,
  ): Promise<void> {
    const tx = db.transaction(stores, 'readwrite')
    const committed = transactionComplete(tx)
    let failure: unknown
    const fail = (error: unknown): void => {
      if (failure !== undefined) return
      failure = error
      try {
        tx.abort()
      } catch {
        /* the transaction is settled */
      }
    }
    try {
      apply(tx, fail)
    } catch (error) {
      fail(error)
    }
    try {
      await committed
    } catch (error) {
      throw failure ?? error
    }
    if (failure !== undefined) throw failure
  }

  function load<T>(
    tx: IDBTransaction,
    store: string,
    scope: string,
    callback: (value: T | undefined) => void,
    fail: (error: unknown) => void,
  ): void {
    const request = tx.objectStore(store).get(scope)
    request.onsuccess = () => {
      try {
        callback(request.result as T | undefined)
      } catch (error) {
        fail(error)
      }
    }
  }

  function mutateJournal(expected: MigrationJournal, update: MigrationJournal): Promise<void> {
    return mutation([journalStore], (tx, fail) => {
      load<MigrationJournal>(
        tx,
        journalStore,
        expected.scope,
        (stored) => {
          if (!sameJournal(stored, expected)) throw Error('Migration journal fence changed')
          tx.objectStore(journalStore).put(update)
        },
        fail,
      )
    })
  }

  return {
    async read(scope): Promise<MigrationState> {
      const tx = db.transaction([manifestStore, journalStore], 'readonly')
      const completed = transactionComplete(tx)
      const activeReq = tx.objectStore(manifestStore).get(scope)
      const journalReq = tx.objectStore(journalStore).get(scope)
      const [active, journal] = await Promise.all([
        requestResult<ActiveMigrationGeneration | undefined>(activeReq),
        requestResult<MigrationJournal | undefined>(journalReq),
      ])
      await completed
      return { active: active ?? null, journal: journal ?? null }
    },

    async begin(journal, previous) {
      await mutation([manifestStore, journalStore], (tx, fail) => {
        let active: ActiveMigrationGeneration | undefined
        let found: MigrationJournal | undefined
        let seen = 0
        const check = () => {
          if (++seen !== 2) return
          if (
            found &&
            !(
              found.phase === 'ready' &&
              previous &&
              found.generation === previous.generation &&
              found.scope === previous.scope &&
              found.plan === previous.plan &&
              found.sourceFingerprint === previous.sourceFingerprint
            )
          )
            throw Error('Unfinished or mismatched migration journal exists')
          if (!sameActive(active ?? null, previous)) throw Error('Active migration generation changed')
          tx.objectStore(journalStore).put(journal)
        }
        load(
          tx,
          manifestStore,
          journal.scope,
          (value: ActiveMigrationGeneration | undefined) => {
            active = value
            check()
          },
          fail,
        )
        load(
          tx,
          journalStore,
          journal.scope,
          (value: MigrationJournal | undefined) => {
            found = value
            check()
          },
          fail,
        )
      })
    },

    async resume(journal) {
      if (journal.phase !== 'failed_recoverable') throw Error('Migration journal not recoverable')
      await mutateJournal(journal, { ...journal, phase: journal.resumePhase })
    },

    async commitBatch(old, next, rows) {
      if (
        old.phase !== 'staging' ||
        next.phase !== 'staging' ||
        old.generation !== next.generation ||
        old.scope !== next.scope ||
        old.plan !== next.plan ||
        old.sourceFingerprint !== next.sourceFingerprint ||
        old.previousGeneration !== next.previousGeneration ||
        next.committedBatches !== old.committedBatches + 1 ||
        next.stagedRecords <= old.stagedRecords ||
        !next.cursor ||
        old.cursor === next.cursor
      )
        throw Error('Invalid migration checkpoint progression')
      const stores = new Set<string>([journalStore])
      for (const row of rows) {
        if (
          !allowed.has(row.store) ||
          row.value.generation !== old.generation ||
          !options.validateStagedRecord(row, old.generation)
        )
          throw Error('Migration record is not generation-scoped')
        stores.add(row.store)
      }
      await mutation([...stores], (tx, fail) => {
        load<MigrationJournal>(
          tx,
          journalStore,
          old.scope,
          (stored) => {
            if (!sameJournal(stored, old)) throw Error('Migration batch fence changed')
            for (const row of rows) tx.objectStore(row.store).put(row.value)
            tx.objectStore(journalStore).put(next)
          },
          fail,
        )
      })
    },

    async advance(old, next) {
      if (
        old.phase !== 'staging' ||
        next.phase !== 'validating' ||
        old.cursor !== next.cursor ||
        old.stagedRecords !== next.stagedRecords ||
        old.committedBatches !== next.committedBatches
      )
        throw Error('Invalid migration phase advancement')
      await mutateJournal(old, next)
    },

    async activate(old, manifest) {
      if (
        old.phase !== 'validating' ||
        old.generation !== manifest.generation ||
        old.previousGeneration !== manifest.previousGeneration ||
        old.scope !== manifest.scope ||
        old.plan !== manifest.plan ||
        old.sourceFingerprint !== manifest.sourceFingerprint
      )
        throw Error('Invalid migration activation')
      await mutation([manifestStore, journalStore], (tx, fail) => {
        let active: ActiveMigrationGeneration | undefined
        let journal: MigrationJournal | undefined
        let seen = 0
        const check = () => {
          if (++seen !== 2) return
          if (!sameJournal(journal, old)) throw Error('Migration activation journal changed')
          if (active?.generation !== (old.previousGeneration ?? undefined))
            throw Error('Migration activation fence changed')
          tx.objectStore(manifestStore).put(manifest)
          tx.objectStore(journalStore).put({ ...old, phase: 'ready' })
        }
        load(
          tx,
          manifestStore,
          old.scope,
          (value: ActiveMigrationGeneration | undefined) => {
            active = value
            check()
          },
          fail,
        )
        load(
          tx,
          journalStore,
          old.scope,
          (value: MigrationJournal | undefined) => {
            journal = value
            check()
          },
          fail,
        )
      })
    },

    async markRecoverable(journal) {
      if (journal.phase !== 'staging' && journal.phase !== 'validating')
        throw Error('Cannot mark migration state recoverable')
      await mutateJournal(journal, {
        ...journal,
        phase: 'failed_recoverable',
        resumePhase: journal.phase,
      })
    },
  }
}
