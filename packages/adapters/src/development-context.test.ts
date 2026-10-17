import { expect, test } from 'bun:test'
import { isDevelopmentContextAllowed } from './development-context'

test('all isolated product/channel scopes can start without incognito-only browser APIs', () => {
  for (const target of ['userscript', 'chromium'] as const)
    for (const product of ['vk-booster', 'chatgpt-booster', 'all-in-one'])
      for (const channel of ['dev', 'prod'])
        expect(isDevelopmentContextAllowed(target, `${product}:${channel}`)).toBe(true)
})

test('allowing normal tabs does not admit unknown or unscoped installations', () => {
  for (const target of ['userscript', 'chromium'] as const)
    for (const scope of ['', 'dev', 'vk-booster', 'unknown:dev', 'vk-booster:test', 'all-in-one:prod:x'])
      expect(isDevelopmentContextAllowed(target, scope)).toBe(false)
})
