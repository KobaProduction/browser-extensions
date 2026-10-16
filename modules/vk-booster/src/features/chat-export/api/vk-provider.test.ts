import { expect, test } from 'bun:test'
import type { ArchiveOptions } from '../model/types'
import { createVkProvider } from './vk-provider'

const settings: ArchiveOptions = {
  peerId: 12345,
  mode: 'recent',
  limit: 100,
  from: '',
  through: '',
  pageSize: 50,
  delay: 450,
  media: false,
}

test('VK API quota code 6 is retried with bounded exponential delay', async () => {
  const original = globalThis.fetch
  const waits: number[] = []
  let attempts = 0
  globalThis.fetch = (async () => {
    attempts++
    return new Response(
      JSON.stringify(
        attempts <= 2
          ? { error: { error_code: 6, error_msg: 'Too many requests per second' } }
          : { response: { success: 1 } },
      ),
      { status: 200 },
    )
  }) as unknown as typeof fetch
  try {
    const provider = createVkProvider(settings, {
      sleep: async (ms) => {
        waits.push(ms)
      },
      refresh: () => {},
    })
    expect(await provider.api('messages.getHistory', { peer_id: 12345, count: 1 })).toEqual({
      success: 1,
    })
    expect(attempts).toBe(3)
    expect(waits).toEqual([1000, 2000])
  } finally {
    globalThis.fetch = original
  }
})

test('VK permission errors do not turn into unlimited retries', async () => {
  const original = globalThis.fetch
  let attempts = 0
  globalThis.fetch = (async () => {
    attempts++
    return new Response(JSON.stringify({ error: { error_code: 15 } }), { status: 200 })
  }) as unknown as typeof fetch
  try {
    const provider = createVkProvider(settings, { sleep: async () => {}, refresh: () => {} })
    await expect(provider.api('messages.getHistory', { peer_id: 12345, count: 1 })).rejects.toThrow('15')
    expect(attempts).toBe(1)
  } finally {
    globalThis.fetch = original
  }
})

test('selects only an owner-verified token; history permission is checked by the explicit history call', async () => {
  const originalFetch = globalThis.fetch
  const localDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const sessionDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  // Fake tokens never enter a log or real network. Both exceed the minimum length.
  const restricted = 'restricted-synthetic-token-0001'
  const approved = 'verified-synthetic-token-000002'
  const source = new Map([
    ['vk_access_token_a', restricted],
    ['vk_access_token_b', approved],
  ])
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return source.size
      },
      key(index: number) {
        return [...source.keys()][index] ?? null
      },
      getItem(key: string) {
        return source.get(key) ?? null
      },
    },
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { length: 0, key: () => null, getItem: () => null },
  })
  const requests: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = new URL(String(input)).pathname.split('/').at(-1)
    const params = new URLSearchParams(String(init?.body ?? ''))
    const token = params.get('access_token')
    requests.push(`${token === restricted ? 'restricted' : 'verified'}:${method}`)
    return new Response(
      JSON.stringify(
        method === 'messages.getHistory'
          ? { response: { count: 1, items: [{ id: 11, date: 1800000000 }] } }
          : token === restricted
            ? { error: { error_code: 5 } }
            : { response: [{ id: 34567 }] },
      ),
      { status: 200 },
    )
  }) as typeof fetch
  try {
    const provider = createVkProvider(settings, { sleep: async () => {}, refresh: () => {} })
    expect(await provider.auth()).toBe(true)
    expect(provider.hasToken()).toBe(true)
    expect(requests).toEqual(['restricted:users.get', 'verified:users.get'])
    expect(await provider.history(0, 1)).toMatchObject({ count: 1, items: [{ id: 11 }] })
    expect(requests.at(-1)).toBe('verified:messages.getHistory')
    // A subsequent API call uses the verified token, not the earlier history-only token.
    expect(await provider.api('users.get', {})).toEqual([{ id: 34567 }])
    expect(requests.at(-1)).toBe('verified:users.get')
  } finally {
    globalThis.fetch = originalFetch
    if (localDescriptor) Object.defineProperty(globalThis, 'localStorage', localDescriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    if (sessionDescriptor) Object.defineProperty(globalThis, 'sessionStorage', sessionDescriptor)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

test('rejects history-only tokens without authenticated owner and leaves no active token', async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      length: 1,
      key: () => 'vk_access_token',
      getItem: () => 'history-only-test-token-long-enough',
    },
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { length: 0, key: () => null, getItem: () => null },
  })
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    new Response(
      JSON.stringify(
        String(input).includes('messages.getHistory')
          ? { response: { count: 0, items: [] } }
          : { error: { error_code: 5 } },
      ),
      { status: 200 },
    )) as typeof fetch
  try {
    const provider = createVkProvider(settings, { sleep: async () => {}, refresh: () => {} })
    expect(await provider.auth()).toBe(false)
    expect(provider.hasToken()).toBe(false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})
