import { expect, test } from 'bun:test'
import { affectedModules, impactedProductVersions, scopeFor } from './catalog'
import { hasRelevantChange } from './release-plan'

test('only Vk Archive and combiner rebuild when VK code changes', () =>
  expect(affectedModules(['modules/vk-booster/src/index.ts'])).toEqual(['vk-booster', 'all-in-one']))
test('changes to core force rebuilding every module', () =>
  expect(affectedModules(['packages/core/src/index.ts'])).toEqual([
    'vk-booster',
    'chatgpt-booster',
    'proxy-switcher',
    'all-in-one',
  ]))
test('shared archive selector changes rebuild consumers', () =>
  expect(affectedModules(['packages/archive/src/index.ts'])).toEqual([
    'vk-booster',
    'chatgpt-booster',
    'proxy-switcher',
    'all-in-one',
  ]))
test('proxy-only changes do not rebuild VK', () =>
  expect(affectedModules(['modules/proxy-switcher/src/index.ts'])).toEqual(['proxy-switcher']))
test('docs do not trigger rebuild', () => expect(affectedModules(['docs/ARCHITECTURE.md'])).toEqual([]))
test('scoped release plan skips unchanged modules', () => {
  expect(
    hasRelevantChange(['modules/proxy-switcher/src/x.ts'], ['modules/vk-booster/', 'packages/']),
  ).toBe(false)
  expect(hasRelevantChange(['packages/core/src/index.ts'], ['modules/vk-booster/', 'packages/'])).toBe(
    true,
  )
})

test('ChatGPT updates rebuild only ChatGPT and all-in-one', () => {
  expect(affectedModules(['modules/chatgpt-booster/packages/features/src/page-runtime.ts'])).toEqual([
    'chatgpt-booster',
    'all-in-one',
  ])
  expect(affectedModules(['apps/extension/src/chatgpt-content.ts'])).toEqual([
    'chatgpt-booster',
    'all-in-one',
  ])
})

test('shared delivery runtime and telemetry worker rebuild every actual product consumer', () => {
  for (const path of ['apps/userscript/src/runtime.ts', 'apps/extension/src/telemetry-background.ts']) {
    const consumers = ['vk-booster', 'chatgpt-booster', 'all-in-one']
    expect(affectedModules([path])).toEqual(consumers)
    expect(impactedProductVersions([path])).toEqual(consumers)
    for (const id of consumers) expect(hasRelevantChange([path], scopeFor(id))).toBe(true)
  }
})

test('VK worker and popup changes have VK and aggregate release scope, not ChatGPT', () => {
  for (const path of ['apps/extension/src/shared-background.ts', 'apps/extension/src/popup.ts']) {
    expect(affectedModules([path])).toEqual(['vk-booster', 'all-in-one'])
    expect(impactedProductVersions([path])).toEqual(['vk-booster', 'all-in-one'])
    expect(hasRelevantChange([path], scopeFor('vk-booster'))).toBe(true)
    expect(hasRelevantChange([path], scopeFor('chatgpt-booster'))).toBe(false)
  }
})

test('ChatGPT worker app entry is included in independent release detection', () => {
  const path = 'apps/extension/src/chatgpt-background.ts'
  expect(affectedModules([path])).toEqual(['chatgpt-booster', 'all-in-one'])
  expect(hasRelevantChange([path], scopeFor('chatgpt-booster'))).toBe(true)
  expect(hasRelevantChange([path], scopeFor('vk-booster'))).toBe(false)
})
