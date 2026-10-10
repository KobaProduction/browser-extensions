import { expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, type BoosterSettings, type SettingsAdapter, snapshotSettings } from '../packages/core/src'
import { exportSettingsBackup, restoreSettingsBackup } from '@kobaproduction/browser-storage'
import { chatGptSettingsBackupPort } from '../packages/ui/src/settings-backup'

function fixture() {
  let writes = 0
  let current = snapshotSettings({
    ...DEFAULT_SETTINGS,
    telemetry: { enabled: true, endpoint: 'https://private.example/?token=SECRET' },
    archive: {
      ...DEFAULT_SETTINGS.archive,
      conversations: { privateConversation: { enabled: true } },
    },
  } as Partial<BoosterSettings>)
  const adapter: SettingsAdapter = {
    async get() { return current },
    async set(value) { writes++; current = snapshotSettings(value) },
    async update(patch) {
      const next = snapshotSettings({ ...current, ...patch })
      await this.set(next)
      return next
    },
    subscribe() { return () => {} },
  }
  return { adapter, get current() { return current }, get writes() { return writes } }
}

test('ChatGPT settings backup excludes private scope rules and telemetry tokens', async () => {
  const source = fixture()
  const port = chatGptSettingsBackupPort(source.adapter, 'chatgpt-booster:dev')
  const exported = await exportSettingsBackup(port)
  const text = await exported.text()
  expect(text).not.toContain('SECRET')
  expect(text).not.toContain('privateConversation')
  expect(text).not.toContain('\"telemetry\":')
  expect(text).toContain('"productId":"chatgpt-booster"')
  expect(text).toContain('"channel":"dev"')
})

test('restore updates portable UI preferences without touching native archive settings', async () => {
  const adapter = fixture()
  const port = chatGptSettingsBackupPort(adapter.adapter, 'chatgpt-booster:dev')
  const exported = await exportSettingsBackup(port)
  await adapter.adapter.update!({ language: 'en', alerts: { responseCompleteSound: false } })
  await restoreSettingsBackup(port, exported)
  expect(adapter.current.language).toBe('auto')
  expect(adapter.current.telemetry.endpoint).toContain('SECRET')
  expect(adapter.current.telemetry.enabled).toBe(true)
  expect(adapter.current.archive.conversations).toHaveProperty('privateConversation')
  expect(adapter.writes).toBe(2)
})

test('backup identity rejects importing dev configuration into prod or aggregate', async () => {
  const adapter = fixture()
  const exported = await exportSettingsBackup(chatGptSettingsBackupPort(adapter.adapter, 'chatgpt-booster:dev'))
  await expect(restoreSettingsBackup(chatGptSettingsBackupPort(adapter.adapter, 'chatgpt-booster:prod'), exported)).rejects.toThrow('mismatch')
  await expect(restoreSettingsBackup(chatGptSettingsBackupPort(adapter.adapter, 'all-in-one:dev'), exported)).rejects.toThrow('mismatch')
  expect(adapter.writes).toBe(0)
})
