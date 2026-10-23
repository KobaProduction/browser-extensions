import { expect, test } from 'bun:test'
import type { ConversationStateStore } from './conversation-state'
import { createNativeHistoryReader, nativePaginationPending } from './native-history-reader'

function fixture() {
  const accountToken = {},
    userToken = {},
    controller = new AbortController()
  let owner = 'owner',
    epoch = 1,
    active = true,
    calls = 0
  const scope = {
    scope: {},
    node: { token: {} },
    get: (token: unknown) => (token === accountToken ? owner : 'user'),
  }
  const state = {
    verifiedAccountId: () => owner,
    accountEpoch: () => epoch,
  } as unknown as ConversationStateStore
  const input = {
    conversationId: 'synthetic-chat',
    sourceReadId: 'prior-tail',
    signal: controller.signal,
  }
  const modules = {
    accountToken,
    userToken,
    history: async (_scope: unknown, id: string, options: { forceFull: true; signal: AbortSignal }) => {
      calls++
      expect(_scope).toBe(scope)
      expect(id).toBe(input.conversationId)
      expect(options.forceFull).toBe(true)
      expect(options.signal).toBe(controller.signal)
    },
  }
  return {
    state,
    scope,
    input,
    modules,
    controller,
    changeOwner: () => {
      owner = 'other'
      epoch++
    },
    stop: () => {
      active = false
    },
    current: () => active,
    calls: () => calls,
  }
}
test('native pagination distinguishes exhaustion from an unavailable or still-pending cursor', () => {
  const f = fixture(),
    token = {}
  let page: { complete?: boolean; cursor?: string | null } | undefined
  const scope = { ...f.scope, get: (key: unknown) => (key === token ? page : f.scope.get(key)) }
  const pagination = { token, flush: (callback: () => void) => callback(), readPage: async () => {} }
  expect(nativePaginationPending(scope, undefined, 'synthetic-chat')).toBeNull()
  expect(nativePaginationPending(scope, pagination, 'synthetic-chat')).toBeNull()
  page = { complete: false, cursor: 'older-variants' }
  expect(nativePaginationPending(scope, pagination, 'synthetic-chat')).toBe(true)
  page = { complete: false, cursor: null }
  expect(nativePaginationPending(scope, pagination, 'synthetic-chat')).toBe(false)
  page = { complete: true }
  expect(nativePaginationPending(scope, pagination, 'synthetic-chat')).toBe(false)
})

test('full collection calls the real bound native use case with exact scope, target and cancellation', async () => {
  const f = fixture()
  await createNativeHistoryReader(f.state, f.scope, f.modules, f.current).readOlder(f.input)
  expect(f.calls()).toBe(1)
})

test('collection drains native pagination, including variants, before taking the full graph checkpoint', async () => {
  const f = fixture(),
    token = {},
    calls: string[] = []
  let cursor: string | null = 'newest'
  const originalGet = f.scope.get
  const scope = {
    ...f.scope,
    get: (key: unknown, id?: string) => {
      if (key !== token) return originalGet(key)
      expect(id).toBe(f.input.conversationId)
      return { cursor, complete: false, isLoading: false }
    },
  }
  const flush = (callback: () => void) => callback()
  const modules = {
    ...f.modules,
    pagination: {
      token,
      flush,
      readPage: async (actual: unknown, id: string, callback: typeof flush) => {
        expect(actual).toBe(scope)
        expect(id).toBe(f.input.conversationId)
        expect(callback).toBe(flush)
        calls.push(String(cursor))
        cursor = cursor === 'newest' ? 'oldest' : null
      },
    },
    history: async () => {
      calls.push('full')
    },
  }
  await createNativeHistoryReader(f.state, scope, modules, f.current).readOlder(f.input)
  expect(calls).toEqual(['newest', 'oldest', 'full'])
})

test('a stuck native cursor or owner change cannot claim a complete graph after paging', async () => {
  for (const changed of [false, true]) {
    const f = fixture(),
      token = {},
      originalGet = f.scope.get
    const scope = {
      ...f.scope,
      get: (key: unknown) => (key === token ? { cursor: 'same' } : originalGet(key)),
    }
    const modules = {
      ...f.modules,
      pagination: {
        token,
        flush: (callback: () => void) => callback(),
        readPage: async () => {
          if (changed) f.changeOwner()
        },
      },
    }
    await expect(
      createNativeHistoryReader(f.state, scope, modules, f.current).readOlder(f.input),
    ).rejects.toThrow(changed ? 'archive.error.sourceChanged' : 'archive.error.noProgress')
    expect(f.calls()).toBe(0)
  }
})
test('owner change, stop and pre-abort prevent native collection; late owner changes cannot confirm it', async () => {
  for (const action of ['owner', 'stop', 'abort']) {
    const f = fixture(),
      reader = createNativeHistoryReader(f.state, f.scope, f.modules, f.current)
    if (action === 'owner') f.changeOwner()
    if (action === 'stop') f.stop()
    if (action === 'abort') f.controller.abort()
    await expect(reader.readOlder(f.input)).rejects.toThrow()
    expect(f.calls()).toBe(0)
  }
  const f = fixture()
  f.modules.history = async () => {
    f.changeOwner()
  }
  await expect(
    createNativeHistoryReader(f.state, f.scope, f.modules, f.current).readOlder(f.input),
  ).rejects.toThrow('archive.error.sourceChanged')
})
