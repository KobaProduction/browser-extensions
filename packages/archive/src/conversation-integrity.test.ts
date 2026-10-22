import { expect, test } from 'bun:test'
import {
  type ArchiveGraphNode,
  conversationIntegrityFromGraph,
  linearArchiveIntegrity,
} from './conversation-integrity'

test('an explicit first-message boundary closes only its unknown parent and preserves actual gaps and disconnected chains', () => {
  const first: ArchiveGraphNode = { id: 'first', parentId: null, parentKnown: false }
  const evidence = { firstId: 'first', startReached: false, endReached: true, headId: 'answer' }
  const answer: ArchiveGraphNode = { id: 'answer', parentId: 'first', parentKnown: true }
  expect(conversationIntegrityFromGraph([first, answer], evidence)).toMatchObject({
    start: 'verified',
    end: 'verified',
    chain: 'verified',
    firstMessageId: 'first',
    roots: [],
  })
  expect(
    conversationIntegrityFromGraph([first, { ...answer, parentId: 'absent' }], evidence).chain,
  ).toBe('gaps')
  expect(
    conversationIntegrityFromGraph(
      [first, answer, { id: 'unrelated', parentId: null, parentKnown: true }],
      evidence,
    ).chain,
  ).toBe('gaps')
  expect(conversationIntegrityFromGraph([answer], evidence).firstMessageId).toBeNull()
  expect(first.parentKnown).toBe(false)
})

test('native history boundary confirms only its exact service root without forging a parent', () => {
  const nodes = [
    { id: 'service-root', parentId: null, parentKnown: false },
    { id: 'first-user', parentId: 'service-root', parentKnown: true },
    { id: 'answer', parentId: 'first-user', parentKnown: true },
  ]
  const evidence = {
    firstId: 'first-user',
    rootId: 'service-root',
    startReached: true,
    endReached: true,
    headId: 'answer',
  }
  expect(conversationIntegrityFromGraph(nodes, evidence)).toMatchObject({
    chain: 'verified',
    firstMessageId: 'first-user',
  })
  expect(conversationIntegrityFromGraph(nodes, { ...evidence, startReached: false }).chain).toBe(
    'unknown',
  )
  expect(conversationIntegrityFromGraph(nodes, { ...evidence, rootId: 'different' }).chain).toBe(
    'unknown',
  )
  expect(
    conversationIntegrityFromGraph(
      [{ id: 'service-root', parentId: 'missing', parentKnown: true }, ...nodes.slice(1)],
      evidence,
    ).chain,
  ).toBe('gaps')
  expect(nodes[0]?.parentKnown).toBe(false)
  // The native service prefix and first submitted user message have separate,
  // explicit start proofs. Their missing parents must not be invented.
  expect(
    conversationIntegrityFromGraph(
      [
        nodes[0] as ArchiveGraphNode,
        { id: 'first-user', parentId: null, parentKnown: false },
        nodes[2] as ArchiveGraphNode,
      ],
      evidence,
    ).chain,
  ).toBe('verified')
})

test('one observed graph with branches has independent start/end proof', () => {
  const nodes: ArchiveGraphNode[] = [
    { id: 'root', parentId: null, parentKnown: true },
    { id: 'branch-a', parentId: 'root', parentKnown: true },
    { id: 'branch-b', parentId: 'root', parentKnown: true },
  ]
  const result = conversationIntegrityFromGraph(nodes, {
    startReached: false,
    endReached: true,
    headId: 'branch-b',
  })
  expect(result).toMatchObject({
    start: 'verified',
    end: 'verified',
    chain: 'verified',
    firstMessageId: 'root',
    lastMessageId: 'branch-b',
  })
  expect(result.branches).toEqual([{ parentId: 'root', messageIds: ['branch-a', 'branch-b'] }])
  expect(
    conversationIntegrityFromGraph(nodes, { startReached: true, endReached: false, headId: 'branch-b' })
      .chain,
  ).toBe('unknown')
})
test('separate explicit roots cannot masquerade as one verified conversation', () => {
  const result = conversationIntegrityFromGraph(
    [
      { id: 'a', parentId: null, parentKnown: true },
      { id: 'b', parentId: null, parentKnown: true },
    ],
    { startReached: true, endReached: true, headId: 'b' },
  )
  expect(result.chain).toBe('gaps')
  expect(result.firstMessageId).toBeNull()
  expect(result.issues).toContainEqual({ messageId: 'b', parentId: null, reason: 'disconnected' })
})
test('known missing parents/cycles/duplicate IDs fail while unknown relationships stay unknown', () => {
  for (const nodes of [
    [{ id: 'a', parentId: 'absent', parentKnown: true }],
    [
      { id: 'a', parentId: 'b', parentKnown: true },
      { id: 'b', parentId: 'a', parentKnown: true },
    ],
    [
      { id: 'a', parentId: null, parentKnown: true },
      { id: 'a', parentId: null, parentKnown: true },
    ],
  ])
    expect(
      conversationIntegrityFromGraph(nodes, { startReached: true, endReached: true, headId: 'a' }).chain,
    ).toBe('gaps')
  const unknown = conversationIntegrityFromGraph([{ id: 'a', parentId: null, parentKnown: false }], {
    startReached: true,
    endReached: true,
    headId: 'a',
  })
  expect(unknown.chain).toBe('unknown')
  expect(unknown.issues.map((issue) => issue.reason)).toEqual(['unverified-root'])
})
test('large observed chains stay iterative and retain distant source IDs', () => {
  const nodes = Array.from({ length: 20000 }, (_, index) => ({
    id: String(index * 17 + 5),
    parentId: index ? String((index - 1) * 17 + 5) : null,
    parentKnown: true,
  }))
  expect(
    conversationIntegrityFromGraph(nodes, {
      startReached: true,
      endReached: true,
      headId: nodes.at(-1)?.id ?? null,
    }).chain,
  ).toBe('verified')
})
test('linear coverage never infers gaps or completeness from adjacent numeric IDs', () => {
  const base = {
    savedCount: 2,
    reportedCount: 2,
    firstId: '7',
    lastId: '9000',
    startReached: true,
    endReached: true,
    countStable: true,
    current: true,
  }
  expect(linearArchiveIntegrity(base)).toMatchObject({
    chain: 'verified',
    firstMessageId: '7',
    lastMessageId: '9000',
  })
  for (const patch of [
    { current: false },
    { countStable: false },
    { reportedCount: null },
    { savedCount: 1 },
    { firstId: null },
    { endReached: false },
  ])
    expect(linearArchiveIntegrity({ ...base, ...patch }).chain).toBe('unknown')
})
