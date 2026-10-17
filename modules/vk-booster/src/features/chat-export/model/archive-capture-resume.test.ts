import { expect, test } from 'bun:test'
import { decodeArchiveClone } from '@kobaproduction/browser-archive'
import type { PortableBackupRow } from '@kobaproduction/browser-storage'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { createVkArchiveCapture } from './archive-capture'
import { FixedVkDexieRepository } from './archive-fixed-dexie'
import type { VkArchiveSession } from './archive-session'
import type { VkCaptureEvidence, VkMessage } from './types'
import { createVkUserExport } from './vk-user-export'

function fixture(count = 41) {
  const seconds = Math.floor(Date.now() / 1000)
  const native = {
    messages: Array.from(
      { length: count },
      (_, index): VkMessage => ({
        id: 1000 - index * 7,
        date: seconds - (index + 1) * 10800,
        peer_id: 42,
        text: `synthetic ${index}`,
        update_time: 1,
      }),
    ),
  }
  const scope = {
    productId: 'vk-booster',
    channel: 'dev' as const,
    installationId: `synthetic-${crypto.randomUUID()}`,
    ownerId: 'synthetic-owner',
  }
  const open = () => new FixedVkDexieRepository(scope, { indexedDB, IDBKeyRange })
  const state = { busy: false, backupRunning: false, stopRequested: false, disposed: false }
  let revision = 0,
    evidence: VkCaptureEvidence | undefined
  let beforePage: ((offset: number) => void) | undefined
  const requests: { offset: number; anchor?: number }[] = []
  const session = {
    state,
    cfg: { peerId: 42, pageSize: 10, delay: 300 },
    currentPeer: () => 42,
    auth: async () => true,
    verifyOwner: async () => {},
    openFixedArchive: async () => open(),
    history: async (offset: number, size: number, anchor?: number) => {
      beforePage?.(offset)
      requests.push({ offset, anchor })
      const start = anchor === undefined ? 0 : native.messages.findIndex((row) => row.id === anchor)
      return {
        count: native.messages.length,
        items: native.messages.slice(start + offset, start + offset + size),
      }
    },
    progress() {},
    refresh() {},
    sleep: async () => {},
    archiveChanges: {
      revision: () => revision,
      publish: () => {
        revision++
      },
    },
    setCaptureEvidence: (value: VkCaptureEvidence | undefined) => {
      evidence = value
    },
  }
  return {
    native,
    open,
    state,
    requests,
    session,
    capture: () => createVkArchiveCapture(session as unknown as VkArchiveSession),
    beforePage: (hook?: (offset: number) => void) => {
      beforePage = hook
    },
    evidence: () => evidence,
    advanceExternally: () => {
      revision++
    },
  }
}

test('full capture survives restart, saves new rows and recent edits, then reuses the verified old tail', async () => {
  const run = fixture()
  expect(await run.capture().captureFixed('all')).toMatchObject({ complete: true, saved: 41, reused: 0 })
  const oldFirst = run.native.messages[0]
  if (!oldFirst) throw Error('Missing synthetic row')
  run.native.messages[0] = { ...oldFirst, text: 'synthetic edited', update_time: 2 }
  run.native.messages.unshift({
    id: 2000,
    date: Math.floor(Date.now() / 1000),
    peer_id: 42,
    text: 'synthetic new',
  })
  run.requests.length = 0
  const result = await run.capture().captureFixed('all')
  expect(result).toMatchObject({ saved: 1, updated: 1, complete: true })
  expect(result.reused).toBeGreaterThan(20)
  expect(run.requests).toHaveLength(2) // One recent page and one unanchored head check.
  const repo = run.open()
  try {
    expect(await repo.countMessages(42)).toBe(42)
    const row = await repo.getOriginal(42, oldFirst.id)
    expect(row?.raw.text).toBe('synthetic edited')
    expect(row?.previous?.[0]?.raw.text).toBe(oldFirst.text)
    expect(await repo.historyCoverage(42)).toMatchObject({ count: 42, lastId: 2000, firstId: 720 })
    expect(run.evidence()?.startReached).toBe(true)
  } finally {
    repo.close()
  }
})

