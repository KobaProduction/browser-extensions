import { describe, expect, test } from 'bun:test'
import type { ArchiveItemView, ArchiveThreadView } from '../packages/core/src/archive'
import { archiveMessageGraph } from '../packages/ui/src/archive-message-graph'

function item(
  id: string,
  parentId: string | null,
  kind: 'user' | 'answer' = 'user',
): ArchiveItemView {
  return {
    kind,
    text: id,
    metadata: { sentAt: null, editedAt: null, edited: false, model: null, thinking: null },
    record: {
      messageKey: id,
      messageId: id,
      conversationId: 'test',
      role: kind === 'user' ? 'user' : 'assistant',
      channel: null,
      contentType: null,
      messageType: null,
      recipient: null,
      status: null,
      modelSlug: null,
      parentId,
      turnExchangeId: null,
      createTime: null,
      raw: {},
    },
  }
}
function graph(items: ArchiveItemView[]) {
  const thread: ArchiveThreadView = {
    turns: [{ id: 't', association: 'parent', messages: items, details: [] }],
    messageCount: items.length,
    recordCount: items.length,
    detailCount: 0,
  }
  return archiveMessageGraph(thread)
}
describe('read-only message graph', () => {
  test('edited third message becomes sibling with known common parent', () => {
    const g = graph([
      item('u2', null),
      item('a2', 'u2', 'answer'),
      item('u3', 'a2'),
      item('a3', 'u3', 'answer'),
      item('u4', 'a3'),
      item('u3-edited', 'a2'),
      item('a3-edited', 'u3-edited', 'answer'),
    ])
    expect(g.get('u3')).toMatchObject({
      siblingCount: 2,
      siblingIndex: 0,
      parentKnown: true,
      lane: 0,
    })
    expect(g.get('u3-edited')).toMatchObject({
      siblingCount: 2,
      siblingIndex: 1,
      parentKnown: true,
      lane: 1,
    })
    expect(g.get('u4')?.lane).toBe(0)
    expect(g.get('a3-edited')?.lane).toBe(1)
  })
  test('unknown parents are not inferred and do not create fake forks', () => {
    const g = graph([item('a', 'missing'), item('b', null), item('c', 'other')])
    expect(g.get('a')).toMatchObject({ parentKnown: false, siblingCount: 1 })
    expect(g.get('b')).toMatchObject({ parentKnown: false, siblingCount: 1 })
  })
  test('cyclic metadata is bounded and nodes are not dropped', () => {
    const g = graph([item('a', 'b'), item('b', 'a')])
    expect([...g.keys()]).toEqual(['a', 'b'])
    expect(g.get('a')?.lane).toBeLessThanOrEqual(3)
  })
  test('assistant messages have their own graph nodes', () => {
    const g = graph([item('user', null), item('agent', 'user', 'answer')])
    expect(g.get('agent')?.kind).toBe('assistant')
  })
})

describe('long parent chains', () => {
  test('handles thousands of linked messages without recursive stack overflow', () => {
    const entries = Array.from({ length: 12000 }, (_, i) => {
      const id = `chain-${i}`
      const parentId = i ? `chain-${i - 1}` : null
      return {
        kind: i % 2 ? 'answer' : 'user',
        text: id,
        record: {
          messageId: id,
          messageKey: id,
          conversationId: 'chain',
          parentId,
          role: i % 2 ? 'assistant' : 'user',
        },
      }
    })
    const thread = {
      turns: [{ id: 'long', messages: entries, details: [], association: 'parent' }],
      messageCount: entries.length,
      recordCount: entries.length,
      detailCount: 0,
    } as unknown as import('../packages/core/src/archive').ArchiveThreadView
    const result = archiveMessageGraph(thread)
    expect(result.size).toBe(entries.length)
    expect(result.get('chain-11999')?.lane).toBe(0)
  })
})
