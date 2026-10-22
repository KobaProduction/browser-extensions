import { expect, test } from 'bun:test'
import type { PortableBackupReader } from '@kobaproduction/browser-storage'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedCanonicalDexieRepository, fixedArchiveDatabaseName } from './archive-fixed-dexie'

const driver = { indexedDB, IDBKeyRange }
const scope = (channel: 'dev' | 'prod', installationId: string, ownerId: string) => ({
  productId: 'chatgpt-booster',
  channel,
  installationId,
  ownerId,
})
const source = (accountId: string, conversationId: string, id: string) => ({
  accountId,
  conversationId,
  projectId: 'p1',
  conversationTitle: 'Saved chat',
  projectTitle: 'Saved project',
  sourceKind: 'native',
  sourceVersion: 'observed-2026-10',
  observedAtMs: 1234,
  raw: {
    id,
    author: { role: 'assistant' },
    channel: 'final',
    content: { content_type: 'multimodal_text', parts: ['known text', { unknown_future_part: 7 }] },
    private_future_metadata: { opaque: true },
  },
})

test('first-message evidence survives reopening and recovery with its original, rejecting detached anchors', async () => {
  const identity = scope('dev', 'synthetic-start-recovery', 'synthetic-start-owner')
  let db = new FixedCanonicalDexieRepository(identity, driver)
  const input = source('synthetic-start-owner', 'start-chat', 'first-user')
  input.raw.author.role = 'user'
  const startEvidence = {
    kind: 'native-create' as const,
    firstMessageId: 'first-user',
    sourceId: 'native-create-run',
    observedAt: 1234,
  }
  try {
    await db.addObservation({
      ...input,
      startEvidence,
      sourceEvents: [
        { kind: 'native-create', requestId: 'native-create-run', userMessageId: 'first-user' },
      ],
    })
    db.close()
    db = new FixedCanonicalDexieRepository(identity, driver)
    expect((await db.getConversation('start-chat'))?.startEvidence).toEqual(startEvidence)
    const rows = []
    for await (const row of db.backupPort().readRows(10)) rows.push(row)
    await db.backupPort().restoreAtomically(rows)
    expect((await db.getConversation('start-chat'))?.startEvidence).toEqual(startEvidence)
    expect((await db.getSourceSnapshot('start-chat', 'first-user'))?.raw).toEqual(input.raw)
    expect(await db.integrity('start-chat')).toMatchObject({
      start: 'verified',
      firstMessageId: 'first-user',
    })
    await expect(
      db.addObservation({ ...input, startEvidence: { ...startEvidence, firstMessageId: 'other' } }),
    ).rejects.toThrow('first original')
    expect((await db.getConversation('start-chat'))?.startEvidence).toEqual(startEvidence)
  } finally {
    db.close()
  }
})

test('Dexie canonical v1 is fixed, keeps opaque unknown input and never changes native databases', async () => {
  const db = new FixedCanonicalDexieRepository(scope('dev', 'tm-fixed-1', 'account-a'), driver)
  expect(db.databaseName).toContain('canonical-v1')
  expect(db.databaseName).not.toContain('account-a')
  const input = source('account-a', 'c1', 'm1')
  const key = await db.addObservation(input)
  expect(key).toBe(JSON.stringify(['account-a', 'c1', 'm1']))
  const stored = await db.getMessage('c1', 'm1')
  expect(stored?.projection).toMatchObject({
    modelVersion: 1,
    accountId: 'account-a',
    conversationId: 'c1',
    messageId: 'm1',
    renderCoverage: 'contains_opaque',
  })
  expect(stored?.projection.elements.map((e) => e.kind)).toEqual(['container', 'text', 'opaque'])
  const snapshot = await db.getSourceSnapshot('c1', 'm1')
  expect(snapshot?.raw).toEqual(input.raw)
  expect(snapshot?.raw).not.toBe(input.raw)
  expect(await db.counts()).toEqual({
    projects: 1,
    conversations: 1,
    messages: 1,
    elements: 3,
    snapshots: 1,
  })
  expect(await db.listMessages('c1', 100, 'm1')).toHaveLength(0)
  expect(stored?.projection.sourceCreateTime).toBeNull()
  expect(stored?.projection.parentObserved).toBe(false)
  expect(await db.addObservation(input)).toBe(key)
  expect((await db.getSourceSnapshot('c1', 'm1'))?.raw).toEqual(input.raw)
  expect(await db.counts()).toMatchObject({ messages: 1, elements: 3, snapshots: 1 })
  db.close()
})

