import { expect, test } from 'bun:test'
import type { VkAsset, VkMessage } from '../model/types'
import { assets, inspectVkAssets } from './vk-assets'
import { downloadVkAttachment } from './vk-attachment-download'

const asset = (urls: string[]): VkAsset => ({
  key: '1:root:0:photo',
  rootId: 1,
  type: 'photo',
  choices: urls.map((url) => ({ url, name: 'photo.png', size: null })),
  sourceId: 1,
  context: 'root',
  external: null,
  transcript: null,
})
test('explicit original download verifies bounded bytes and never sends credentials or follows redirects', async () => {
  let calls = 0,
    guards = 0
  const fetcher = async (url: string, init: RequestInit) => {
    calls++
    expect(String(url)).toBe('https://cdn.example.invalid/photo.png')
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
    return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), {
      headers: { 'content-type': 'image/png' },
    })
  }
  const result = await downloadVkAttachment(asset(['https://cdn.example.invalid/photo.png']), {
    signal: new AbortController().signal,
    fetcher,
    assertCurrent: async () => {
      guards++
    },
  })
  expect(calls).toBe(1)
  expect(guards).toBeGreaterThanOrEqual(3)
  expect(result).toMatchObject({ name: 'photo.png', size: 9, mime: 'image/png' })
  expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
})
test('unsafe protocols and user-info never reach fetch; HTML disguised as an image is rejected', async () => {
  let calls = 0
  const fetcher = async () => {
    calls++
    return new Response('<html>private</html>', { headers: { 'content-type': 'image/png' } })
  }
  const options = { signal: new AbortController().signal, fetcher, assertCurrent: async () => {} }
  await expect(
    downloadVkAttachment(
      asset([
        'javascript:alert(1)',
        'data:image/png,x',
        'file:///private',
        'http://cdn.example.invalid/x',
        'https://user:password@cdn.example.invalid/x',
      ]),
      options,
    ),
  ).rejects.toThrow('unavailable or unsafe')
  expect(calls).toBe(0)
  await expect(downloadVkAttachment(asset(['https://cdn.example.invalid/x']), options)).rejects.toThrow(
    'unavailable or unsafe',
  )
  expect(calls).toBe(1)
})
test('cancellation and an owner fence prevent a pending media response from being released', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  const fetcher = async () => {
    calls++
    return new Response(new Uint8Array([1]))
  }
  await expect(
    downloadVkAttachment(asset(['https://cdn.example.invalid/x']), {
      signal: controller.signal,
      fetcher,
      assertCurrent: async () => {},
    }),
  ).rejects.toThrow()
  expect(calls).toBe(0)
  let checks = 0,
    cancelled = false
  const pending = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true
    },
  })
  await expect(
    downloadVkAttachment(asset(['https://cdn.example.invalid/x']), {
      signal: new AbortController().signal,
      fetcher: async () => new Response(pending),
      assertCurrent: async () => {
        if (++checks > 1) throw Error('owner changed')
      },
    }),
  ).rejects.toThrow('owner changed')
  expect(cancelled).toBe(true)
})
test('attachment descriptors tolerate unknown source shapes and disclose bounded traversal', () => {
  const raw = {
    id: 1,
    date: 1,
    attachments: [
      null,
      { type: 'doc', doc: { url: 'https://example.invalid/file', ext: { toString: 'unknown' } } },
    ],
    fwd_messages: [null],
  } as unknown as VkMessage
  expect(assets(raw)).toHaveLength(2)
  let nested: VkMessage = { id: 10, date: 1 }
  for (let index = 0; index < 10; index++) nested = { id: index + 1, date: 1, reply_message: nested }
  expect(inspectVkAssets(nested).truncated).toBe(true)
})
