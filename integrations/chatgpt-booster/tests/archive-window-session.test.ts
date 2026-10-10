import { expect, test } from 'bun:test'
import { useArchiveWindowSession } from '../packages/ui/src/archive-window-session'
import type { ArchiveThreadWindow } from '../packages/ui/src/mount'

test('saved inspection pins account and revision, and later updates only its own locator', () => {
  const reader = useArchiveWindowSession()
  reader.useSavedLocation({
    source: 'saved',
    accountId: 'account-a',
    conversationId: 'chat-a',
    messageId: 'message-a',
    sourceRevision: 8,
    sourceInstanceId: 'instance-a',
  })
  const first = reader.windowRequest(new AbortController())
  expect(first).toMatchObject({
    source: 'saved',
    expectedAccountId: 'account-a',
    expectedRevision: 8,
    expectedInstanceId: 'instance-a',
  })
  const resetPin = reader.windowRequest(new AbortController(), false)
  expect(resetPin.expectedRevision).toBeUndefined()
  const windowData: ArchiveThreadWindow = {
    thread: { turns: [], messageCount: 0, recordCount: 0, detailCount: 0 },
    olderCursor: null,
    newerCursor: null,
    hasOlderStored: true,
    hasNewerStored: false,
    loadedRecordCount: 0,
    totalKnownRecordCount: 25,
    hasUnsequencedRecords: true,
    source: 'saved',
    accountId: 'account-a',
    sourceRevision: 9,
    sourceInstanceId: 'instance-a',
  }
  reader.acceptWindow(windowData)
  expect(reader.requestedLocation.value?.sourceRevision).toBe(9)
  expect(reader.windowRequest(new AbortController()).expectedRevision).toBe(9)
  reader.acceptWindow({ ...windowData, accountId: 'account-b', sourceRevision: 12 })
  expect(reader.requestedLocation.value?.sourceRevision).toBe(9)
  expect(reader.knownStoredCount.value).toBe(25)
  reader.clearWindow()
  expect(reader.knownStoredCount.value).toBe(0)
  expect(reader.hasOlderStored.value).toBe(false)
  reader.resetSource()
  expect(reader.windowRequest(new AbortController()).source).toBe('auto')
  expect(reader.windowRequest(new AbortController()).expectedAccountId).toBeUndefined()
})