test('saved stats distinguish messages from tool and internal content without inferring remote completeness', async () => {
  const db = new FixedCanonicalDexieRepository(scope('dev', 'tm-fixed-stats', 'owner-a'), driver)
  try {
    await db.addObservation(source('owner-a', 'selected', 'msg-1'))
    await db.addObservation(source('owner-a', 'other', 'msg-2'))
    const result = await db.savedConversationStats('selected')
    expect(result.messages).toBe(1)
    expect(result.internalElements).toBeGreaterThanOrEqual(0)
    expect(result.toolCalls).toBeGreaterThanOrEqual(0)
    expect(result.reasoning).toBeGreaterThanOrEqual(0)
    await expect(db.savedConversationStats('')).rejects.toThrow('Verified')
  } finally {
    db.close()
  }
})

test('fixed archive rejects unknown ownership, conflicted projects and unsupported snapshots atomically', async () => {
  const db = new FixedCanonicalDexieRepository(scope('prod', 'tm-fixed-2', 'account-a'), driver)
  await expect(db.addObservation(source('account-b', 'c1', 'bad'))).rejects.toThrow('identity')
  await db.addObservation(source('account-a', 'c1', 'm1'))
  await expect(
    db.addObservation({ ...source('account-a', 'c1', 'm2'), projectId: 'p2' }),
  ).rejects.toThrow('project changed')
  const unsafe = source('account-a', 'c1', 'm3')
  Object.assign(unsafe.raw, { uncloneable: () => 'private' })
  await expect(db.addObservation(unsafe)).rejects.toThrow()
  expect(await db.counts()).toEqual({
    projects: 1,
    conversations: 1,
    messages: 1,
    elements: 3,
    snapshots: 1,
  })
  db.close()
})

test('an observation exceeding the recovery row budget rejects atomically while preserving every saved original', async () => {
  const db = new FixedCanonicalDexieRepository(
    scope('dev', 'synthetic-budget', 'synthetic-owner'),
    driver,
  )
  try {
    const input = source('synthetic-owner', 'synthetic-budget-chat', 'large-message')
    input.raw.content = { content_type: 'text', parts: ['x'.repeat(6 * 1024 * 1024)] }
    await db.addObservation(input)
    const before = await db.counts()
    const revision = (await db.getConversation('synthetic-budget-chat'))?.revision
    const next = structuredClone(input)
    next.observedAtMs++
    next.raw.content.parts = [`${input.raw.content.parts[0]}z`]
    await expect(db.addObservation(next)).rejects.toThrow('64 MiB')
    expect(await db.counts()).toEqual(before)
    expect((await db.getConversation('synthetic-budget-chat'))?.revision).toBe(revision)
    expect((await db.getSourceSnapshot('synthetic-budget-chat', 'large-message'))?.raw).toEqual(
      input.raw,
    )
    expect(await db.messageVersions('synthetic-budget-chat', 'large-message')).toHaveLength(1)
  } finally {
    db.close()
  }
})

