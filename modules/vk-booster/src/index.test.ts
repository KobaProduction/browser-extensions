import { expect, test } from 'bun:test'
import { createMemoryVkArchive } from './infrastructure/memory'
import { initializeVkNativeArchive, peerFromPath, vkBoosterFeature } from './native-runtime'

test('VK feature matches only VK conversations and owns no global legacy API', () => {
  expect(vkBoosterFeature.match(new URL('https://vk.ru/im/convo/123'))).toBe(true)
  expect(vkBoosterFeature.match(new URL('https://chatgpt.com/c/123'))).toBe(false)
  expect(peerFromPath('/im/convo/2342')).toBe(2342)
  expect(peerFromPath('/im/convo/nope')).toBeNull()
  expect('VKExport' in globalThis).toBe(false)
})
test('standalone and aggregator native runtimes use distinct database names', () => {
  const source = {
    async history() {
      return { total: 0, messages: [] }
    },
  }
  const native = initializeVkNativeArchive(
    createMemoryVkArchive('vk-booster:dev'),
    source,
    'vk-booster:dev',
  )
  const aggregate = initializeVkNativeArchive(
    createMemoryVkArchive('all-in-one:dev'),
    source,
    'all-in-one:dev',
  )
  expect(native.database).not.toBe(aggregate.database)
  expect(native.scope).toBe('vk-booster:dev')
  expect(aggregate.scope).toBe('all-in-one:dev')
})