test('an old saved message from an interrupted first scan cannot hide missing older history', async () => {
  const run = fixture()
  run.beforePage((offset) => {
    if (offset >= 10) throw Error('VK network unavailable')
  })
  await expect(run.capture().captureFixed('all')).rejects.toThrow('network')
  const before = run.open()
  expect(await before.countMessages(42)).toBe(10)
  expect(await before.historyCoverage(42)).toBeUndefined()
  before.close()
  run.beforePage()
  run.requests.length = 0
  expect(await run.capture().captureFixed('all')).toMatchObject({
    saved: 31,
    alreadySaved: 10,
    reused: 0,
    complete: true,
  })
  expect(run.requests.some((value) => value.anchor === 1000)).toBe(true)
})

test('changing native head/count does not fabricate a complete archive', async () => {
  const run = fixture()
  let inserted = false
  run.beforePage((offset) => {
    if (offset && !inserted) {
      inserted = true
      run.native.messages.unshift({
        id: 2000,
        date: Math.floor(Date.now() / 1000),
        peer_id: 42,
        text: 'synthetic incoming',
      })
    }
  })
  expect(await run.capture().captureFixed('all')).toMatchObject({
    complete: false,
    saved: 41,
    reused: 0,
  })
  expect(run.evidence()?.countStable).toBe(false)
  const repo = run.open()
  expect(await repo.historyCoverage(42)).toBeUndefined()
  repo.close()
})

test('external archive invalidation aborts proof creation without erasing committed messages', async () => {
  const run = fixture()
  run.beforePage((offset) => {
    if (offset) run.advanceExternally()
  })
  await expect(run.capture().captureFixed('all')).rejects.toThrow('archive changed')
  const repo = run.open()
  expect(await repo.countMessages(42)).toBe(10)
  expect(await repo.historyCoverage(42)).toBeUndefined()
  repo.close()
})

test('JSON and ZIP exports preserve both preferred and prior source observations; restore clears coverage proof', async () => {
  const run = fixture(2)
  await run.capture().captureFixed('all')
  const original = run.native.messages[0]
  if (!original) throw Error('Missing synthetic source')
  run.native.messages[0] = { ...original, text: 'synthetic changed', update_time: 2 }
  await run.capture().captureFixed('all')
  const repo = run.open()
  try {
    const result = await createVkUserExport(
      repo,
      42,
      { chunkRows: 100, includeReferences: true, packaging: 'none' },
      () => {},
    )
    const exported = JSON.parse(await result.blob.text())
    const rows = exported.messages ?? exported.records
    const row = rows.find((item: { id: number }) => item.id === original.id)
    expect(row.text).toBe('synthetic changed')
    expect(decodeArchiveClone(row.snapshot.original)).toMatchObject({ text: 'synthetic changed' })
    expect(decodeArchiveClone(row.snapshot.previous[0].original)).toMatchObject({ text: original.text })
    const zip = await createVkUserExport(
      repo,
      42,
      { chunkRows: 100, includeReferences: true, packaging: 'zip' },
      () => {},
    )
    expect(zip.recordCount).toBe(2)
    expect(new DataView(await zip.blob.arrayBuffer()).getUint32(0, true)).toBe(0x04034b50)
    const zipContents = new TextDecoder().decode(await zip.blob.arrayBuffer())
    expect(zipContents).toContain(original.text ?? '')
    expect(zipContents).toContain('synthetic changed')
    expect(zipContents).toContain('previous')
    const backup: PortableBackupRow[] = []
    for await (const entry of repo.backupPort().readRows(100)) backup.push(entry)
    await repo.backupPort().restoreAtomically(backup)
    expect(await repo.historyCoverage(42)).toBeUndefined()
    expect((await repo.getOriginal(42, original.id))?.previous?.[0]?.raw.text).toBe(original.text)
  } finally {
    repo.close()
  }
})

test('older source edit timestamps cannot roll the preferred source back; ordinary text reverts remain possible', async () => {
  const run = fixture(1),
    repo = run.open()
  const source = run.native.messages[0]
  if (!source) throw Error('Missing synthetic row')
  try {
    await repo.observeOriginal(42, { ...source, text: 'latest', update_time: 20 }, 'synthetic', 20)
    await repo.observeOriginal(42, { ...source, text: 'older', update_time: 10 }, 'synthetic', 21)
    expect((await repo.getOriginal(42, source.id))?.raw.text).toBe('latest')
    await repo.observeOriginal(42, { ...source, text: 'older', update_time: 30 }, 'synthetic', 30)
    expect((await repo.getOriginal(42, source.id))?.raw.text).toBe('older')
    expect((await repo.getOriginal(42, source.id))?.previous).toHaveLength(2)
  } finally {
    repo.close()
  }
})