test('page evidence admission rejects an oversized cursor atomically before publishing an unbackupable header', async () => {
  const db = new FixedCanonicalDexieRepository(
    scope('dev', 'synthetic-page-budget', 'synthetic-owner'),
    driver,
  )
  try {
    await db.addObservation(source('synthetic-owner', 'page-budget', 'tiny-message'))
    const before = await db.getConversation('page-budget')
    await expect(
      db.recordPageEvidence(
        'page-budget',
        {
          readId: 'synthetic-large-cursor',
          readStartedAt: 2000,
          isInitial: true,
          startCursor: 'x'.repeat(9 * 1024 * 1024),
          endCursor: null,
          hasPreviousPage: false,
          hasNextPage: false,
          observedAt: 2001,
        },
        null,
      ),
    ).rejects.toThrow('64 MiB')
    expect(await db.getConversation('page-budget')).toEqual(before)
    const rows = []
    for await (const row of db.backupPort().readRows(1)) rows.push(row)
    expect(rows.length).toBeGreaterThan(0)
  } finally {
    db.close()
  }
})

test('peer empty restore and revision1 recreation invalidate chronology and source-digest caches', async () => {
  const a = new FixedCanonicalDexieRepository(
    scope('dev', 'synthetic-peer-aba', 'synthetic-owner'),
    driver,
  )
  const b = new FixedCanonicalDexieRepository(
    scope('dev', 'synthetic-peer-aba', 'synthetic-owner'),
    driver,
  )
  try {
    const first = source('synthetic-owner', 'peer-chat', 'same-message')
    first.raw.content.parts = ['first original']
    await a.addObservation(first)
    const originalHeader = await a.getConversation('peer-chat')
    expect((await a.windowMessages('peer-chat', 'first'))[0]?.messageId).toBe('same-message')
    const snapshot = a.backupPort()
    for await (const _row of snapshot.readRows(1)) {
      /* Pin the exported source. */
    }
    await b.backupPort().restoreAtomically([])
    const second = structuredClone(first)
    second.raw.content.parts = ['second original']
    await b.addObservation(second)
    const recreated = await a.getConversation('peer-chat')
    expect(recreated?.revision).toBe(originalHeader?.revision)
    expect(recreated?.instanceId).not.toBe(originalHeader?.instanceId)
    await expect(snapshot.assertSnapshotCurrent?.()).rejects.toThrow('changed')
    expect(
      (await a.windowMessages('peer-chat', 'first'))[0]?.projection.elements.some(
        (element) => element.text === 'second original',
      ),
    ).toBe(true)
    await a.addObservation(first)
    expect(
      (await a.messageVersions('peer-chat', 'same-message')).map(
        (version) => (version.raw.content as { parts: string[] }).parts[0],
      ),
    ).toEqual(['second original', 'first original'])
    await b.backupPort().restoreAtomically([])
    await b.addObservation(source('synthetic-owner', 'peer-chat', 'new-message'))
    expect((await a.windowMessages('peer-chat', 'first')).map((row) => row.messageId)).toEqual([
      'new-message',
    ])
  } finally {
    a.close()
    b.close()
  }
})

test('peer nonempty restore with the same numeric revision receives a fresh source incarnation', async () => {
  const a = new FixedCanonicalDexieRepository(
    scope('dev', 'synthetic-peer-restore', 'synthetic-owner'),
    driver,
  )
  const b = new FixedCanonicalDexieRepository(
    scope('dev', 'synthetic-peer-restore', 'synthetic-owner'),
    driver,
  )
  const restored = new FixedCanonicalDexieRepository(
    scope('dev', 'synthetic-peer-source', 'synthetic-owner'),
    driver,
  )
  try {
    const input = source('synthetic-owner', 'peer-chat', 'old')
    await a.addObservation(input)
    await a.addObservation({
      ...input,
      raw: { ...input.raw, content: { content_type: 'text', parts: ['conflicting'] } },
    })
    const before = await a.getConversation('peer-chat')
    await a.windowMessages('peer-chat', 'first')
    await restored.addObservation(source('synthetic-owner', 'peer-chat', 'new'))
    const rows = []
    for await (const row of restored.backupPort().readRows(1)) rows.push(row)
    await b.backupPort().restoreAtomically([])
    await b.backupPort().restoreAtomically(rows)
    const after = await a.getConversation('peer-chat')
    expect(after?.revision).toBe(before?.revision)
    expect(after?.instanceId).not.toBe(before?.instanceId)
    expect((await a.windowMessages('peer-chat', 'first')).map((row) => row.messageId)).toEqual(['new'])
  } finally {
    a.close()
    b.close()
    restored.close()
  }
})

