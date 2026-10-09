import { expect, test } from 'bun:test'
import { readPinnedSnapshot, verifyPinnedResult } from './pinned-read'

test('publishes a page only when an independently reread durable revision is unchanged', async () => {
  let stamps = 0
  const result = await readPinnedSnapshot({
    readStamp: async () => {
      stamps++
      return { revision: 17, instance: 'original' }
    },
    read: async (initial) => {
      expect(initial.revision).toBe(17)
      return ['old-message', 'new-message']
    },
    sameStamp: (a, b) => a.revision === b.revision && a.instance === b.instance,
  })
  expect(result.result).toEqual(['old-message', 'new-message'])
  expect(stamps).toBe(2)
})

test('detects changed snapshot including delete-and-recreate at the same revision', async () => {
  const stamps = [
    { revision: 4, instance: 'before' },
    { revision: 4, instance: 'after' },
  ]
  let reads = 0
  let evicted = 0
  await expect(
    readPinnedSnapshot({
      readStamp: async () => stamps[Math.min(reads++, 1)],
      read: async () => ['message'],
      sameStamp: (a, b) => a?.revision === b?.revision && a?.instance === b?.instance,
      onConflict: () => {
        evicted++
      },
      conflictError: () => Error('archive.error.sourceChanged'),
    }),
  ).rejects.toThrow('archive.error.sourceChanged')
  expect(evicted).toBe(1)
})

test('checks source pin before reading and cancels without publishing after a concurrent abort', async () => {
  let pageReads = 0
  await expect(
    readPinnedSnapshot({
      readStamp: async () => ({ revision: 9 }),
      acceptStamp: (stamp) => {
        if (stamp.revision !== 8) throw Error('stale requested revision')
      },
      read: async () => {
        pageReads++
        return []
      },
      sameStamp: (a, b) => a.revision === b.revision,
    }),
  ).rejects.toThrow('stale requested revision')
  expect(pageReads).toBe(0)

  const controller = new AbortController()
  let readStamps = 0
  await expect(
    readPinnedSnapshot({
      signal: controller.signal,
      readStamp: async () => {
        readStamps++
        return { revision: 1 }
      },
      read: async () => {
        controller.abort()
        return ['discarded']
      },
      sameStamp: (a, b) => a.revision === b.revision,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(readStamps).toBe(1)
})

test('account epoch guard rejects stale operations even when versions are equal', async () => {
  let epoch = 1
  await expect(
    readPinnedSnapshot({
      assertCurrent: () => {
        if (epoch !== 1) throw Error('archive.error.auth')
      },
      readStamp: async () => ({ revision: 1 }),
      read: async () => {
        epoch = 2
        return ['secret']
      },
      sameStamp: (a, b) => a.revision === b.revision,
    }),
  ).rejects.toThrow('archive.error.auth')
})

test('transaction-stamped result is checked against a fresh source header without a second initial read', async () => {
  let fetched = 0
  const stamped = { revision: 22, instanceId: 'same' }
  const verified = await verifyPinnedResult({
    stamp: stamped,
    result: ['message-a'],
    readStamp: async () => {
      fetched++
      return { revision: 22, instanceId: 'same' }
    },
    sameStamp: (before, after) =>
      before.revision === after.revision && before.instanceId === after.instanceId,
  })
  expect(verified.result).toEqual(['message-a'])
  expect(fetched).toBe(1)
  await expect(
    verifyPinnedResult({
      stamp: stamped,
      result: ['unpublished-message'],
      readStamp: async () => {
        fetched++
        return { revision: 22, instanceId: 'recreated' }
      },
      sameStamp: (before, after) =>
        before.revision === after.revision && before.instanceId === after.instanceId,
      conflictError: () => new Error('archive.error.sourceChanged'),
    }),
  ).rejects.toThrow('archive.error.sourceChanged')
  expect(fetched).toBe(2)
})
