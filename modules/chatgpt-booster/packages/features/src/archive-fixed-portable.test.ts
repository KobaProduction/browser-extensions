import { readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { encodeArchiveClone } from '@kobaproduction/browser-archive'
import { FixedCanonicalDexieRepository } from './archive-fixed-dexie'
import { chatGptPortableBackupPorts, exportChatGptPortableArchive, inspectChatGptPortableArchive, restoreChatGptPortableArchive } from './archive-fixed-portable'

const driver = { indexedDB, IDBKeyRange }
const scope = (ownerId: string, installationId: string) => ({
  productId: 'chatgpt-booster', channel: 'dev' as const, installationId, ownerId,
})
const observation = (accountId: string, messageId: string) => ({
  accountId, conversationId: 'dialog', projectId: 'project',
  sourceKind: 'native', sourceVersion: '2026-v1', observedAtMs: 1234,
  raw: { id: messageId, author: { role: 'assistant' }, channel: 'final',
    content: { content_type: 'text', parts: ['saved'] },
    opaque: new Uint8Array([0, 1, 254]),
  },
})

test('internal ChatGPT TAR.GZ round trip restores only verified owner and five canonical stores', async () => {
  const a = new FixedCanonicalDexieRepository(scope('owner-a', 'portable-1'), driver)
  const b = new FixedCanonicalDexieRepository(scope('owner-b', 'portable-1'), driver)
  try {
    await a.addObservation(observation('owner-a', 'first'))
    await b.addObservation(observation('owner-b', 'other-owner'))
    const archive = await exportChatGptPortableArchive(a, { compression: 'gzip', chunkRows: 64 })
    expect(archive).toBeInstanceOf(Blob)
    const blob = archive as Blob
    const inspected = await inspectChatGptPortableArchive(a, blob)
    expect(inspected.manifest.format).toBe('koba-portable-tar')
    expect(inspected.manifest.includes).toMatchObject({ settings: false, indexeddb: true, session: false, attachments: false })
    expect(inspected.manifest.stores).toEqual(['projects', 'conversations', 'messages', 'elements', 'snapshots'])
    expect(inspected.rows).toBe(6)
    await a.addObservation(observation('owner-a', 'later'))
    expect((await a.counts()).messages).toBe(2)
    await restoreChatGptPortableArchive(a, blob)
    expect(await a.counts()).toEqual({ projects: 1, conversations: 1, messages: 1, elements: 2, snapshots: 1 })
    expect((await a.getSourceSnapshot('dialog', 'first'))?.raw.opaque).toEqual(new Uint8Array([0, 1, 254]))
    expect(await a.getMessage('dialog', 'later')).toBeUndefined()
    expect((await b.counts()).messages).toBe(1)
    await expect(inspectChatGptPortableArchive(b, blob)).rejects.toThrow()
  } finally { a.close(); b.close() }
})

test('ChatGPT recovery refuses wrong owner, corrupted archives and incoherent records before mutation', async () => {
  const db = new FixedCanonicalDexieRepository(scope('owner-a', 'portable-2'), driver)
  try {
    await db.addObservation(observation('owner-a', 'first'))
    const archive = await exportChatGptPortableArchive(db, { compression: 'none', chunkRows: 64 }) as Blob
    await db.addObservation(observation('owner-a', 'second'))
    const before = await db.counts()
    const tampered = new Blob([await archive.slice(0, -8).arrayBuffer(), new Uint8Array([3, 2, 1])])
    await expect(restoreChatGptPortableArchive(db, tampered)).rejects.toThrow()
    expect(await db.counts()).toEqual(before)
    const rows = []
    for await (const row of chatGptPortableBackupPorts(db).indexeddb!.readRows(64)) rows.push(row)
    const source = rows.find((row) => row.store === 'snapshots')!
    const wrong = { ...source, key: JSON.stringify(['owner-b', 'dialog', 'first']) }
    await expect(db.backupPort().restoreAtomically([...rows, wrong])).rejects.toThrow()
    expect(await db.counts()).toEqual(before)
    const missing = rows.filter((row) => row.store !== 'snapshots')
    await expect(db.backupPort().restoreAtomically(missing)).rejects.toThrow()
    expect(await db.counts()).toEqual(before)
    const corruptedValue = await encodeArchiveClone({ bad: true })
    const corrupt = rows.map((row) => row.store === 'messages'
      ? { ...row, value: corruptedValue } : row)
    await expect(db.backupPort().restoreAtomically(corrupt)).rejects.toThrow()
    expect(await db.counts()).toEqual(before)
  } finally { db.close() }
})

test('ChatGPT portable provider has no user-facing UI and never reads native v3/v4', () => {
  const code = readFileSync(new URL('./archive-fixed-portable.ts', import.meta.url), 'utf8')
  const panel = readFileSync(new URL('../../../src/features/archive/ui/ChatGptPanel.vue', import.meta.url), 'utf8')
  expect(code).toContain('repo.backupPort()')
  expect(code).not.toMatch(/v3|v4|nativeStore|LegacyReader/)
  expect(panel).not.toContain('PortableBackupPanel')
})

test('ChatGPT TAR uses bounded multi-page extraction without dropping canonical elements', async () => {
  const db = new FixedCanonicalDexieRepository(scope('owner-a', 'portable-pages'), driver)
  try {
    for (let i = 0; i < 137; i++) {
      await db.addObservation(observation('owner-a', `message-${String(i).padStart(4, '0')}`))
    }
    const stages: string[] = []
    const archive = await exportChatGptPortableArchive(db, { compression: 'gzip', chunkRows: 64 }, {
      onProgress: (value) => stages.push(value.phase),
    }) as Blob
    const inspected = await inspectChatGptPortableArchive(db, archive)
    expect(inspected.manifest.counts).toEqual(await db.counts())
    expect(inspected.manifest.chunks.filter((c) => c.store === 'messages').length).toBe(3)
    expect(stages).toContain('reading')
    expect(stages.at(-1)).toBe('done')
    expect((await db.listMessages('dialog', 160)).length).toBe(137)
  } finally { db.close() }
})