test('fresh explicit native project reassociation preserves originals and their historic contexts through recovery', async () => {
  const db = new FixedCanonicalDexieRepository(
    scope('dev', 'synthetic-project-move', 'synthetic-owner'),
    driver,
  )
  try {
    const input = source('synthetic-owner', 'move-chat', 'first')
    await db.addObservation(input)
    const evidence = {
      projectId: 'g-p-two',
      readId: 'verified-native-read',
      readStartedAt: 2000,
      observedAtMs: 2001,
      sourceKind: 'native' as const,
      sourceVersion: 'synthetic-v1',
      raw: { gizmo_id: 'g-p-two', gizmo_type: 'snorlax' },
    }
    expect(await db.reassociateProject('move-chat', evidence, () => true)).toBe(true)
    expect((await db.getConversation('move-chat'))?.projectId).toBe('g-p-two')
    expect((await db.getSourceSnapshot('move-chat', 'first'))?.projectId).toBe('p1')
    const changed = structuredClone(input)
    changed.projectId = 'g-p-two'
    changed.observedAtMs = 2002
    changed.raw.content.parts.push('enriched')
    await db.addObservation(changed)
    const versions = await db.messageVersions('move-chat', 'first')
    expect(versions.map((version) => version.normalized?.context.projectId)).toEqual(['p1', 'g-p-two'])
    expect(versions[0]?.raw).toEqual(input.raw)
    const leave = {
      ...evidence,
      projectId: null,
      readId: 'verified-leave',
      readStartedAt: 3000,
      observedAtMs: 3001,
      raw: { gizmo_id: null },
    }
    expect(await db.reassociateProject('move-chat', leave, () => true)).toBe(true)
    await db.addObservation({ ...source('synthetic-owner', 'move-chat', 'second'), projectId: null })
    const rows = []
    const port = db.backupPort()
    for await (const row of port.readRows(64)) rows.push(row)
    await port.validateRows?.(rows)
    await port.restoreAtomically(rows)
    expect((await db.getConversation('move-chat'))?.projectId).toBeNull()
    expect(
      (await db.messageVersions('move-chat', 'first')).map(
        (version) => version.normalized?.context.projectId,
      ),
    ).toEqual(['p1', 'g-p-two'])
    const token = (store: string, key: string) => JSON.stringify([store, key])
    rows.sort((a, b) =>
      token(a.store, a.key) < token(b.store, b.key)
        ? -1
        : token(a.store, a.key) > token(b.store, b.key)
          ? 1
          : 0,
    )
    const indexedRows = new Map(rows.map((row) => [token(row.store, row.key), row]))
    const staged: PortableBackupReader = {
      count: rows.length,
      async *readRows(store) {
        for (const row of rows)
          if (store === undefined || row.store === store) yield structuredClone(row)
      },
      async get(store, key) {
        return structuredClone(indexedRows.get(token(store, key)))
      },
    }
    const stagedPort = db.backupPort()
    await stagedPort.validateStagedRows?.(staged)
    await stagedPort.restoreStagedAtomically?.(staged)
    expect((await db.getConversation('move-chat'))?.projectId).toBeNull()
    await expect(db.reassociateProject('move-chat', evidence, () => true)).rejects.toThrow('stale')
    await expect(
      db.reassociateProject(
        'move-chat',
        { ...evidence, readStartedAt: 4000, observedAtMs: 4001, raw: {} },
        () => true,
      ),
    ).rejects.toThrow('evidence')
    await expect(
      db.reassociateProject(
        'move-chat',
        { ...evidence, readStartedAt: 4000, observedAtMs: 4001 },
        () => false,
      ),
    ).rejects.toThrow('authorization')
  } finally {
    db.close()
  }
})

