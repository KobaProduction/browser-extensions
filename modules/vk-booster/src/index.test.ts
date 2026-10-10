import { expect, test } from 'bun:test'
import { vkBoosterFeature } from './index'

test('VK feature is site scoped and can cleanly restart', async () => {
  expect(vkBoosterFeature.match(new URL('https://vk.ru/im/convo/123'))).toBe(true)
  expect(vkBoosterFeature.match(new URL('https://chatgpt.com/'))).toBe(false)
  expect(vkBoosterFeature.match(new URL('https://example.com/im'))).toBe(false)
  const old = {
    document: globalThis.document,
    location: globalThis.location,
    win: globalThis.window,
    flag: globalThis.__VK_EXPORT_TEST_MODE,
  }
  try {
    Object.assign(globalThis, {
      document: {},
      location: { pathname: '/im/convo/7654321' },
      window: globalThis,
      __VK_EXPORT_TEST_MODE: true,
    })
    await vkBoosterFeature.start({} as never)
    expect(globalThis.VKExport?.version).toBe('2.3.1')
    await vkBoosterFeature.stop?.()
    expect(globalThis.VKExport).toBeUndefined()
    await vkBoosterFeature.start({} as never)
    expect(globalThis.VKExport).toBeDefined()
  } finally {
    await vkBoosterFeature.stop?.()
    Object.assign(globalThis, {
      document: old.document,
      location: old.location,
      window: old.win,
      __VK_EXPORT_TEST_MODE: old.flag,
    })
  }
})
