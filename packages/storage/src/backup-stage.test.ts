import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { BackupScope } from '@kobaproduction/browser-core'
import Dexie from 'dexie'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { backupStageDatabaseName, dexieBackupStageFactory } from './backup-stage'

const databases = new Set<string>()
let previousDependencies: typeof Dexie.dependencies
beforeEach(() => {
  previousDependencies = { ...Dexie.dependencies }
  Dexie.dependencies.indexedDB = indexedDB
  Dexie.dependencies.IDBKeyRange = IDBKeyRange
})
async function fixtureScope(): Promise<BackupScope> {
  const scope: BackupScope = {
    productId: 'synthetic-stage',
    channel: 'dev',
    ownerId: 'synthetic-owner',
    installationId: `test-${crypto.randomUUID()}`,
  }
  databases.add(await backupStageDatabaseName(scope))
  return scope
}
afterEach(async () => {
  try {
    for (const name of databases) await Dexie.delete(name)
  } finally {
    databases.clear()
    Dexie.dependencies.indexedDB = previousDependencies.indexedDB
    Dexie.dependencies.IDBKeyRange = previousDependencies.IDBKeyRange
  }
})

describe('persistent staged backup storage with synthetic IndexedDB', () => {
  test('keeps sealed rows and journal after close without automatic recovery or deletion', async () => {
    const scope = await fixtureScope()
    const stage = await dexieBackupStageFactory.create(scope, 'restore')
    const rows = Array.from({ length: 260 }, (_, index) => ({
      key: String(index).padStart(4, '0'),
      value: { text: `synthetic-${index}` },
    }))
    await stage.addRows('rollback', 'synthetic.archive', rows.slice(0, 256))
    await stage.addRows('rollback', 'synthetic.archive', rows.slice(256))
    const reader = await stage.seal('rollback', 'synthetic.archive')
    expect(await stage.reader('rollback', 'synthetic.archive')).toBe(reader)
    expect(reader.count).toBe(260)
    await stage.update({ state: 'rollback-failed', attempted: ['synthetic.archive'] })
    const id = stage.reference.id
    stage.close()
    const jobs = await dexieBackupStageFactory.list(scope)
    expect(jobs.map((job) => [job.id, job.state, job.attempted])).toEqual([
      [id, 'rollback-failed', ['synthetic.archive']],
    ])
    const reopened = await dexieBackupStageFactory.open(scope, id)
    try {
      const recovered = await reopened.reader('rollback', 'synthetic.archive')
      const actual = []
      for await (const row of recovered.rows()) actual.push(row)
      expect(actual).toEqual(rows)
      expect(await recovered.get('0259')).toEqual(rows[259])
      expect(await recovered.get('missing')).toBeUndefined()
      const detached = await recovered.get('0000')
      if (!detached || typeof detached.value !== 'object' || !detached.value)
        throw Error('Missing synthetic row')
      Object.assign(detached.value, { text: 'changed-reader-copy' })
      expect(await recovered.get('0000')).toEqual(rows[0])
      let sealedFailure: unknown
      // Await Dexie's transaction directly: Bun's async rejection matcher can
      // stall IndexedDB callbacks after an async-generator traversal.
      try {
        await reopened.addRows('rollback', 'synthetic.archive', [{ key: 'new', value: 'new' }])
      } catch (error) {
        sealedFailure = error
      }
      expect(sealedFailure).toBeInstanceOf(Error)
      expect(String(sealedFailure)).toContain('Sealed')
      await reopened.discard()
    } finally {
      reopened.close()
    }
    expect(await dexieBackupStageFactory.list(scope)).toEqual([])
  })

  test('duplicate batch insertion aborts the entire batch instead of retaining its new rows', async () => {
    const scope = await fixtureScope()
    const stage = await dexieBackupStageFactory.create(scope, 'inspect')
    try {
      await stage.addRows('input', 'synthetic.archive', [{ key: 'existing', value: 'original' }])
      await expect(
        stage.addRows('input', 'synthetic.archive', [
          { key: 'new', value: 'must-not-survive' },
          { key: 'existing', value: 'must-not-replace' },
        ]),
      ).rejects.toThrow()
      const reader = await stage.seal('input', 'synthetic.archive')
      expect(reader.count).toBe(1)
      expect(await reader.get('new')).toBeUndefined()
      expect(await reader.get('existing')).toEqual({ key: 'existing', value: 'original' })
      await stage.discard()
    } finally {
      stage.close()
    }
  })

  test('a valid job ID does not open records from another owner or installation', async () => {
    const scope = await fixtureScope()
    const stage = await dexieBackupStageFactory.create(scope, 'restore')
    try {
      await stage.addRows('input', 'synthetic.archive', [{ key: 'record', value: 'private-fixture' }])
      const otherOwner = { ...scope, ownerId: 'other-synthetic-owner' }
      const otherInstallation = { ...scope, installationId: `other-${crypto.randomUUID()}` }
      for (const foreign of [otherOwner, otherInstallation]) {
        databases.add(await backupStageDatabaseName(foreign))
        expect(await dexieBackupStageFactory.list(foreign)).toEqual([])
        await expect(dexieBackupStageFactory.open(foreign, stage.reference.id)).rejects.toThrow(
          'unavailable',
        )
      }
      await stage.discard()
    } finally {
      stage.close()
    }
  })
})
