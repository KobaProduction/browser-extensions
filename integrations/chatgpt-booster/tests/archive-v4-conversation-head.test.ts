import { expect, test } from 'bun:test'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import { reconcileArchiveConversationHead } from '../packages/features/src/archive-v4-conversation-head'

function source(id: string, title: string): ConversationArchiveEventDetail {
  return {
    readId: id,
    conversationId: 'chat',
    accountId: 'account',
    isInitial: true,
    payload: { title, current_node: 'tip-' + id, gizmo_id: null },
  } as unknown as ConversationArchiveEventDetail
}
const common = {
  accountId: 'account',
  conversationKey: '["account","chat"]',
  projectId: null,
  observedAt: 100,
}

test('new initial native read establishes the selected head and read evidence', () => {
  const first = reconcileArchiveConversationHead({
    ...common,
    previousConversation: undefined,
    previousPage: undefined,
    detail: source('read-1', 'Initial title'),
    readId: 'read-1',
    readStartedAt: 10,
  })
  expect(first).toMatchObject({
    currentNodeId: 'tip-read-1',
    title: 'Initial title',
    latestReadId: 'read-1',
    headReadId: 'read-1',
    knownMessageCount: 0,
    revision: 0,
  })
  const changed = reconcileArchiveConversationHead({
    ...common,
    previousConversation: first,
    previousPage: undefined,
    detail: source('read-2', 'Updated title'),
    readId: 'read-2',
    readStartedAt: 11,
  })
  expect(changed).toMatchObject({ title: 'Updated title', currentNodeId: 'tip-read-2' })
  expect(first.title).toBe('Initial title')
})

test('old or conflicting native heads cannot silently overwrite later read state', () => {
  const first = reconcileArchiveConversationHead({
    ...common,
    previousConversation: undefined,
    previousPage: undefined,
    detail: source('read-latest', 'Latest'),
    readId: 'read-latest',
    readStartedAt: 100,
  })
  const older = reconcileArchiveConversationHead({
    ...common,
    previousConversation: first,
    previousPage: undefined,
    detail: source('read-old', 'Stale'),
    readId: 'read-old',
    readStartedAt: 90,
  })
  expect(older.title).toBe('Latest')
  expect(older.headReadId).toBe('read-latest')
  const conflict = reconcileArchiveConversationHead({
    ...common,
    previousConversation: first,
    previousPage: undefined,
    detail: source('other-read', 'Conflict'),
    readId: 'other-read',
    readStartedAt: 100,
  })
  expect(conflict.latestReadConflicted).toBe(true)
  expect(conflict.currentNodeId).toBe('tip-read-latest')
})
