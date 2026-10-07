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
