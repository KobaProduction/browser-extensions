import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { scopedIdentity } from '../packages/core/src/instance-scope'
import { affectedModules } from './catalog'
import {
  channelIdentity,
  channelModuleIds,
  channelVersion,
  chromeVersion,
  releaseChannel,
  userscriptChannelUrl,
} from './channels'

test('development versions are distinct and Chromium-compatible', () => {
  expect(channelVersion('2.3.8', 'dev', 412)).toBe('2.3.8-dev.412')
  expect(chromeVersion('2.3.8', 'dev', 412)).toBe('2.3.8.412')
  expect(channelVersion('2.3.8', 'prod', 412)).toBe('2.3.8')
  expect(() => channelVersion('2.3.8', 'dev', 0)).toThrow()
  expect(() => releaseChannel('qa')).toThrow()
})
test('each product/channel has unique build and update identity', () => {
  const ids = ['vk-booster', 'chatgpt-booster', 'all-in-one']
  const scopes = ids.flatMap((id) =>
    ['dev', 'prod'].map((channel) => channelIdentity(id, releaseChannel(channel))),
  )
  expect(new Set(scopes).size).toBe(6)
  expect(userscriptChannelUrl('vk-booster', 'dev')).toContain('/dev/userscripts/vk-booster.user.js')
  expect(userscriptChannelUrl('vk-booster', 'prod')).toContain('/prod/userscripts/vk-booster.user.js')
})
test('channel output changes only for affected products', () => {
  expect(channelModuleIds(['modules/vk-booster/src/index.ts'], affectedModules)).toEqual([
    'vk-booster',
    'all-in-one',
  ])
  expect(channelModuleIds(['modules/chatgpt-booster/src/index.ts'], affectedModules)).toEqual([
    'chatgpt-booster',
    'all-in-one',
  ])
  expect(channelModuleIds(['docs/RELEASES.md'], affectedModules)).toEqual([])
})

test('ChatGPT startup only recognizes its own extension root, not the aggregate', async () => {
  const source = await readFile(
    'modules/chatgpt-booster/packages/extension/src/background/index.ts',
    'utf8',
  )
  expect(source).toContain("instanceKey('koba-browser-tools-root')")
  expect(source).toContain('args: [ownShellRootId]')
  expect(source).not.toContain("document.querySelector('#chatgpt-booster-root, [data-chatgpt-booster]')")
  expect(scopedIdentity('koba-browser-tools-root', 'chatgpt-booster:dev')).not.toBe(
    scopedIdentity('koba-browser-tools-root', 'all-in-one:dev'),
  )
})

test('DEV channel does not publish unrelated VK for a ChatGPT-only private version lock update', async () => {
  const { onlyProviderVersionLockChange } = await import('./channel-plan')
  const oldLock = `{ "lockfileVersion": 2, "workspaces": { "modules/chatgpt-booster": {"version":"2.0.3",}, "modules/vk-booster": {"version":"2.3.10"}}, "packages":{} }`
  const chatUpdated = oldLock.replace('"2.0.3"', '"2.0.4"')
  const chatPaths = ['modules/chatgpt-booster/module.json', 'bun.lock']
  expect(onlyProviderVersionLockChange(oldLock, chatUpdated, chatPaths)).toBe(true)
  expect(affectedModules(chatPaths.filter((path) => path !== 'bun.lock'))).toEqual([
    'chatgpt-booster',
    'all-in-one',
  ])
  // A true shared dependency update cannot be mistaken for private metadata.
  const dependencyChanged = chatUpdated.replace('"packages":{}', '"packages":{"shared":"1.0.1"}')
  expect(onlyProviderVersionLockChange(oldLock, dependencyChanged, chatPaths)).toBe(false)
  // Unknown / lockfile-only edits retain conservative shared-product handling.
  expect(onlyProviderVersionLockChange(oldLock, chatUpdated, ['bun.lock'])).toBe(false)
  expect(onlyProviderVersionLockChange('broken', chatUpdated, chatPaths)).toBe(false)
  const vkUpdated = oldLock.replace('"2.3.10"', '"2.3.11"')
  expect(
    onlyProviderVersionLockChange(oldLock, vkUpdated, ['modules/vk-booster/module.json', 'bun.lock']),
  ).toBe(true)
  expect(onlyProviderVersionLockChange(oldLock, vkUpdated, chatPaths)).toBe(false)
})
