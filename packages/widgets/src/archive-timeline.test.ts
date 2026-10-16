import { expect, test } from 'bun:test'
import {
  ARCHIVE_TIMELINE_WINDOW_SIZE,
  type ArchiveTimelineNode,
  archiveTimelineLayout,
  archiveTimelineSameIds,
  archiveTimelineWindowStart,
} from './archive-timeline'

const node = (id: string, parentId: string | null): ArchiveTimelineNode => ({ id, parentId, label: id })

test('metadata replacement preserves logical timeline identity while equal-length switches cancel it', () => {
  const before = [node('a', null), node('b', 'a')]
  const refreshed = before.map((item) => ({ ...item, label: 'Updated', preview: 'New metadata' }))
  const ids = (items: readonly ArchiveTimelineNode[]) => items.map((item) => item.id)
  expect(archiveTimelineSameIds(ids(before), ids(refreshed))).toBe(true)
  expect(archiveTimelineSameIds(ids(before), ['x', 'y'])).toBe(false)
  expect(archiveTimelineSameIds(ids(before), ['b', 'a'])).toBe(false)
  expect(archiveTimelineSameIds(ids(before), ['a'])).toBe(false)
  expect(archiveTimelineSameIds([], [])).toBe(true)
})

test('vertical timeline preserves endpoints and independent fork lanes', () => {
  const graph = archiveTimelineLayout([
    node('root', null),
    node('a', 'root'),
    node('b', 'root'),
    node('a2', 'a'),
    node('b2', 'b'),
  ])
  expect(graph.points.map((point) => point.id)).toEqual(['root', 'a', 'b', 'a2', 'b2'])
  expect(graph.points[0]?.y).toBe(24)
  expect(graph.points.at(-1)?.y).toBe(216)
  expect(graph.points[1]?.lane).not.toBe(graph.points[2]?.lane)
  expect(graph.edges.map((edge) => [edge.parentId, edge.childId])).toEqual([
    ['root', 'a'],
    ['root', 'b'],
    ['a', 'a2'],
    ['b', 'b2'],
  ])
  expect(graph.edges.every((edge) => !edge.uncertain)).toBe(true)
})
test('unknown ancestry is not replaced by a neighboring edge; reverse source remains uncertain', () => {
  const graph = archiveTimelineLayout([
    node('child', 'later'),
    node('orphan', 'missing'),
    node('later', null),
  ])
  expect(graph.edges).toHaveLength(1)
  expect(graph.edges[0]).toMatchObject({ childId: 'child', parentId: 'later', uncertain: true })
  expect(archiveTimelineLayout([]).points).toEqual([])
})

test('a 100000-message timeline keeps first, middle and last reachable through a bounded render window', () => {
  const nodes = Array.from({ length: 100000 }, (_, index) =>
    node(`m-${index}`, index ? `m-${index - 1}` : null),
  )
  for (const selected of [0, 50000, 99999]) {
    const start = archiveTimelineWindowStart(nodes.length, selected)
    const visible = nodes.slice(start, start + ARCHIVE_TIMELINE_WINDOW_SIZE)
    expect(visible).toHaveLength(160)
    expect(visible.some((item) => item.id === `m-${selected}`)).toBe(true)
    const graph = archiveTimelineLayout(visible)
    expect(graph.points).toHaveLength(160)
    expect(graph.edges).toHaveLength(159)
  }
  expect(archiveTimelineWindowStart(0, 0)).toBe(0)
  expect(archiveTimelineWindowStart(12, 11)).toBe(0)
})
