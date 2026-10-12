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
