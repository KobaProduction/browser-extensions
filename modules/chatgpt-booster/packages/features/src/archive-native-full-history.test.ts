import { expect, test } from 'bun:test'
import {
  type ConversationArchiveEventDetail,
  decodeNativeFullHistory,
  validateNativeHistoryGraph,
} from '@chatgpt-booster/observer'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedCanonicalDexieRepository } from './archive-fixed-dexie'
import type { FixedChatGptCapture } from './archive-fixed-runtime'
import { nativeGraphIntegrity } from './archive-native-graph'
import {
  ArchiveSourceGate,
  NATIVE_HISTORY_CONTRACT_V9,
  NATIVE_HISTORY_CONTRACT_V10,
  NATIVE_HISTORY_CONTRACT_V11,
  NATIVE_HISTORY_CONTRACT_VERSION,
} from './archive-source-contract'
import { ConversationArchiveWorkspace } from './archive-workspace'
import { ConversationObservationGateway } from './conversation-observation-gateway'
import { normalizeConversationMessage } from './conversation-records'
import type { ConversationStateStore } from './conversation-state'

function fixture() {
  const message = (id: string, role: string) => ({
    id,
    author: { role, name: null, metadata: {} },
    create_time: 1800000000,
    update_time: null,
    content: { content_type: 'text', parts: ['Synthetic full history'] },
    status: 'finished_successfully',
    end_turn: role === 'assistant',
    weight: 1,
    metadata: { parent_id: 'obsolete-stream-reference' },
    recipient: 'all',
    channel: 'final',
  })
  return {
    conversation_id: 'synthetic-full',
    title: 'Synthetic full history',
    current_node: 'm2',
    mapping: {
      root: { id: 'root', parent: null, children: ['m1'], message: null },
      m1: { id: 'm1', parent: 'root', children: ['m2'], message: message('m1', 'user') },
      m2: { id: 'm2', parent: 'm1', children: [], message: message('m2', 'assistant') },
    },
  }
}
function page(): ConversationArchiveEventDetail {
  const full = fixture()
  return {
    kind: 'conversation-page',
    conversationId: full.conversation_id,
    sourceUrl: `https://chatgpt.com/backend-api/conversation/${full.conversation_id}`,
    isInitial: true,
    timestamp: 20,
    readId: 'full-read',
    readStartedAt: 10,
    ...decodeNativeFullHistory(full, full.conversation_id),
  }
}
test('full source keeps original metadata and validates explicit graph identities before admission', () => {
  const original = fixture(),
    before = structuredClone(original)
  const decoded = decodeNativeFullHistory(original, original.conversation_id)
  expect(original).toEqual(before)
  expect(decoded.payload.messages[1]?.metadata).toEqual({ parent_id: 'obsolete-stream-reference' })
  new ArchiveSourceGate().inspect(page())
  for (const version of [NATIVE_HISTORY_CONTRACT_V10, NATIVE_HISTORY_CONTRACT_V11])
    new ArchiveSourceGate(false, version).inspect(page())
  const parallel = page()
  ;(parallel.payload.messages[0]?.metadata as Record<string, unknown>).paragen_variants_info = {
    type: 'synthetic',
  }
  new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V11).inspect(parallel)
  expect(() => new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V10).inspect(parallel)).toThrow()
  expect(() => new ArchiveSourceGate(false, NATIVE_HISTORY_CONTRACT_V9).inspect(page())).toThrow()
  const invalid = page()
  const invalidNode = invalid.nativeGraph?.nodes.m2
  if (!invalidNode) throw Error('Missing synthetic node')
  invalidNode.parent = 'missing'
  expect(() => new ArchiveSourceGate().inspect(invalid)).toThrow()
  const incomplete = page()
  ;(incomplete.payload.messages as unknown[]).pop()
  expect(() => new ArchiveSourceGate().inspect(incomplete)).toThrow()
})
test('graph integrity uses actual native parents and discloses historic records outside the current graph', () => {
  const { nativeGraph } = decodeNativeFullHistory(fixture(), 'synthetic-full')
  expect(nativeGraphIntegrity(nativeGraph, new Set(['m1', 'm2', 'historic']))).toMatchObject({
    start: 'verified',
    end: 'verified',
    chain: 'verified',
    scope: 'current-native-graph',
    retainedOutsideGraph: 1,
    firstMessageId: 'm1',
    lastMessageId: 'm2',
    issues: [],
  })
  expect(nativeGraphIntegrity(nativeGraph, new Set(['m2']))).toMatchObject({ chain: 'gaps' })
  expect(nativeGraphIntegrity(nativeGraph, new Set(['m1']))).toMatchObject({ end: 'missing' })
})
test('native full graph is committed only after its messages and survives a new repository instance', async () => {
  const scope = {
    productId: 'chatgpt-booster' as const,
    channel: 'dev' as const,
    installationId: `full-${crypto.randomUUID()}`,
    ownerId: 'synthetic-owner',
  }
  const repo = new FixedCanonicalDexieRepository(scope, { indexedDB, IDBKeyRange })
  const source = page(),
    graph = source.nativeGraph
  if (!graph) throw Error('Missing synthetic graph')
  const evidence = {
    readId: 'full-read',
    readStartedAt: 10,
    isInitial: true,
    requestedBefore: null,
    startCursor: 'm1',
    endCursor: 'm2',
    hasPreviousPage: false,
    hasNextPage: false,
    observedAt: 20,
  }
  const context = {
    projectId: null,
    title: 'Synthetic full history',
    nativeGraph: { graph, readId: 'full-read', readStartedAt: 10, observedAt: 20 },
  }
  await expect(
    repo.recordPageEvidence('synthetic-full', evidence, 'm2', () => true, context),
  ).rejects.toThrow()
  for (const raw of source.payload.messages as Record<string, unknown>[])
    await repo.addObservation({
      accountId: scope.ownerId,
      conversationId: 'synthetic-full',
      projectId: null,
      conversationTitle: null,
      sourceKind: 'native',
      sourceVersion: NATIVE_HISTORY_CONTRACT_VERSION,
      observedAtMs: 20,
      raw,
    })
  await repo.recordPageEvidence('synthetic-full', evidence, 'm2', () => true, context)
  const reopened = new FixedCanonicalDexieRepository(scope, { indexedDB, IDBKeyRange })
  expect(await reopened.integrity('synthetic-full')).toMatchObject({
    chain: 'verified',
    start: 'verified',
    end: 'verified',
  })
  expect((await reopened.getMessage('synthetic-full', 'm2'))?.projection.parentMessageId).toBe(
    'obsolete-stream-reference',
  )
  const rejected = { ...fixture().mapping.m1.message, id: 'rejected-user', create_time: 1900000000 }
  await repo.addObservation({
    accountId: scope.ownerId,
    conversationId: 'synthetic-full',
    projectId: null,
    conversationTitle: null,
    sourceKind: 'native-submission',
    sourceVersion: NATIVE_HISTORY_CONTRACT_VERSION,
    observedAtMs: 5,
    raw: rejected,
  })
  await repo.recordStreamHead('synthetic-full', rejected, () => true, true, 5)
  const terminal = {
    kind: 'conversation_too_large' as const,
    requestId: 'rejected-request',
    userMessageId: rejected.id,
    observedAt: 6,
  }
  await repo.recordExhaustion('synthetic-full', terminal)
  const first = (await repo.getConversation('synthetic-full'))?.startEvidence
  // Source create_time may be later for an unsaved/rejected submission. A new
  // full response, not that timestamp, owns the current server graph head.
  await repo.recordPageEvidence('synthetic-full', evidence, 'm2', () => true, context)
  expect((await reopened.getConversation('synthetic-full'))?.currentHeadId).toBe('m2')
  expect(await reopened.integrity('synthetic-full')).toMatchObject({
    chain: 'verified',
    retainedOutsideGraph: 1,
  })
  await repo.recordExhaustion('synthetic-full', {
    ...terminal,
    requestId: 'later-retry',
    observedAt: 30,
  })
  expect((await reopened.getConversation('synthetic-full'))?.exhaustionEvidence).toEqual({
    ...terminal,
    savedHeadId: rejected.id,
  })
  expect((await reopened.getConversation('synthetic-full'))?.startEvidence).toEqual(first)
  expect((await reopened.getSourceSnapshot('synthetic-full', rejected.id))?.raw).toEqual(rejected)
  // A live run observed after the read began must still invalidate its end.
  await repo.recordStreamHead('synthetic-full', rejected, () => true, true, 25)
  await repo.recordPageEvidence('synthetic-full', evidence, 'm2', () => true, context)
  expect((await reopened.getConversation('synthetic-full'))?.currentHeadId).toBe(rejected.id)
  expect((await reopened.integrity('synthetic-full')).end).not.toBe('verified')
})

