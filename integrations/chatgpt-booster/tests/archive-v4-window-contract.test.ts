import { describe, expect, test } from 'bun:test'
import { ArchiveCollectionSession } from '../packages/features/src/archive-collection-session'
import { ArchiveV4CaptureModule } from '../packages/features/src/archive-v4-capture'
import { ArchiveV4Reader } from '../packages/features/src/archive-v4-reader'
import type {
  ArchiveV4Conversation,
  ArchiveV4Message,
  ArchiveV4Store,
} from '../packages/features/src/archive-v4-store'
import { ArchiveSourceWriteRegistry } from '../packages/features/src/archive-v4-write'
import { normalizeConversationMessage } from '../packages/features/src/conversation-records'
import type { ConversationStateStore } from '../packages/features/src/conversation-state'

function record(id: string, timestamp: number): ArchiveV4Message {
  return {
    key: id,
    conversationKey: 'acct/chat',
    messageId: id,
    parentId: null,
    parentKnown: true,
    sourceCreateTime: timestamp,
    firstSeenAt: 1,
    lastSeenAt: 1,
    revision: 1,
    raw: {
      id,
      create_time: timestamp,
      update_time: null,
      author: { role: 'user' },
      content: { content_type: 'text', parts: [id] },
      metadata: { parent_id: null },
      status: 'finished_successfully',
      channel: null,
      recipient: 'all',
      end_turn: true,
    },
  }
}
const messages = [record('m3', 300), record('m2', 200), record('m1', 100)]

function readerHarness(rows: ArchiveV4Message[] = messages) {
  let revision = 1
  let account = 'acct'
  let accountEpoch = 1
  let afterRead: (() => void | Promise<void>) | undefined
  const store = {
    async getConversation(_owner: string, id: string) {
      return {
        conversationId: id,
        revision,
        knownMessageCount: rows.length,
        unsequencedMessageCount: 0,
        currentNodeId: rows[0]?.messageId ?? null,
        projectId: null,
      } as ArchiveV4Conversation
    },
    async readWindow(
      _owner: string,
      _id: string,
      limit: number,
      direction: string,
      cursor?: { messageId: string },
    ) {
      const ordered = direction === 'oldest' ? [...rows].reverse() : rows
      const start = cursor
        ? ordered.findIndex((item) => item.messageId === cursor.messageId) + 1
        : 0
      const result = ordered.slice(start, start + limit)
      const callback = afterRead
      afterRead = undefined
      await callback?.()
      return result
    },
  } as unknown as ArchiveV4Store
  const memory = {
    verifiedAccountId: () => account,
    accountEpoch: () => accountEpoch,
    listMessages: () => [],
  } as unknown as ConversationStateStore
  return {
    reader: new ArchiveV4Reader(store, memory, () => null),
    updateRevision: () => {
      revision += 1
    },
    changeAccount: () => {
      account = 'other'
      accountEpoch += 1
    },
    afterPage: (callback: () => void | Promise<void>) => {
      afterRead = callback
    },
  }
}

