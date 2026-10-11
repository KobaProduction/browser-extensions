import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { scopedIdentity } from '@kobaproduction/browser-core'

test('DEV, PROD and aggregate settings keys are physically isolated', () => {
  const ids = [
    scopedIdentity('koba-browser', 'chatgpt-booster:dev'),
    scopedIdentity('koba-browser', 'chatgpt-booster:prod'),
    scopedIdentity('koba-browser', 'all-in-one:dev'),
    scopedIdentity('koba-browser', 'all-in-one:prod'),
    scopedIdentity('koba-browser', 'vk-booster:dev'),
    scopedIdentity('koba-browser', 'vk-booster:prod'),
  ]
  expect(new Set(ids).size).toBe(6)
  const settings = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  expect(settings).toContain('instanceKey(namespace)')
  expect(settings).toContain('scopedNamespace')
})

test('MAIN observer is controlled by per-bundle lifecycle, not unconditionally installed', () => {
  const mainWorld = readFileSync(
    new URL(
      '../../../modules/chatgpt-booster/packages/extension/src/observer/index.ts',
      import.meta.url,
    ),
    'utf8',
  )
  const observer = readFileSync(
    new URL('../../../modules/chatgpt-booster/packages/observer/src/index.ts', import.meta.url),
    'utf8',
  )
  const isolated = readFileSync(
    new URL('../../../apps/extension/src/chatgpt-content.ts', import.meta.url),
    'utf8',
  )
  expect(mainWorld).toContain("payload.type === 'koba:observer:enable'")
  expect(mainWorld).toContain("payload.type === 'koba:observer:disable'")
  expect(mainWorld).toContain('detach?.()')
  expect(observer).toContain('TRANSPORT_CHANNEL')
  expect(observer).toContain('__BOOSTER_DELIVERY_TARGET__')
  expect(observer).toContain(
    "const marker = '__chatgptBoosterTransportObserverInstalled__:' + TRANSPORT_CHANNEL",
  )
  expect(observer).toContain('if (!observerActive) return callUpstream')
  expect(observer).toContain('OriginalXHR.prototype.send === wrappedXhrSend')
  expect(isolated).toContain("'koba:observer:enable'")
  expect(isolated).toContain("'koba:observer:disable'")
})