test('a genuine empty full response proves an empty current graph without inventing message anchors', () => {
  const full = { conversation_id: 'empty', current_node: null, mapping: {} }
  const decoded = decodeNativeFullHistory(full, 'empty')
  expect(decoded.payload.messages).toHaveLength(0)
  expect(nativeGraphIntegrity(decoded.nativeGraph, new Set())).toMatchObject({
    chain: 'verified',
    firstMessageId: null,
    lastMessageId: null,
  })
})

test('Reader graph views do not clone complete wire pages per displayed record', () => {
  const source = page(),
    gateway = new ConversationObservationGateway()
  gateway.reset('owner', 1)
  const seq = gateway.receive('synthetic-full', { kind: 'page', detail: source })
  gateway.admit(seq, { kind: 'page', detail: source })
  gateway.sources = () => {
    throw Error('Reader must not copy all native pages')
  }
  const records = (source.payload.messages as Record<string, unknown>[]).flatMap((raw) => {
    const record = normalizeConversationMessage(raw, 'synthetic-full', null, 20)
    return record ? [record] : []
  })
  const memory = {
    observations: gateway,
    verifiedAccountId: () => 'owner',
    accountEpoch: () => 1,
    header: () => ({ currentNodeId: 'm2', projectId: null, title: null }),
    listMessages: () => records,
  } as unknown as ConversationStateStore
  const workspace = new ConversationArchiveWorkspace(memory, {} as FixedChatGptCapture)
  for (let i = 0; i < 50; i++) {
    expect(workspace.records('synthetic-full').map((x) => x.parentId)).toEqual([null, 'm1'])
  }
})