describe('v4 saved window source revision', () => {
  test('returns bounded ordered windows under unchanged revision', async () => {
    const { reader } = readerHarness()
    const initial = await reader.readThreadWindow('acct', 'chat', null, 2)
    expect(initial.loadedRecordCount).toBe(2)
    expect(initial.hasOlderStored).toBe(true)
    expect(initial.olderCursor?.messageId).toBe('m2')
    const older = await reader.readThreadWindow('acct', 'chat', initial.olderCursor, 2)
    expect(older.loadedRecordCount).toBe(3)
    expect(older.hasOlderStored).toBe(false)
    expect(older.thread.recordCount).toBe(3)
  })

  test('rejects revision drift between IndexedDB header and cursor read', async () => {
    const harness = readerHarness()
    harness.afterPage(harness.updateRevision)
    await expect(harness.reader.readThreadWindow('acct', 'chat', null, 2)).rejects.toThrow(
      'archive.error.sourceChanged',
    )
    const retry = await harness.reader.readThreadWindow('acct', 'chat', null, 2)
    expect(retry.olderCursor?.messageId).toBe('m2')
  })

  test('never mixes an older cursor with a newer revision from another tab', async () => {
    const harness = readerHarness()
    const first = await harness.reader.readThreadWindow('acct', 'chat', null, 2)
    harness.updateRevision()
    await expect(
      harness.reader.readThreadWindow('acct', 'chat', first.olderCursor, 2),
    ).rejects.toThrow('archive.error.sourceChanged')
    const refreshed = await harness.reader.readThreadWindow('acct', 'chat', null, 2)
    expect(refreshed.loadedRecordCount).toBe(2)
  })

  test('caps retained saved rows without losing the older cursor, then restores latest', async () => {
    const rows = Array.from({ length: 360 }, (_, index) => {
      const timestamp = 360 - index
      return record(`m${timestamp}`, timestamp)
    })
    const { reader } = readerHarness(rows)
    let result = await reader.readThreadWindow('acct', 'chat', null, 40)
    expect(result.hasNewerStored).toBe(false)
    const cursors = new Set<string>()
    while (result.hasOlderStored) {
      const cursor = result.olderCursor
      expect(cursor).not.toBeNull()
      if (!cursor) break
      expect(cursors.has(cursor.messageId)).toBe(false)
      cursors.add(cursor.messageId)
      result = await reader.readThreadWindow('acct', 'chat', cursor, 40)
      expect(result.loadedRecordCount).toBeLessThanOrEqual(ArchiveV4Reader.MAX_WINDOW_RECORDS)
      expect(result.thread.recordCount).toBe(result.loadedRecordCount)
    }
    expect(cursors.size).toBe(8)
    expect(result.loadedRecordCount).toBe(ArchiveV4Reader.MAX_WINDOW_RECORDS)
    expect(result.hasNewerStored).toBe(true)
    expect(result.hasOlderStored).toBe(false)
    const currentlyLoaded = result.thread.turns.flatMap((turn) => turn.messages)
    expect(currentlyLoaded.some((item) => item.record.messageId === 'm1')).toBe(true)
    expect(currentlyLoaded.some((item) => item.record.messageId === 'm360')).toBe(false)
    const latest = await reader.readThreadWindow('acct', 'chat', null, 40)
    expect(latest.loadedRecordCount).toBe(40)
    expect(latest.hasNewerStored).toBe(false)
    expect(latest.olderCursor?.messageId).toBe('m321')
  })

  test('opens the first known saved window and advances toward latest without loading all records', async () => {
    const rows = Array.from({ length: 360 }, (_, i) => {
      const timestamp = 360 - i
      return record(`m${timestamp}`, timestamp)
    })
    const { reader } = readerHarness(rows)
    let window = await reader.readThreadWindow('acct', 'chat', null, 40, 'first')
    expect(window.loadedRecordCount).toBe(40)
    expect(window.hasOlderStored).toBe(false)
    expect(window.olderCursor).toBeNull()
    expect(window.newerCursor?.messageId).toBe('m40')
    expect(
      window.thread.turns.some((turn) => turn.messages.some((m) => m.record.messageId === 'm1')),
    ).toBe(true)
    let pageCount = 0
    while (window.hasNewerStored) {
      const after = window.newerCursor
      expect(after).not.toBeNull()
      if (!after) break
      window = await reader.readThreadWindow('acct', 'chat', after, 40, 'newer')
      expect(window.loadedRecordCount).toBeLessThanOrEqual(ArchiveV4Reader.MAX_WINDOW_RECORDS)
      pageCount++
    }
    expect(pageCount).toBe(8)
    expect(window.loadedRecordCount).toBe(ArchiveV4Reader.MAX_WINDOW_RECORDS)
    expect(window.hasOlderStored).toBe(true)
    expect(window.hasNewerStored).toBe(false)
    expect(
      window.thread.turns.some((turn) => turn.messages.some((m) => m.record.messageId === 'm360')),
    ).toBe(true)
    const earlier = await reader.readThreadWindow('acct', 'chat', window.olderCursor, 40, 'older')
    expect(earlier.loadedRecordCount).toBe(ArchiveV4Reader.MAX_WINDOW_RECORDS)
    expect(earlier.hasNewerStored).toBe(true)
    expect(earlier.newerCursor?.messageId).toBe('m320')
    const latest = await reader.readThreadWindow('acct', 'chat', null, 40)
    expect(latest.hasNewerStored).toBe(false)
    expect(latest.olderCursor?.messageId).toBe('m321')
  })

  test('rejects changed saved revision when advancing from the first known window', async () => {
    const harness = readerHarness()
    const first = await harness.reader.readThreadWindow('acct', 'chat', null, 1, 'first')
    expect(first.newerCursor?.messageId).toBe('m1')
    harness.updateRevision()
    await expect(
      harness.reader.readThreadWindow('acct', 'chat', first.newerCursor, 1, 'newer'),
    ).rejects.toThrow('archive.error.sourceChanged')
  })

  test('supersedes a slow older read when the reader switches to first known', async () => {
    const harness = readerHarness()
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = new Promise<void>((resolve) => {
      entered = resolve
    })
    harness.afterPage(() => {
      entered?.()
      return gate
    })
    const stale = harness.reader.readThreadWindow('acct', 'chat', null, 2)
    await pending
    const first = await harness.reader.readThreadWindow('acct', 'chat', null, 2, 'first')
    expect(first.newerCursor?.messageId).toBe('m2')
    release?.()
    await expect(stale).rejects.toThrow('archive.error.sourceChanged')
    const later = await harness.reader.readThreadWindow(
      'acct',
      'chat',
      first.newerCursor,
      2,
      'newer',
    )
    expect(later.loadedRecordCount).toBe(3)
    expect(later.hasNewerStored).toBe(false)
  })

  test('keeps first/newer windows of the active chat RAM-first with no IndexedDB access', async () => {
    const live = [record('m1', 100), record('m2', 200), record('m3', 300)]
      .map((item) => normalizeConversationMessage(item.raw, 'chat', null, 1))
      .filter((item) => item !== null)
    const store = {
      async getConversation() {
        throw new Error('Unexpected IndexedDB access')
      },
      async readWindow() {
        throw new Error('Unexpected IndexedDB access')
      },
    } as unknown as ArchiveV4Store
    const memory = {
      verifiedAccountId: () => 'acct',
      accountEpoch: () => 1,
      listMessages: () => live,
    } as unknown as ConversationStateStore
    const reader = new ArchiveV4Reader(store, memory, () => 'chat')
    const first = await reader.readThreadWindow('acct', 'chat', null, 1, 'first')
    expect(first.thread.recordCount).toBe(1)
    expect(first.newerCursor?.messageId).toBe('m1')
    const later = await reader.readThreadWindow('acct', 'chat', first.newerCursor, 2, 'newer')
    expect(later.thread.recordCount).toBe(3)
    expect(later.hasNewerStored).toBe(false)
  })

  test('never returns data after verified owner changes during the read', async () => {
    const harness = readerHarness()
    harness.afterPage(harness.changeAccount)
    await expect(harness.reader.readThreadWindow('acct', 'chat', null, 2)).rejects.toThrow(
      'archive.error.auth',
    )
  })
})

