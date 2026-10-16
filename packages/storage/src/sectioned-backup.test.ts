import { describe, expect, test } from 'bun:test'
import type {
  ApplicationBackupSource,
  BackupFileOutput,
  BackupRow,
  BackupRowReader,
  BackupScope,
} from '@kobaproduction/browser-core'
import { createMemoryBackupStage } from './backup-stage'
import {
  discardSectionedBackupRecovery,
  exportSectionedBackup,
  exportSectionedBackupTo,
  inspectSectionedBackup,
  listSectionedBackupRecoveries,
  restoreSectionedBackup,
  retrySectionedBackupRollback,
  SectionedBackupRecoveryError,
} from './sectioned-backup'
import { readTarEntries, TarStreamWriter } from './tar-stream'

const scope: BackupScope = {
  productId: 'synthetic-backup',
  channel: 'dev',
  ownerId: 'synthetic-owner',
  installationId: 'synthetic-installation',
}
const row = (value: string): BackupRow => ({ key: 'record', value })

function source(id: string, initial: string, kind: ApplicationBackupSource['kind'] = 'settings') {
  let values: readonly BackupRow[] = [row(initial)]
  const writes: string[] = []
  let beforeRestore: ((rows: readonly BackupRow[]) => void) | undefined
  let afterRestore: ((rows: readonly BackupRow[]) => void) | undefined
  let onValidate: (() => void) | undefined
  const readers = new WeakSet<BackupRowReader>()
  const validate = (rows: readonly BackupRow[]) => {
    if (rows.length !== 1 || rows[0]?.key !== 'record' || typeof rows[0].value !== 'string')
      throw Error('Invalid synthetic section')
    onValidate?.()
  }
  const restore = async (rows: readonly BackupRow[]) => {
    beforeRestore?.(rows)
    values = structuredClone(rows)
    writes.push(String(rows[0]?.value))
    afterRestore?.(rows)
  }
  const port: ApplicationBackupSource = {
    id,
    label: id,
    kind,
    scope,
    schema: { version: 1 },
    available: true,
    async *readRows() {
      for (const value of values) yield structuredClone(value)
    },
    validateRows: validate,
    restoreRows: restore,
    ...(kind === 'indexeddb'
      ? {
          async validateStagedRows(reader: BackupRowReader) {
            const rows = []
            for await (const value of reader.rows()) rows.push(value)
            validate(rows)
            expect(rows.length).toBe(reader.count)
            expect(await reader.get('record')).toEqual(rows[0])
            readers.add(reader)
          },
          async restoreStagedRows(reader: BackupRowReader) {
            if (!readers.has(reader)) throw Error('Activation lost its validated stage identity')
            const rows = []
            for await (const value of reader.rows()) rows.push(value)
            await restore(rows)
          },
        }
      : {}),
  }
  return {
    port,
    writes,
    current: () => values,
    set(value: string) {
      values = [row(value)]
    },
    beforeRestore(callback?: typeof beforeRestore) {
      beforeRestore = callback
    },
    afterRestore(callback?: typeof afterRestore) {
      afterRestore = callback
    },
    onValidate(callback?: typeof onValidate) {
      onValidate = callback
    },
  }
}

async function corruptPart(file: Blob): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  const writer = new TarStreamWriter(
    new WritableStream({
      write(bytes) {
        parts.push(bytes.slice())
      },
    }),
  )
  for await (const entry of readTarEntries(file.stream().pipeThrough(new DecompressionStream('gzip')))) {
    const bytes = entry.name.endsWith('.jsonl')
      ? new TextEncoder().encode('{"key":"record","value":"tampered"}\n')
      : entry.bytes
    await writer.add(entry.name, bytes)
  }
  await writer.finish()
  return new Blob(parts)
}

async function versionOneBackup(
  port: ApplicationBackupSource,
  value = 'я'.repeat(2 * 1024 * 1024),
): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  const writer = new TarStreamWriter(
    new WritableStream({
      write(bytes) {
        parts.push(bytes.slice())
      },
    }),
  )
  // Multi-byte content also catches character-count checks mistaken for bytes.
  const bytes = new TextEncoder().encode(`${JSON.stringify(row(value))}\n`)
  const path = `sections/${port.id}/00000000.jsonl`
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('')
  await writer.add(path, bytes)
  await writer.add(
    'manifest.json',
    new TextEncoder().encode(
      JSON.stringify({
        format: 'koba-sectioned-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        sections: [
          {
            id: port.id,
            label: port.label,
            kind: port.kind,
            scope: port.scope,
            schema: port.schema,
            rows: 1,
            parts: [{ path, sha256, rows: 1 }],
          },
        ],
      }),
    ),
  )
  await writer.finish()
  return new Blob(parts)
}

