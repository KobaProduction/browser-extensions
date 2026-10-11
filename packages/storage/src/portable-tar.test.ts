import { expect, test } from 'bun:test'
import type { PortableBackupPorts, PortableBackupRow } from './portable-backup'
import {
  type BackupTarProgress,
  exportBackupTar,
  inspectBackupTar,
  restoreBackupTar,
} from './portable-tar'
import { readTarEntries } from './tar-stream'

const scope = {
  productId: 'sample-data',
  channel: 'dev' as const,
  ownerId: 'owner-37',
  installationId: 'chrome-target',
}
function fixture(total = 1300) {
  let settings = { theme: 'dark' }
  let rows: PortableBackupRow[] = Array.from({ length: total }, (_, i) => ({
    store: 'messages',
    key: String(i),
    value: { text: 'repeat repeated token '.repeat(9), id: i },
  }))
  let fail = false
  const ports: PortableBackupPorts<{ theme: string }> = {
    scope,
    settings: {
      scope,
      schemaVersion: 1,
      async exportSettings() {
        return { ...settings }
      },
      validateSettings(input) {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).join(',') !== 'theme' ||
          !['dark', 'light'].includes((input as { theme: string }).theme)
        )
          throw Error('Unsupported settings')
        return { theme: (input as { theme: string }).theme }
      },
      async restoreSettingsAtomically(value) {
        settings = { ...value }
      },
    },
    indexeddb: {
      scope,
      schemaVersion: 1,
      stores: ['messages'],
      schema: { messages: { primaryKey: '&key', indexes: ['ownerId'] } },
      async countRows() {
        return { messages: rows.length }
      },
      async *readRows(pageSize) {
        if (pageSize > 2048) throw Error('Invalid page size')
        for (const row of rows) yield structuredClone(row)
      },
      async restoreAtomically(input) {
        if (fail) throw Error('Simulated DB transaction failure')
        rows = structuredClone([...input])
      },
    },
  }
  return {
    ports,
    get settings() {
      return settings
    },
    set settings(v) {
      settings = v
    },
    get rows() {
      return rows
    },
    set rows(v) {
      rows = v
    },
    fail() {
      fail = true
    },
  }
}

async function plainEntries(blob: Blob) {
  const prefix = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
  const stream =
    prefix[0] === 31 && prefix[1] === 139
      ? blob.stream().pipeThrough(new DecompressionStream('gzip'))
      : blob.stream()
  const entries = []
  for await (const item of readTarEntries(stream)) entries.push(item)
  return entries
}

test('one TAR.GZ compresses all JSONL chunks and supports progress and restore', async () => {
  const f = fixture()
  const events: BackupTarProgress[] = []
  const blob = await exportBackupTar(
    f.ports,
    { settings: true, indexeddb: true, compression: 'gzip', chunkRows: 512 },
    { onProgress: (p) => events.push(p) },
  )
  if (!blob) throw Error('Missing test backup')
  expect(new Uint8Array(await blob.slice(0, 2).arrayBuffer())).toEqual(new Uint8Array([31, 139]))
  const entries = await plainEntries(blob)
  expect(entries.map((e) => e.name)).toEqual([
    'persistent/settings.json',
    'indexeddb/schema.json',
    'indexeddb/messages/00000000.jsonl',
    'indexeddb/messages/00000001.jsonl',
    'indexeddb/messages/00000002.jsonl',
    'manifest.json',
  ])
  expect(entries.every((e) => !e.name.endsWith('.gz'))).toBe(true)
  expect(events[0]?.phase).toBe('counting')
  expect(events.at(-1)?.percent).toBe(100)
  expect(events.some((e) => e.percent > 0 && e.percent < 100)).toBe(true)
  expect((await inspectBackupTar(f.ports, blob)).rows).toBe(1300)
  const uncompressed = await exportBackupTar(f.ports, {
    settings: true,
    indexeddb: true,
    compression: 'none',
    chunkRows: 512,
  })
  if (!uncompressed) throw Error('Missing TAR')
  expect(blob.size).toBeLessThan(uncompressed.size / 2)
  f.settings = { theme: 'light' }
  f.rows = []
  await restoreBackupTar(f.ports, blob, { settings: true, indexeddb: true })
  expect(f.settings.theme).toBe('dark')
  expect(f.rows.length).toBe(1300)
})

test('streaming output writes directly to sink without any returned archive blob', async () => {
  const f = fixture(137)
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const sink = new WritableStream<Uint8Array<ArrayBuffer>>({
    write(bytes) {
      chunks.push(bytes.slice())
    },
  })
  const response = await exportBackupTar(
    f.ports,
    { settings: false, indexeddb: true, compression: 'gzip' },
    { sink },
  )
  expect(response).toBeNull()
  expect((await inspectBackupTar(f.ports, new Blob(chunks))).rows).toBe(137)
})

test('corrupt TAR, owner mismatch and rejected DB transaction never silently commit', async () => {
  const f = fixture(67)
  const archive = await exportBackupTar(f.ports, {
    settings: true,
    indexeddb: true,
    compression: 'gzip',
  })
  if (!archive) throw Error('Missing TAR')
  const wrongScope = { ...f.ports, scope: { ...scope, channel: 'prod' as const } }
  await expect(inspectBackupTar(wrongScope, archive)).rejects.toThrow('mismatch')
  const broken = new Uint8Array(await archive.arrayBuffer())
  broken[50] = (broken[50] ?? 0) ^ 1
  await expect(
    restoreBackupTar(f.ports, new Blob([broken]), { settings: true, indexeddb: true }),
  ).rejects.toThrow()
  expect(f.rows.length).toBe(67)
  f.settings = { theme: 'light' }
  f.fail()
  await expect(restoreBackupTar(f.ports, archive, { settings: true, indexeddb: true })).rejects.toThrow(
    'transaction',
  )
  expect(f.settings.theme).toBe('light')
})

test('settings-only TAR carries no messages or session contents', async () => {
  const f = fixture(230)
  const backup = await exportBackupTar(f.ports, {
    settings: true,
    indexeddb: false,
    compression: 'gzip',
  })
  if (!backup) throw Error('Missing TAR')
  const info = await inspectBackupTar(f.ports, backup)
  expect(info.rows).toBe(0)
  expect(info.manifest.includes.session).toBe(false)
  expect((await plainEntries(backup)).map((e) => e.name)).toEqual([
    'persistent/settings.json',
    'indexeddb/schema.json',
    'manifest.json',
  ])
})
