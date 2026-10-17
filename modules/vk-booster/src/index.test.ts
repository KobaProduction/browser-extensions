import { expect, test } from 'bun:test'
import { archiveApi } from './features/chat-export/model/types'
import { vkBoosterFeature } from './index'
import { VK_BASE_VERSION } from './version'

test('VK feature is site scoped and can cleanly restart', async () => {
  expect(vkBoosterFeature.match(new URL('https://vk.ru/im/convo/123'))).toBe(true)
  expect(vkBoosterFeature.match(new URL('https://chatgpt.com/'))).toBe(false)
  expect(vkBoosterFeature.match(new URL('https://example.com/im'))).toBe(false)
  const old = {
    document: globalThis.document,
    location: globalThis.location,
    win: globalThis.window,
    flag: globalThis.__VK_EXPORT_TEST_MODE,
    scope: (globalThis as Record<string, unknown>).__BOOSTER_INSTANCE_SCOPE__,
    storage: globalThis.localStorage,
  }
  try {
    Object.assign(globalThis, {
      document: {},
      location: { pathname: '/im/convo/7654321' },
      window: globalThis,
      __VK_EXPORT_TEST_MODE: true,
      __BOOSTER_INSTANCE_SCOPE__: 'vk-booster:dev',
      localStorage: { getItem: () => null, setItem: () => {} },
    })
    await vkBoosterFeature.start({ target: 'userscript' } as never)
    expect(archiveApi()).toBeUndefined()
    const archive = vkBoosterFeature.modules?.find((module) => module.id === 'archive')
    expect(archive).toBeDefined()
    if (!archive) throw Error('VK archive module is missing')
    await archive.start({ target: 'userscript' } as never)
    expect(archiveApi()?.version).toBe(VK_BASE_VERSION)
    await archive.stop?.()
    expect(archiveApi()).toBeUndefined()
    // Parent preferences remain independent while the archive child restarts.
    await archive.start({ target: 'userscript' } as never)
    expect(archiveApi()).toBeDefined()
  } finally {
    await vkBoosterFeature.modules?.find((module) => module.id === 'archive')?.stop?.()
    await vkBoosterFeature.stop?.()
    Object.assign(globalThis, {
      document: old.document,
      location: old.location,
      window: old.win,
      __VK_EXPORT_TEST_MODE: old.flag,
      __BOOSTER_INSTANCE_SCOPE__: old.scope,
      localStorage: old.storage,
    })
  }
})
