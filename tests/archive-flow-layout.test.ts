import { describe, expect, test } from 'bun:test'
import type { ArchiveThreadView } from '../packages/core/src/archive'
import { layoutArchiveFlow } from '../packages/ui/src/archive-flow-layout'

function fixture(pairs: Array<[string, string | null]>): ArchiveThreadView {
  return {
    turns: pairs.map(([id, parentId]) => ({
      id,
      association: 'parent',
      details: [],
      messages: [
        {
          kind: 'user',
          text: id,
          record: {
            messageId: id,
            messageKey: id,
            parentId,
            createTime: 1,
            conversationId: 'fixture',
          },
        },
      ],
    })),
    messageCount: pairs.length,
    recordCount: pairs.length,
    detailCount: 0,
  } as unknown as ArchiveThreadView
}
describe('Dagre chronological independent DAG', () => {
  test('lays out edited sibling branches below parent', () => {
    const result = layoutArchiveFlow(
      fixture([
        ['child-b', 'root'],
        ['root', null],
        ['child-a', 'root'],
        ['tip-a', 'child-a'],
        ['tip-b', 'child-b'],
      ]),
    )
    expect(result.nodes.length).toBe(5)
    expect(result.edges).toHaveLength(4)
    const by = new Map(result.nodes.map((n) => [n.id, n.position]))
    expect(by.get('child-a')!.y).toBeGreaterThan(by.get('root')!.y)
    expect(by.get('child-b')!.y).toBeGreaterThan(by.get('root')!.y)
    expect(by.get('child-a')!.x).not.toBe(by.get('child-b')!.x)
  })
  test('does not link missing parents', () => {
    const result = layoutArchiveFlow(
      fixture([
        ['root', null],
        ['stray', 'unavailable'],
      ]),
    )
    expect(result.edges).toHaveLength(0)
    expect(result.disconnected).toBe(2)
  })
})

test('cyclic corrupt parent metadata does not generate a cyclic graph', () => {
  const result = layoutArchiveFlow(
    fixture([
      ['a', 'b'],
      ['b', 'a'],
    ]),
  )
  expect(result.edges.length).toBeLessThan(2)
  expect(result.nodes).toHaveLength(2)
})
