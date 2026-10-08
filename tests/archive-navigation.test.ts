import { describe, expect, test } from 'bun:test'
import { archiveConversationForest, archiveTurnWindow } from '../packages/ui/src/archive-navigation'
import {
  omitRepeatedRecordHeading,
  parseArchiveStructuredText,
} from '../packages/ui/src/archive-presentation'
import type { ArchiveConversationView } from '../packages/ui/src/mount'

function chat(id: string, parent: string | null = null): ArchiveConversationView {
  return {
    conversationId: id,
    projectId: 'project',
    title: id,
    branchSourceConversationId: parent,
    branchSourceTitle: null,
    updatedAt: null,
    lastSeenAt: 0,
    archiveState: 'complete',
  }
}

describe('archive branch forest', () => {
  test('shows trunk, branch and nested branch without losing project order', () => {
    const rows = archiveConversationForest([
      chat('trunk'),
      chat('unrelated'),
      chat('branch', 'trunk'),
      chat('nested', 'branch'),
    ])
    expect(rows.map((row) => [row.conversation.conversationId, row.depth])).toEqual([
      ['trunk', 0],
      ['branch', 1],
      ['nested', 2],
      ['unrelated', 0],
    ])
  })

  test('search matches a descendant while retaining ancestors and excluding siblings', () => {
    const rows = archiveConversationForest(
      [chat('root'), chat('branch', 'root'), chat('needle', 'branch'), chat('sibling', 'root')],
      'needle',
    )
    expect(rows.map((row) => row.conversation.conversationId)).toEqual(['root', 'branch', 'needle'])
  })

  test('keeps orphan branches visible and flags unknown sources', () => {
    const rows = archiveConversationForest([chat('orphan', 'not-in-this-project')])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ depth: 0, branched: true, sourceMissing: true })
  })

  test('terminates malformed cycles without dropping or repeating conversations', () => {
    const rows = archiveConversationForest([
      chat('a', 'b'),
      chat('b', 'a'),
      chat('self', 'self'),
      chat('root'),
    ])
    expect(new Set(rows.map((row) => row.conversation.conversationId)).size).toBe(4)
    expect(rows).toHaveLength(4)
  })

  test('project-label search retains the entire group', () => {
    const rows = archiveConversationForest([chat('a'), chat('b', 'a')], 'koba', 'Koba Project')
    expect(rows).toHaveLength(2)
  })
})

describe('latest-first reading window', () => {
  const all = Array.from({ length: 100 }, (_, index) => index)
  test('chronological view opens on the last 40 exchanges in their original order', () => {
    expect(archiveTurnWindow(all, 40, 'chronological')).toEqual(all.slice(60))
  })
  test('reverse order shows the latest exchange first without mutating the model', () => {
    expect(archiveTurnWindow(all, 40, 'newest-first')).toEqual(all.slice(60).reverse())
    expect(all[0]).toBe(0)
  })
  test('incremental loading extends the older edge and never skips messages', () => {
    const window = archiveTurnWindow(all, 80, 'chronological')
    expect(window).toHaveLength(80)
    expect(window[0]).toBe(20)
    expect(window.at(-1)).toBe(99)
    expect(archiveTurnWindow(all, 200, 'newest-first')).toHaveLength(100)
  })
})

describe('record presentation is a lossless projection', () => {
  test('removes only an identical repeated heading', () => {
    expect(omitRepeatedRecordHeading('Tool call\nActual data', 'Tool call')).toBe('Actual data')
    expect(omitRepeatedRecordHeading('Tool call', 'Tool call')).toBe('')
    expect(omitRepeatedRecordHeading('Actual tool call information', 'Tool call')).toBe(
      'Actual tool call information',
    )
  })
  test('separates encoded tool payload from readable text without guessing', () => {
    expect(parseArchiveStructuredText('{"status":"ok"}')).toEqual({ status: 'ok' })
    expect(parseArchiveStructuredText('plain result')).toBeNull()
  })
})

describe('bounded archive navigator', () => {
  test('retains earliest, newest, and all forks while sampling long dialogs', async () => {
    const { archiveNavigatorSample } = await import('../packages/ui/src/archive-navigation')
    const nodes = Array.from({ length: 2000 }, (_, i) => i)
    const result = archiveNavigatorSample(nodes, (i) => i === 450 || i === 900, 120)
    expect(result.length).toBeLessThanOrEqual(120)
    expect(result[0]?.item).toBe(0)
    expect(result.at(-1)?.item).toBe(1999)
    expect(result.some((x) => x.item === 450)).toBe(true)
    expect(result.some((x) => x.item === 900)).toBe(true)
  })
})

describe('fisheye timeline', () => {
  test('keeps endpoints and current checkpoint anchored', async () => {
    const { archiveTimelinePosition } = await import('../packages/ui/src/archive-navigation')
    expect(archiveTimelinePosition(0, 0.5)).toBe(0)
    expect(archiveTimelinePosition(1, 0.5)).toBe(1)
    expect(archiveTimelinePosition(0.5, 0.5)).toBe(0.5)
    expect(archiveTimelinePosition(0.25, 0.5)).toBeLessThan(0.25)
    expect(archiveTimelinePosition(0.75, 0.5)).toBeGreaterThan(0.75)
  })
})

describe('message fork checkpoint connectors', () => {
  test('retains both forks and skips no known parents', async () => {
    const { archiveNavigatorEdges } = await import('../packages/ui/src/archive-navigation')
    const parents = new Map<string, string | null>([
      ['root', null],
      ['user-old', 'root'],
      ['answer-old', 'user-old'],
      ['user-edit', 'root'],
      ['answer-edit', 'user-edit'],
      ['orphan', 'missing'],
    ])
    expect(
      archiveNavigatorEdges(parents, [
        { id: 'root', index: 0 },
        { id: 'answer-old', index: 3 },
        { id: 'answer-edit', index: 5 },
        { id: 'orphan', index: 6 },
      ]),
    ).toEqual([
      { from: 0, to: 3 },
      { from: 0, to: 5 },
    ])
  })
  test('missing intermediate ancestors do not form invented links', async () => {
    const { archiveNavigatorEdges } = await import('../packages/ui/src/archive-navigation')
    const parents = new Map([
      ['a', null],
      ['c', 'b'],
    ] as [string, string | null][])
    expect(
      archiveNavigatorEdges(parents, [
        { id: 'a', index: 0 },
        { id: 'c', index: 2 },
      ]),
    ).toEqual([])
  })
})