test('empty graphs reject missing, non-null and dangling heads at every source boundary', () => {
  for (const head of [undefined, 'missing', '', 0, false]) {
    expect(() =>
      decodeNativeFullHistory({ conversation_id: 'empty', current_node: head, mapping: {} }, 'empty'),
    ).toThrow()
    const graph = {
      schema: 'chatgpt-native-graph.v1',
      header: { conversation_id: 'empty', current_node: head },
      nodes: {},
    }
    expect(() => validateNativeHistoryGraph(graph, 'empty')).toThrow()
    const source = {
      ...page(),
      conversationId: 'empty',
      nativeGraph: graph,
      payload: {
        conversation_id: 'empty',
        current_node: head,
        messages: [],
        page_info: {
          start_cursor: null,
          end_cursor: null,
          has_previous_page: false,
          has_next_page: false,
        },
      },
    }
    expect(() => new ArchiveSourceGate().inspect(source as ConversationArchiveEventDetail)).toThrow()
  }
})

test('saved checkpoint edges and later live edges compose without certifying old outside records', async () => {
  const repo = new FixedCanonicalDexieRepository(
    {
      productId: 'chatgpt-booster',
      channel: 'dev',
      installationId: crypto.randomUUID(),
      ownerId: 'owner',
    },
    { indexedDB, IDBKeyRange },
  )
  try {
    const source = page()
    if (!source.nativeGraph) throw Error('Missing fixture graph')
    for (const raw of source.payload.messages as Record<string, unknown>[])
      await repo.addObservation({
        accountId: 'owner',
        conversationId: 'synthetic-full',
        projectId: null,
        conversationTitle: null,
        sourceKind: 'native',
        sourceVersion: NATIVE_HISTORY_CONTRACT_VERSION,
        observedAtMs: 20,
        raw,
      })
    await repo.recordPageEvidence(
      'synthetic-full',
      {
        readId: 'full',
        readStartedAt: 10,
        observedAt: 20,
        isInitial: true,
        requestedBefore: null,
        startCursor: 'm1',
        endCursor: 'm2',
        hasPreviousPage: false,
        hasNextPage: false,
      },
      'm2',
      () => true,
      {
        projectId: null,
        title: null,
        nativeGraph: { graph: source.nativeGraph, readId: 'full', readStartedAt: 10, observedAt: 20 },
      },
    )
    for (const [id, sourceKind, receipt] of [
      ['live', 'native-stream', 30],
      ['historic', 'native', 40],
      ['old-stream', 'native-stream', 5],
    ] as const) {
      const raw = { ...fixture().mapping.m2.message, id, metadata: { parent_id: 'm2' } }
      await repo.addObservation({
        accountId: 'owner',
        conversationId: 'synthetic-full',
        projectId: null,
        conversationTitle: null,
        sourceKind,
        sourceVersion: NATIVE_HISTORY_CONTRACT_VERSION,
        observedAtMs: receipt,
        raw,
      })
    }
    expect(await repo.branchPath('synthetic-full', 'live')).toEqual(['m1', 'm2', 'live'])
    expect(await repo.branchPath('synthetic-full', 'm2')).toEqual(['m1', 'm2'])
    for (const id of ['historic', 'old-stream'])
      await expect(repo.branchPath('synthetic-full', id)).rejects.toThrow('incompleteSource')
    const timeline = await repo.timelineMessages('synthetic-full')
    expect(timeline.find((row) => row.id === 'live')).toMatchObject({
      parentId: 'm2',
      parentKnown: true,
    })
    expect(timeline.find((row) => row.id === 'historic')?.parentKnown).toBe(false)
    const chunk = await repo.workspaceChunk('synthetic-full')
    expect(chunk.rows.find((row) => row.id === 'live')?.liveObservedAt).toBe(30)
  } finally {
    repo.close()
  }
})