test('fixed schema separates channels/installations and strictly limits owner reads', async () => {
  const a = new FixedCanonicalDexieRepository(scope('dev', 'tm-fixed-3', 'owner-a'), driver)
  const b = new FixedCanonicalDexieRepository(scope('dev', 'tm-fixed-3', 'owner-b'), driver)
  const c = new FixedCanonicalDexieRepository(scope('prod', 'tm-fixed-3', 'owner-a'), driver)
  const d = new FixedCanonicalDexieRepository(scope('dev', 'chromium-fixed-3', 'owner-a'), driver)
  expect(new Set([a.databaseName, c.databaseName, d.databaseName]).size).toBe(3)
  await a.addObservation(source('owner-a', 'c', 'ma'))
  await b.addObservation(source('owner-b', 'c', 'mb'))
  expect(await a.listMessages('c')).toHaveLength(1)
  expect(await b.listMessages('c')).toHaveLength(1)
  expect(await a.getSourceSnapshot('c', 'mb')).toBeUndefined()
  expect(await a.counts()).toMatchObject({ messages: 1, snapshots: 1, elements: 3 })
  expect(await b.counts()).toMatchObject({ messages: 1, snapshots: 1, elements: 3 })
  expect(await c.counts()).toMatchObject({ messages: 0 })
  expect(await d.counts()).toMatchObject({ messages: 0 })
  expect(() => fixedArchiveDatabaseName({ productId: 'chatgpt-booster', channel: 'prod' })).toThrow(
    'verified',
  )
  expect(() =>
    fixedArchiveDatabaseName({ ...scope('dev', 'tm', 'owner-a'), productId: 'vk-booster' }),
  ).toThrow('ChatGPT')
  a.close()
  b.close()
  c.close()
  d.close()
})

test('revoked capture permission aborts an atomic fixed Dexie append without partial rows', async () => {
  const db = new FixedCanonicalDexieRepository(scope('dev', 'tm-revoke', 'account-a'), driver)
  let checks = 0
  await expect(
    db.addObservation(source('account-a', 'revoked', 'm1'), () => ++checks < 3),
  ).rejects.toThrow('authorization expired')
  expect(await db.counts()).toEqual({
    projects: 0,
    conversations: 0,
    messages: 0,
    elements: 0,
    snapshots: 0,
  })
  db.close()
})

test('fixed Reader pages saved messages by immutable source ID without silently truncating large archives', async () => {
  const db = new FixedCanonicalDexieRepository(scope('dev', 'tm-window', 'account-a'), driver)
  for (let i = 0; i < 265; i++) {
    const id = `msg-${String(i).padStart(4, '0')}`
    await db.addObservation(source('account-a', 'long-chat', id))
  }
  const latest = await db.windowMessages('long-chat', 'older', undefined, 160)
  expect(latest).toHaveLength(160)
  expect(latest[0]?.messageId).toBe('msg-0105')
  expect(latest.at(-1)?.messageId).toBe('msg-0264')
  const older = await db.windowMessages('long-chat', 'older', latest[0]?.messageId, 160)
  expect(older).toHaveLength(105)
  expect(older[0]?.messageId).toBe('msg-0000')
  const first = await db.windowMessages('long-chat', 'first', undefined, 160)
  expect(first[0]?.messageId).toBe('msg-0000')
  expect(await db.hasMessageBoundary('long-chat', 'msg-0105', 'before')).toBe(true)
  expect(await db.hasMessageBoundary('long-chat', 'msg-0264', 'after')).toBe(false)
  expect(await db.countConversation('long-chat')).toBe(265)
  db.close()
})
