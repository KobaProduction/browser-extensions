import { expect, test } from 'bun:test'
import { proxyAvailable, validateProxyProfile } from './index'

test('proxy privilege is explicit and unavailable to userscripts', () => {
  expect(proxyAvailable('userscript', new Set(['proxy']))).toBe(false)
  expect(proxyAvailable('chromium', new Set())).toBe(false)
  expect(proxyAvailable('chromium', new Set(['proxy']))).toBe(true)
})
test('HTTP and SOCKS profiles have bounded host and port', () => {
  expect(
    validateProxyProfile({ id: '1', name: 'Office', scheme: 'socks5', host: 'proxy.test', port: 1080 })
      .port,
  ).toBe(1080)
  expect(() =>
    validateProxyProfile({ id: '1', name: 'Invalid', scheme: 'socks5', host: 'test/evil', port: 0 }),
  ).toThrow()
})
