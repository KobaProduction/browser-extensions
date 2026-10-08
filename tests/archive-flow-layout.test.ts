import { describe, expect, test } from 'bun:test'
import type { ArchiveThreadView } from '../packages/core/src/archive'
import { archiveGitgraphData, archiveGitgraphSegments } from '../packages/ui/src/archive-gitgraph'

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
  test('unrelated roots render as sequential segments, not parallel branches', () => {
    const data = archiveGitgraphData(
      fixture([
        ['first', null],
        ['second', 'first'],
        ['third', null],
        ['fourth', 'third'],
      ]),
    )
    const segments = archiveGitgraphSegments(data.commits)
    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.commits.length)).toEqual([2, 2])
    expect(segments[0]?.commits[0]?.hash).toBe('second')
    expect(segments[1]?.commits[0]?.hash).toBe('fourth')
    expect(segments.every((segment) => !segment.clipped)).toBe(true)
  })
  test('a true sibling fork keeps the exact parent graph within one segment', () => {
    const data = archiveGitgraphData(
      fixture([
        ['root', null],
        ['a', 'root'],
        ['b', 'root'],
        ['a2', 'a'],
        ['b2', 'b'],
      ]),
    )
    const segments = archiveGitgraphSegments(data.commits)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.commits.filter((item) => item.refs.length > 0)).toHaveLength(2)
    expect(segments[0]?.commits.find((item) => item.hash === 'a')?.parents).toEqual(['root'])
    expect(segments[0]?.commits.find((item) => item.hash === 'b')?.parents).toEqual(['root'])
  })
  test('partial graph windows expose clipped ancestry without synthesizing edges', () => {
    const data = archiveGitgraphData(
      fixture([
        ['root', null],
        ['child', 'root'],
        ['grandchild', 'child'],
      ]),
    )
    const segments = archiveGitgraphSegments(data.commits.slice(0, 2))
    expect(segments).toHaveLength(1)
    expect(segments[0]?.clipped).toBe(true)
    expect(segments[0]?.commits.find((item) => item.hash === 'child')?.parents).toEqual([])
    expect(segments[0]?.commits.find((item) => item.hash === 'grandchild')?.parents).toEqual([
      'child',
    ])
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
