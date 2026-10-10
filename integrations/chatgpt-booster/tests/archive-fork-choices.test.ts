import { describe, expect, test } from 'bun:test'
import type { ArchiveItemView, ArchiveThreadView } from '../packages/core/src/archive'
import { archiveForkChoices } from '../packages/ui/src/archive-fork-choices'

function user(id: string, parent: string | null): ArchiveItemView {
  return {
    kind: 'user',
    text: id,
    metadata: { sentAt: null, editedAt: null, edited: false, model: null, thinking: null },
    record: {
      messageKey: id,
      messageId: id,
      parentId: parent,
      conversationId: 'fixture',
      role: 'user',
      channel: null,
      contentType: null,
      messageType: null,
      recipient: null,
      status: null,
      modelSlug: null,
      turnExchangeId: null,
      createTime: 100,
      raw: {},
    },
  }
}
function thread(items: ArchiveItemView[]): ArchiveThreadView {
  return {
    turns: [{ id: 'test', association: 'parent', messages: items, details: [] }],
    messageCount: items.length,
    recordCount: items.length,
    detailCount: 0,
  }
}
describe('read-only fork choices', () => {
  test('shows two independent edited-user fork groups', () => {
    const choices = archiveForkChoices(
      thread([user('u2', 'a1'), user('u2-edit', 'a1'), user('u3', 'a2'), user('u3-edit', 'a2')]),
    )
    expect(choices.map((group) => group.variants.map((v) => v.messageId))).toEqual([
      ['u2', 'u2-edit'],
      ['u3', 'u3-edit'],
    ])
  })
  test('does not create variants from missing parent metadata or a lone child', () => {
    expect(archiveForkChoices(thread([user('first', null), user('second', 'first')]))).toEqual([])
  })
  test('duplicate records are not duplicate branch variants', () => {
    expect(
      archiveForkChoices(thread([user('u', 'a'), user('u', 'a'), user('v', 'a')]))[0]?.variants,
    ).toHaveLength(2)
  })
})
