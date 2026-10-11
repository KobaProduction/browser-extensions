import { expect, test } from 'bun:test'
import {
  createVkPreferencesPersistence,
  loadVkCaptureDefaults,
  setVkPreferencesPersistence,
  type VkPreferencesBackend,
  vkPreferencesKey,
  vkPreferencesLoadError,
  vkPreferencesPersistence,
} from './durable-preferences'
import type { VkCapturePreferences } from './settings-backup'

const sample: VkCapturePreferences = {
  mode: 'recent',
  limit: 3000,
  from: '',
  through: '',
  pageSize: 50,
  delay: 450,
  media: true,
}
function memoryBackend(): VkPreferencesBackend & { records: Map<string, string> } {
  const records = new Map<string, string>()
  return {
    records,
    async get(key) {
      return records.get(key) ?? null
    },
    async set(key, value) {
      records.set(key, value)
    },
  }
}

test('VK capture defaults persist over reload with exact product/channel/target isolation', async () => {
  const backend = memoryBackend()
  const dev = createVkPreferencesPersistence('userscript', 'vk-booster:dev', backend)
  await dev.write(sample)
  const restarted = createVkPreferencesPersistence('userscript', 'vk-booster:dev', backend)
  expect(await restarted.read()).toEqual(sample)
  for (const [target, scope] of [
    ['userscript', 'vk-booster:prod'],
    ['userscript', 'all-in-one:dev'],
    ['chromium', 'vk-booster:dev'],
  ] as const) {
    expect(await createVkPreferencesPersistence(target, scope, backend).read()).toBeNull()
  }
  expect([...backend.records.keys()]).toEqual([vkPreferencesKey('vk-booster:dev', 'userscript')])
  expect(JSON.stringify([...backend.records.values()])).not.toContain('peerId')
  expect(JSON.stringify([...backend.records.values()])).not.toContain('token')
})

test('malformed values, unknown fields and forged scoped envelopes fail closed', async () => {
  const backend = memoryBackend()
  const port = createVkPreferencesPersistence('userscript', 'vk-booster:dev', backend)
  await expect(port.write({ ...sample, peerId: 1234 } as VkCapturePreferences)).rejects.toThrow()
  expect(backend.records.size).toBe(0)
  await port.write(sample)
  const key = vkPreferencesKey('vk-booster:dev', 'userscript')
  const initial = JSON.parse(backend.records.get(key) ?? '') as Record<string, unknown>
  for (const modified of [
    { ...initial, scopeId: 'vk-booster:prod' },
    { ...initial, schemaVersion: 2 },
    { ...initial, settings: { ...sample, token: 'private' } },
    { ...initial, settings: { ...sample, limit: -1 } },
    { ...initial, unexpected: true },
  ]) {
    backend.records.set(key, JSON.stringify(modified))
    await expect(port.read()).rejects.toThrow()
  }
  backend.records.set(key, 'not-json')
  await expect(port.read()).rejects.toThrow('JSON')
  for (const scope of ['', 'vk-booster:unknown', 'chatgpt-booster:dev']) {
    expect(() => createVkPreferencesPersistence('userscript', scope, backend)).toThrow()
  }
})

test('storage write rejection does not replace the last committed preferences', async () => {
  const backend = memoryBackend()
  const port = createVkPreferencesPersistence('userscript', 'vk-booster:prod', backend)
  await port.write(sample)
  const failing = createVkPreferencesPersistence('userscript', 'vk-booster:prod', {
    get: backend.get,
    async set() {
      throw Error('quota or denied permission')
    },
  })
  await expect(failing.write({ ...sample, limit: 15 })).rejects.toThrow('quota')
  expect(await port.read()).toEqual(sample)
})

test('VK feature startup hydrates only validated saved defaults before UI mount', async () => {
  const backend = memoryBackend()
  const port = createVkPreferencesPersistence('chromium', 'vk-booster:dev', backend)
  await port.write({ ...sample, limit: 250 })
  const configured: VkCapturePreferences[] = []
  await loadVkCaptureDefaults((value) => configured.push(value), 'chromium', 'vk-booster:dev', backend)
  expect(configured).toEqual([{ ...sample, limit: 250 }])
  expect(vkPreferencesLoadError()).toBe('')
  expect(vkPreferencesPersistence()?.scopeId).toBe('vk-booster:dev')
  const key = vkPreferencesKey('vk-booster:dev', 'chromium')
  backend.records.set(
    key,
    JSON.stringify({
      schemaVersion: 1,
      scopeId: 'vk-booster:prod',
      target: 'chromium',
      settings: sample,
    }),
  )
  await loadVkCaptureDefaults((value) => configured.push(value), 'chromium', 'vk-booster:dev', backend)
  expect(configured).toHaveLength(1)
  expect(vkPreferencesLoadError()).toContain('Не удалось загрузить')
  setVkPreferencesPersistence(null)
})
