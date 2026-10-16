import { expect, test } from 'bun:test'
import { type Feature, FeatureRuntime, FeatureSettings, resolveApplicationLocale } from './index'

test('one application language survives reload and overrides every provider legacy preference', async () => {
  const values = new Map<string, boolean | string>()
  const settings = new FeatureSettings({
    async get(key) {
      const value = values.get(key)
      return typeof value === 'boolean' ? value : undefined
    },
    async set(key, value) {
      values.set(key, value)
    },
    async getText(key) {
      const value = values.get(key)
      return typeof value === 'string' ? value : undefined
    },
    async setText(key, value) {
      values.set(key, value)
    },
  })
  const provider = (id: string, language: 'ru' | 'en'): Feature => ({
    id,
    title: id,
    description: '',
    match: () => true,
    targets: ['userscript'],
    requiredCapabilities: [],
    legacyLanguagePreference: async () => language,
    start() {},
  })
  const context = {
    target: 'userscript' as const,
    url: new URL('https://example.invalid'),
    capabilities: new Set<never>(),
    settings,
  }
  const runtime = new FeatureRuntime(
    [provider('chatgpt-booster', 'ru'), provider('vk-booster', 'en')],
    context,
  )
  await runtime.start()
  expect(runtime.shellPreferences().language).toBe('ru')
  let updates = 0
  runtime.subscribe(() => updates++)
  await runtime.setShellPreferences({ language: 'en' })
  expect(updates).toBe(1)
  expect(values.get('ui.language')).toBe('en')
  const reloaded = new FeatureRuntime([provider('chatgpt-booster', 'ru')], context)
  await reloaded.start()
  expect(reloaded.shellPreferences().language).toBe('en')
  await reloaded.setShellPreferences({ language: 'auto' })
  await runtime.refreshFromSettings()
  expect(runtime.shellPreferences().language).toBe('auto')
  expect(resolveApplicationLocale('auto', ['ru-RU'])).toBe('ru')
  expect(resolveApplicationLocale('auto', ['en-US'])).toBe('en')
})

test('legacy seed tolerates boolean-only settings adapters and preserves a newer shared choice', async () => {
  const old = new FeatureSettings({
    async get() {
      return undefined
    },
    async set() {},
  })
  expect(await old.seedLanguagePreference('ru')).toBe('ru')
  let language: string | undefined = 'en'
  const shared = new FeatureSettings({
    async get() {
      return undefined
    },
    async set() {},
    async getText() {
      return language
    },
    async setText(_key, value) {
      language = value
    },
  })
  expect(await shared.seedLanguagePreference('ru')).toBe('en')
  expect(language).toBe('en')
})