describe('v4 account cleanup authorization', () => {
  test('coalesces overlapping account deletion and releases the barrier after settlement', async () => {
    let finish: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => {
      finish = resolve
    })
    let invocations = 0
    const store = {
      async clearAccount(accountId: string, authorized: () => boolean, signal?: AbortSignal) {
        invocations++
        expect(accountId).toBe('acct')
        await waiting
        if (!authorized() || signal?.aborted) throw new Error('archive.error.auth')
      },
    } as unknown as ArchiveV4Store
    const memory = { verifiedAccountId: () => 'acct' } as unknown as ConversationStateStore
    const settings = {} as ConstructorParameters<typeof ArchiveV4CaptureModule>[2]
    const capture = new ArchiveV4CaptureModule(
      store,
      memory,
      settings,
      new ArchiveCollectionSession(),
    )
    const first = capture.clearSavedAccount('acct')
    const repeated = capture.clearSavedAccount('acct')
    await Promise.resolve()
    expect(invocations).toBe(1)
    finish()
    await Promise.all([first, repeated])
    await capture.clearSavedAccount('acct')
    expect(invocations).toBe(2)
    await expect(capture.clearSavedAccount('another-account')).rejects.toThrow('archive.error.auth')
  })
})

describe('v4 scoped capture cancellation', () => {
  test('releases idle source controllers without losing concurrent revocation', () => {
    const sources = new ArchiveSourceWriteRegistry()
    const first = sources.acquire('conversation')
    const concurrent = sources.acquire('conversation')
    const unrelated = sources.acquire('elsewhere')
    expect(sources.activeSources).toBe(2)
    first.release()
    expect(sources.activeSources).toBe(2)
    sources.revoke('conversation')
    expect(first.signal.aborted).toBe(true)
    expect(concurrent.signal.aborted).toBe(true)
    expect(unrelated.signal.aborted).toBe(false)
    concurrent.release()
    expect(sources.activeSources).toBe(1)
    unrelated.release()
    expect(sources.activeSources).toBe(0)
    const renewed = sources.acquire('conversation')
    expect(renewed.signal.aborted).toBe(false)
    sources.clear()
    expect(renewed.signal.aborted).toBe(true)
    renewed.release() // Releasing an obsolete lease cannot affect a new map entry.
    const next = sources.acquire('conversation')
    expect(sources.activeSources).toBe(1)
    next.release()
    expect(sources.activeSources).toBe(0)
  })
})
