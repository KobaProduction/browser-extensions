import { expect, test } from 'bun:test'
import {
  type ArchiveGraphNode,
  conversationIntegrityFromGraph,
  linearArchiveIntegrity,
} from './conversation-integrity'

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
