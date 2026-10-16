import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { scopedIdentity, scopedShellIdentity } from './instance-scope'

test('six installed products/channels never alias stored state', () => {
  const scopes = [
    'vk-booster:dev',
    'vk-booster:prod',
    'chatgpt-booster:dev',
    'chatgpt-booster:prod',
    'all-in-one:dev',
    'all-in-one:prod',
  ]
  const identities = scopes.map((scope) => scopedIdentity('shared', scope))
  expect(new Set(identities).size).toBe(scopes.length)
})
test('existing prod standalone database names remain accessible, not silently migrated', () => {
  expect(
    scopedIdentity('chatgpt-booster-archive-v4', 'chatgpt-booster:prod', 'chatgpt-booster:prod'),
  ).toBe('chatgpt-booster-archive-v4')
  expect(
    scopedIdentity('chatgpt-booster-archive-v4', 'all-in-one:prod', 'chatgpt-booster:prod'),
  ).not.toBe('chatgpt-booster-archive-v4')
  expect(
    scopedIdentity('chatgpt-booster-archive-v4', 'chatgpt-booster:dev', 'chatgpt-booster:prod'),
  ).not.toBe('chatgpt-booster-archive-v4')
  expect(() => scopedIdentity('database', 'malformed')).toThrow()
})

test('shell roots, layout and events distinguish delivery targets without renaming provider state', () => {
  for (const base of [
    'koba-browser-tools-root',
    'koba-browser:session-ui',
    'koba-browser:edge-launcher',
    'koba-browser:workspace',
    'koba:open-feature',
    'koba:close-shell',
    'koba:restore-ui',
  ]) {
    const keys = ['chatgpt-booster:dev', 'chatgpt-booster:prod', 'all-in-one:dev'].flatMap((scope) =>
      ['chromium', 'userscript'].map((target) => scopedShellIdentity(base, scope, target)),
    )
    expect(new Set(keys).size).toBe(6)
  }
  expect(scopedIdentity('settings', 'chatgpt-booster:dev')).toBe('settings:chatgpt-booster:dev')
  expect(() => scopedShellIdentity('root', 'chatgpt-booster:dev', 'other')).toThrow()
})

test('compiled MV3 and userscript shells use independent page events for the same product/channel', async () => {
  type ShellBundle = {
    shellInstanceKey(base: string): string
    SHELL_OPEN_FEATURE_EVENT: string
    SHELL_CLOSE_EVENT: string
    SHELL_RESTORE_UI_EVENT: string
  }
  const bundles: ShellBundle[] = await Promise.all(
    ['chromium', 'userscript'].map(async (target) => {
      const result = await Bun.build({
        entrypoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
        target: 'browser',
        format: 'esm',
        define: {
          __BOOSTER_INSTANCE_SCOPE__: JSON.stringify('chatgpt-booster:dev'),
          __BOOSTER_DELIVERY_TARGET__: JSON.stringify(target),
        },
      })
      expect(result.success).toBe(true)
      const output = result.outputs[0]
      if (!output) throw Error('Missing synthetic core bundle')
      return import(`data:text/javascript;base64,${Buffer.from(await output.text()).toString('base64')}`)
    }),
  )
  const [extension, userscript] = bundles
  if (!extension || !userscript) throw Error('Missing synthetic target')
  expect(extension.shellInstanceKey('root')).not.toBe(userscript.shellInstanceKey('root'))
  const page = new EventTarget()
  for (const event of [
    'SHELL_OPEN_FEATURE_EVENT',
    'SHELL_CLOSE_EVENT',
    'SHELL_RESTORE_UI_EVENT',
  ] as const) {
    let extensionEvents = 0,
      userscriptEvents = 0
    page.addEventListener(extension[event], () => extensionEvents++)
    page.addEventListener(userscript[event], () => userscriptEvents++)
    page.dispatchEvent(new Event(extension[event]))
    expect({ extensionEvents, userscriptEvents }).toEqual({ extensionEvents: 1, userscriptEvents: 0 })
    page.dispatchEvent(new Event(userscript[event]))
    expect({ extensionEvents, userscriptEvents }).toEqual({ extensionEvents: 1, userscriptEvents: 1 })
  }
})
