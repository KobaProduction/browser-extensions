import { expect, test } from 'bun:test'
import { type LinearArchiveCommit, scanLinearArchive } from './index'

type Message = { id: string; time: number }
const messages: Message[] = [
  { id: '4', time: 4 },
  { id: '3', time: 3 },
  { id: '2', time: 2 },
  { id: '1', time: 1 },
]
const keyOf = (m: Message) => m.id
const initial = { offset: 0, matched: 0, scanned: 0, newCount: 0 }

test('scans exact N across pages, checkpoints before subsequent requests', async () => {
  const knownKeys = new Set(['4'])
  let persistedOffset = 0
  const commits: LinearArchiveCommit<Message>[] = []
  const result = await scanLinearArchive({
    mode: 'recent',
    target: 3,
    pageSize: 2,
    initial,
    knownKeys,
    keyOf,
    source: {
      async readPage(offset, count) {
        expect(offset).toBe(persistedOffset)
        return { items: messages.slice(offset, offset + count), count: messages.length }
      },
    },
    async commit(page) {
      commits.push(page)
      persistedOffset = page.next.offset
    },
    stopped: () => false,
  })
  expect(commits.map((p) => p.next.offset)).toEqual([2, 3])
  expect(commits.map((p) => p.selection.added.map((m) => m.id))).toEqual([['3'], ['2']])
  expect(result.state).toEqual({ offset: 3, matched: 3, scanned: 3, newCount: 2 })
  expect(result.exhausted).toBe(true)
  expect([...knownKeys].sort()).toEqual(['2', '3', '4'])
})

test('a failed durable commit does not mark new IDs or request the next page', async () => {
  const knownKeys = new Set<string>(),
    reads: number[] = []
  await expect(
    scanLinearArchive({
      mode: 'recent',
      target: 3,
      pageSize: 2,
      initial,
      knownKeys,
      keyOf,
      source: {
        async readPage(offset, count) {
          reads.push(offset)
          return { items: messages.slice(offset, offset + count), count: 4 }
        },
      },
      async commit() {
        throw new Error('disk full')
      },
      stopped: () => false,
    }),
  ).rejects.toThrow('disk full')
  expect(reads).toEqual([0])
  expect(knownKeys.size).toBe(0)
})

test('pauses between acknowledged pages and resumes from returned cursor', async () => {
  let stopped = false
  const committed: Message[] = []
  const knownKeys = new Set<string>()
  const opts = {
    mode: 'backfill' as const,
    target: 3,
    pageSize: 2,
    initial,
    knownKeys,
    keyOf,
    source: {
      async readPage(offset: number, count: number) {
        return { items: messages.slice(offset, offset + count), count: 4 }
      },
    },
    async commit(page: LinearArchiveCommit<Message>) {
      committed.push(...page.selection.added)
      stopped = true
    },
    stopped: () => stopped,
  }
  const paused = await scanLinearArchive(opts)
  expect(paused.paused).toBe(true)
  expect(paused.state.offset).toBe(2)
  stopped = false
  const finished = await scanLinearArchive({
    ...opts,
    initial: paused.state,
    async commit(page) {
      committed.push(...page.selection.added)
    },
  })
  expect(finished.state.matched).toBe(3)
  expect(committed.map((m) => m.id)).toEqual(['4', '3', '2'])
})