describe('selectable staged application recovery', () => {
  test('existing ordinary version1 application backups remain readable and restorable', async () => {
    const settings = source('application.settings', 'current')
    const stageFactory = createMemoryBackupStage()
    const file = await versionOneBackup(settings.port, 'saved-v1')
    expect(
      (await inspectSectionedBackup(file, [settings.port], { stageFactory })).sections[0]?.rows,
    ).toBe(1)
    await restoreSectionedBackup(file, [settings.port], [settings.port.id], { stageFactory })
    expect(settings.current()).toEqual([row('saved-v1')])
  })
  test('inspects every section without writes and restores only the selected section', async () => {
    const stageFactory = createMemoryBackupStage()
    const archive = source('synthetic.archive', 'saved-archive', 'indexeddb')
    const settings = source('application.settings', 'saved-settings')
    const sources = [settings.port, archive.port]
    const options = { scope, stageFactory }
    const file = await exportSectionedBackup(
      sources,
      sources.map((item) => item.id),
      options,
    )
    archive.set('current-archive')
    settings.set('current-settings')
    const inspection = await inspectSectionedBackup(file, sources, options)
    expect(inspection.sections.map((item) => [item.id, item.rows, item.available])).toEqual([
      ['application.settings', 1, true],
      ['synthetic.archive', 1, true],
    ])
    expect(archive.writes).toEqual([])
    expect(settings.writes).toEqual([])
    await restoreSectionedBackup(file, sources, ['synthetic.archive'], options)
    expect(archive.current()).toEqual([row('saved-archive')])
    expect(settings.current()).toEqual([row('current-settings')])
    expect(await stageFactory.list(scope)).toEqual([])
  })

  test('hash corruption rejects the entire input before any primary replacement', async () => {
    const stageFactory = createMemoryBackupStage()
    const settings = source('application.settings', 'saved')
    const options = { scope, stageFactory }
    const file = await exportSectionedBackup([settings.port], [settings.port.id], options)
    settings.set('current')
    await expect(
      restoreSectionedBackup(await corruptPart(file), [settings.port], [settings.port.id], options),
    ).rejects.toThrow('integrity mismatch')
    expect(settings.current()).toEqual([row('current')])
    expect(settings.writes).toEqual([])
    expect(await stageFactory.list(scope)).toEqual([])
  })

  test('a valid hash cannot bypass the four MiB UTF-8 record bound during import', async () => {
    const settings = source('application.settings', 'current')
    const stageFactory = createMemoryBackupStage()
    const file = await versionOneBackup(settings.port)
    await expect(
      restoreSectionedBackup(file, [settings.port], [settings.port.id], { stageFactory }),
    ).rejects.toThrow('Backup record is too large')
    expect(settings.current()).toEqual([row('current')])
    expect(settings.writes).toEqual([])
    expect(await stageFactory.list(scope)).toEqual([])
  })

  test('wrong owner is listed as unavailable and cannot overwrite a matching section name', async () => {
    const stageFactory = createMemoryBackupStage()
    const settings = source('application.settings', 'saved')
    const file = await exportSectionedBackup([settings.port], [settings.port.id], { stageFactory })
    settings.set('current')
    const foreign = { ...settings.port, scope: { ...scope, ownerId: 'another-synthetic-owner' } }
    const inspection = await inspectSectionedBackup(file, [foreign], { stageFactory })
    expect(inspection.sections[0]?.available).toBe(false)
    await expect(
      restoreSectionedBackup(file, [foreign], [foreign.id], { stageFactory }),
    ).rejects.toThrow('missing or unavailable')
    expect(settings.current()).toEqual([row('current')])
    expect(settings.writes).toEqual([])
  })

  test('archive activation precedes settings and application flags regardless of selection order', async () => {
    const stageFactory = createMemoryBackupStage()
    const archive = source('synthetic.archive', 'saved-archive', 'indexeddb')
    const settings = source('synthetic.settings', 'saved-settings')
    const flags = source('application.settings', 'saved-flags')
    const sources = [flags.port, settings.port, archive.port]
    const options = { scope, stageFactory }
    const order: string[] = []
    const file = await exportSectionedBackup(
      sources,
      sources.map((item) => item.id),
      options,
    )
    for (const item of [archive, settings, flags]) item.afterRestore(() => order.push(item.port.id))
    await restoreSectionedBackup(
      file,
      sources,
      sources.map((item) => item.id),
      options,
    )
    expect(order).toEqual(['synthetic.archive', 'synthetic.settings', 'application.settings'])
  })

  test('partial replacement failure restores every attempted section including the failing one', async () => {
    const stageFactory = createMemoryBackupStage()
    const archive = source('synthetic.archive', 'saved-archive', 'indexeddb')
    const settings = source('application.settings', 'saved-settings')
    const sources = [settings.port, archive.port]
    const options = { scope, stageFactory }
    const file = await exportSectionedBackup(
      sources,
      sources.map((item) => item.id),
      options,
    )
    archive.set('current-archive')
    settings.set('current-settings')
    settings.afterRestore((rows) => {
      if (rows[0]?.value === 'saved-settings') throw Error('Synthetic activation failure')
    })
    await expect(
      restoreSectionedBackup(
        file,
        sources,
        sources.map((item) => item.id),
        options,
      ),
    ).rejects.toThrow('Synthetic activation failure')
    expect(archive.writes).toEqual(['saved-archive', 'current-archive'])
    expect(settings.writes).toEqual(['saved-settings', 'current-settings'])
    expect(archive.current()).toEqual([row('current-archive')])
    expect(settings.current()).toEqual([row('current-settings')])
    expect(await listSectionedBackupRecoveries(sources, options)).toEqual([])
  })

  test('failed rollback survives an operation boundary and retries only on explicit invocation', async () => {
    const stageFactory = createMemoryBackupStage()
    const settings = source('application.settings', 'saved')
    const sources = [settings.port]
    const options = { scope, stageFactory }
    const file = await exportSectionedBackup(sources, [settings.port.id], options)
    settings.set('current')
    settings.afterRestore((rows) => {
      if (rows[0]?.value === 'saved') throw Error('Synthetic activation failure')
    })
    settings.beforeRestore((rows) => {
      if (rows[0]?.value === 'current') throw Error('Synthetic rollback failure')
    })
    let failure: unknown
    try {
      await restoreSectionedBackup(file, sources, [settings.port.id], options)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(SectionedBackupRecoveryError)
    const recoveries = await listSectionedBackupRecoveries(sources, options)
    expect(recoveries).toHaveLength(1)
    const recovery = recoveries[0]
    if (!recovery) throw Error('Missing recovery fixture')
    expect(recovery.canRollback).toBe(true)
    expect(recovery.sections.map((item) => item.id)).toEqual(['application.settings'])
    expect(settings.current()).toEqual([row('saved')])
    expect(settings.writes).toEqual(['saved'])
    const foreignScope = { ...scope, ownerId: 'another-synthetic-owner' }
    expect(await stageFactory.list(foreignScope)).toEqual([])
    await expect(stageFactory.open(foreignScope, recovery.id)).rejects.toThrow('unavailable')
    settings.beforeRestore()
    settings.afterRestore()
    await retrySectionedBackupRollback(sources, recovery.id, options)
    expect(settings.current()).toEqual([row('current')])
    expect(await listSectionedBackupRecoveries(sources, options)).toEqual([])
  })

  test('cancellation after a primary write still finishes rollback and skips later activation', async () => {
    const stageFactory = createMemoryBackupStage()
    const archive = source('synthetic.archive', 'saved-archive', 'indexeddb')
    const settings = source('application.settings', 'saved-settings')
    const sources = [archive.port, settings.port]
    const file = await exportSectionedBackup(
      sources,
      sources.map((item) => item.id),
      { stageFactory },
    )
    archive.set('current-archive')
    settings.set('current-settings')
    const controller = new AbortController()
    archive.afterRestore((rows) => {
      if (rows[0]?.value === 'saved-archive') controller.abort(Error('Synthetic cancellation'))
    })
    await expect(
      restoreSectionedBackup(
        file,
        sources,
        sources.map((item) => item.id),
        {
          stageFactory,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow('Synthetic cancellation')
    expect(archive.current()).toEqual([row('current-archive')])
    expect(settings.writes).toEqual([])
    expect(await stageFactory.list(scope)).toEqual([])
  })

  test('quota failure while sealing rollback leaves all primary data untouched', async () => {
    const settings = source('application.settings', 'saved')
    const file = await exportSectionedBackup([settings.port], [settings.port.id], {
      stageFactory: createMemoryBackupStage(),
    })
    settings.set('current'.repeat(100))
    const stageFactory = createMemoryBackupStage(300)
    await expect(
      restoreSectionedBackup(file, [settings.port], [settings.port.id], { stageFactory }),
    ).rejects.toThrow('in-memory Lab limit')
    expect(settings.writes).toEqual([])
    expect(settings.current()).toEqual([row('current'.repeat(100))])
    expect(await stageFactory.list(scope)).toEqual([])
  })

  test('failed final validation aborts temporary output before publication', async () => {
    const settings = source('application.settings', 'saved')
    const stageFactory = createMemoryBackupStage()
    let validations = 0
    let commits = 0
    let aborts = 0
    let written = 0
    settings.onValidate(() => {
      if (++validations === 2) throw Error('Synthetic source changed before publication')
    })
    const output: BackupFileOutput = {
      writable: new WritableStream({
        write(bytes) {
          written += bytes.length
        },
      }),
      async commit() {
        commits++
      },
      async abort() {
        aborts++
      },
    }
    await expect(
      exportSectionedBackupTo([settings.port], [settings.port.id], output, { stageFactory }),
    ).rejects.toThrow('source changed before publication')
    expect(written).toBeGreaterThan(0)
    expect(commits).toBe(0)
    expect(aborts).toBeGreaterThan(0)
    expect(await stageFactory.list(scope)).toEqual([])
  })

  test('explicit discard deletes only the chosen local recovery job', async () => {
    const stageFactory = createMemoryBackupStage()
    const settings = source('application.settings', 'current')
    const first = await stageFactory.create(scope, 'inspect')
    const second = await stageFactory.create(scope, 'inspect')
    await discardSectionedBackupRecovery([settings.port], first.reference.id, { stageFactory })
    expect((await stageFactory.list(scope)).map((item) => item.id)).toEqual([second.reference.id])
    expect(settings.writes).toEqual([])
    await second.discard()
  })
})
