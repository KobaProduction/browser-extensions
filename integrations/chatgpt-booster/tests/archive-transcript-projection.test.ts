import { expect, test } from 'bun:test'
import type { ArchiveItemView, ArchiveTurnView } from '@chatgpt-booster/core'
import { projectArchiveTranscript } from '../packages/ui/src/archive-transcript-adapter'

const item = (id: string, kind: ArchiveItemView['kind']): ArchiveItemView => ({
  kind,
  text: id,
  record: {
    messageKey: id,
    messageId: id,
    conversationId: 'conversation',
    role: kind === 'user' ? 'user' : 'assistant',
    channel: null,
    contentType: null,
    messageType: null,
    recipient: null,
    status: null,
    modelSlug: null,
    parentId: null,
    turnExchangeId: null,
    createTime: null,
    raw: {},
  },
  metadata: { sentAt: null, editedAt: null, edited: false, model: null, thinking: null },
})
test('archive transcript projection preserves user/details/reply layout and anchored message keys', () => {
  const user = item('user-1', 'user'),
    answer = item('answer-1', 'answer')
  const reasoning = item('reasoning-1', 'reasoning')
  const turns: ArchiveTurnView[] = [
    { id: 'turn-a', association: 'parent', messages: [user, answer], details: [reasoning] },
    { id: 'turn-b', association: 'unassigned', messages: [item('orphan', 'answer')], details: [] },
  ]
  const result = projectArchiveTranscript(turns)
  expect(result.turns.map((turn) => turn.association)).toEqual(['linked', 'unassigned'])
  expect(result.turns[0]?.users.map((record) => record.key)).toEqual(['user-1'])
  expect(result.turns[0]?.details.map((record) => record.key)).toEqual(['reasoning-1'])
  expect(result.turns[0]?.replies.map((record) => record.key)).toEqual(['answer-1'])
  expect(result.byKey.get('reasoning-1')).toBe(reasoning)
  expect(turns[0]?.messages).toEqual([user, answer])
})
