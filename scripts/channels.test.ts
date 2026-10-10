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