test('a delayed full response cannot erase newer live relationships in the RAM Reader', () => {
  const gateway = new ConversationObservationGateway(),
    source = page()
  gateway.reset('owner', 1)
  const records = (source.payload.messages as Record<string, unknown>[]).flatMap((raw) => {
    const record = normalizeConversationMessage(raw, 'synthetic-full', null, 20)
    return record ? [record] : []
  })
  const memory = {
    observations: gateway,
    verifiedAccountId: () => 'owner',
    accountEpoch: () => 1,
    header: () => ({ currentNodeId: 'm2', projectId: null, title: null }),
    listMessages: () => records,
    getMessage: (_id: string, key: string) => records.find((r) => r.messageId === key),
  } as unknown as ConversationStateStore
  const workspace = new ConversationArchiveWorkspace(memory, {
    subscribeSaved: () => () => {},
  } as unknown as FixedChatGptCapture)
  workspace.start()
  try {
    const admitPage = (detail: ConversationArchiveEventDetail) => {
      const seq = gateway.receive('synthetic-full', { kind: 'page', detail })
      gateway.admit(seq, { kind: 'page', detail })
    }
    admitPage(source)
    const raw = { ...fixture().mapping.m2.message, id: 'live', metadata: { parent_id: 'm2' } }
    const record = normalizeConversationMessage(raw, 'synthetic-full', null, 30)
    if (!record) throw Error('Missing fixture record')
    records.push(record)
    const seq = gateway.receive('synthetic-full', {
      kind: 'stream',
      detail: {
        conversationId: 'synthetic-full',
        kind: 'message',
        record: raw,
        observedAt: 30,
      },
    })
    gateway.admit(seq, {
      kind: 'message',
      detail: {
        conversationId: 'synthetic-full',
        accountId: 'owner',
        raw,
        observedAt: 30,
        activeRun: true,
        requestId: 'live-run',
      },
    })
    expect(workspace.branchPath('synthetic-full', 'live')).toEqual(['m1', 'm2', 'live'])
    admitPage({ ...source, timestamp: 40 })
    expect(workspace.getMessage('synthetic-full', 'live')).toMatchObject({
      parentId: 'm2',
      parentKnown: true,
    })
    expect(workspace.branchPath('synthetic-full', 'live')).toEqual(['m1', 'm2', 'live'])
    // An even older response cannot replace the selected checkpoint either.
    admitPage({ ...source, readStartedAt: 1, timestamp: 50 })
    expect(workspace.nativeGraphRead('synthetic-full')?.readStartedAt).toBe(10)
    expect(workspace.branchPath('synthetic-full', 'live')).toEqual(['m1', 'm2', 'live'])
  } finally {
    workspace.stop()
  }
})
