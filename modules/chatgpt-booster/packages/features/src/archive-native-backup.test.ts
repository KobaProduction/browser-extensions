import { expect, test } from 'bun:test'
import { decodeNativeFullHistory } from '@chatgpt-booster/observer'
import { decodeArchiveClone, encodeArchiveClone } from '@kobaproduction/browser-archive'
import type { PortableBackupReader, PortableBackupRow } from '@kobaproduction/browser-storage'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedCanonicalDexieRepository, type FixedConversation } from './archive-fixed-dexie'

function staged(rows: readonly PortableBackupRow[]): PortableBackupReader {
  const key = (store: string, id: string) => JSON.stringify([store, id])
  const sorted = [...rows].sort((a, b) => (key(a.store, a.key) < key(b.store, b.key) ? -1 : 1))
  const index = new Map(sorted.map((row) => [key(row.store, row.key), row]))
  return {
    count: rows.length,
    async *readRows(store) {
      for (const row of sorted)
        if (store === undefined || row.store === store) yield structuredClone(row)
    },
    async get(store, id) {
      return structuredClone(index.get(key(store, id)))
    },
  }
}

test('both backup paths preserve graph/exhaustion originals and reject broken relations before writes', async () => {
  const repo = new FixedCanonicalDexieRepository(
    {
      productId: 'chatgpt-booster',
      channel: 'dev',
      installationId: crypto.randomUUID(),
      ownerId: 'owner',
    },
    { indexedDB, IDBKeyRange },
  )
  const message = (id: string, role: string, parent: string | null) => ({
    id,
    author: { role },
    create_time: 1800000000,
    content: { content_type: 'text', parts: ['Synthetic backup'] },
    metadata: { parent_id: parent },
    status: 'finished_successfully',
    end_turn: role === 'assistant',
    recipient: 'all',
    channel: 'final',
  })
  const user = message('user', 'user', null),
    answer = message('answer', 'assistant', 'user')
  try {
    for (const raw of [user, answer])
      await repo.addObservation({
        accountId: 'owner',
        conversationId: 'chat',
        projectId: null,
        sourceKind: 'native',
        sourceVersion: 'synthetic',
        observedAtMs: 20,
        raw,
      })
    const { nativeGraph } = decodeNativeFullHistory(
      {
        conversation_id: 'chat',
        current_node: 'answer',
        mapping: {
          user: { id: 'user', parent: null, children: ['answer'], message: user },
          answer: { id: 'answer', parent: 'user', children: [], message: answer },
        },
      },
      'chat',
    )
    await repo.recordPageEvidence(
      'chat',
      {
        readId: 'r',
        readStartedAt: 10,
        observedAt: 20,
        isInitial: true,
        requestedBefore: null,
        startCursor: 'user',
        endCursor: 'answer',
        hasPreviousPage: false,
        hasNextPage: false,
      },
      'answer',
      () => true,
      {
        projectId: null,
        title: null,
        nativeGraph: { graph: nativeGraph, readId: 'r', readStartedAt: 10, observedAt: 20 },
      },
    )
    await repo.recordExhaustion('chat', {
      kind: 'conversation_too_large',
      requestId: 'rejected',
      userMessageId: 'user',
      observedAt: 25,
    })
    const expected = await repo.getConversation('chat')
    const rows: PortableBackupRow[] = []
    for await (const row of repo.backupPort().readRows(32)) rows.push(row)
    await repo.backupPort().restoreAtomically(rows)
    const stage = staged(rows),
      port = repo.backupPort()
    await port.validateStagedRows?.(stage)
    await port.restoreStagedAtomically?.(stage)
    const restored = await repo.getConversation('chat')
    expect(restored?.nativeGraph).toEqual(expected?.nativeGraph)
    expect(restored?.exhaustionEvidence).toEqual(expected?.exhaustionEvidence)
    expect((await repo.getSourceSnapshot('chat', 'user'))?.raw).toEqual(user)
    const before = await repo.counts()
    for (const corruption of ['head', 'empty-head', 'original', 'role', 'receipt']) {
      const broken = structuredClone(rows)
      const row = broken.find((item) => item.store === 'conversations')
      if (!row) throw Error('Missing conversation fixture')
      const header = decodeArchiveClone(row.value) as FixedConversation
      if (!header.nativeGraph || !header.exhaustionEvidence) throw Error('Missing evidence fixture')
      if (corruption === 'head') header.nativeGraph.graph.header.current_node = 'missing'
      if (corruption === 'empty-head') header.nativeGraph.graph.nodes = {}
      if (corruption === 'role') header.exhaustionEvidence.userMessageId = 'answer'
      if (corruption === 'receipt') header.nativeGraph.readStartedAt = -1
      row.value = await encodeArchiveClone(header)
      if (corruption === 'original')
        broken.splice(
          broken.findIndex((item) => item.store === 'snapshots'),
          1,
        )
      const target = repo.backupPort()
      await expect(target.validateRows?.(broken)).rejects.toThrow()
      await expect(target.validateStagedRows?.(staged(broken))).rejects.toThrow()
      expect(await repo.counts()).toEqual(before)
    }
  } finally {
    repo.close()
  }
})
