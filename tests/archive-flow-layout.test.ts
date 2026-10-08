import { describe, expect, test } from 'bun:test'
import type { ArchiveThreadView } from '../packages/core/src/archive'
import { archiveGitgraphData } from '../packages/ui/src/archive-gitgraph'

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

describe('GitGraph saved message DAG', () => {
  test('exports topologically ordered exact parent links for edited siblings', () => {
    const result = archiveGitgraphData(
      fixture([
        ['child-b', 'root'],
        ['root', null],
        ['child-a', 'root'],
        ['tip-a', 'child-a'],
        ['tip-b', 'child-b'],
      ]),
    )
    expect(result.commits.length).toBe(5)
    const by = new Map(result.commits.map((commit, index) => [commit.hash, { ...commit, index }]))
    expect(by.get('child-a')?.parents).toEqual(['root'])
    expect(by.get('child-b')?.parents).toEqual(['root'])
    expect(by.get('root')!.index).toBeGreaterThan(by.get('child-a')!.index)
    expect(by.get('root')!.index).toBeGreaterThan(by.get('child-b')!.index)
    expect(result.commits.filter((commit) => commit.refs.length > 0)).toHaveLength(2)
  })
  test('orphan ancestry is reported but never invented', () => {
    const data = archiveGitgraphData(
      fixture([
        ['root', null],
        ['stray', 'unavailable'],
      ]),
    )
    expect(data.commits.find((x) => x.hash === 'stray')?.parents).toEqual([])
    expect(data.unresolved).toBe(1)
  })
  test('corrupt cycles do not hang or create valid-looking loops', () => {
    const data = archiveGitgraphData(
      fixture([
        ['a', 'b'],
        ['b', 'a'],
      ]),
    )
    expect(data.commits).toHaveLength(2)
    expect(data.commits.some((x) => x.parents.length === 0)).toBe(true)
  })
})
