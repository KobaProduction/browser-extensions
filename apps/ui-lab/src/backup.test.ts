import { expect, test } from 'bun:test'
import { createLabBackup } from './backup'
import { createMockSettingsAdapter } from './fixtures'

test('synthetic application backup restores the shared language and refreshes its consumers', async () => {
  const stored = new Map<string, boolean | string>([
    ['ui.language', 'en'],
    ['ui.launcher.enabled', true],
  ])
  let refreshes = 0
  const backup = createLabBackup(stored, createMockSettingsAdapter(), 'chatgpt-booster', async () => {
    refreshes++
  })
  const file = await backup.export(['application.settings'])
  stored.set('ui.language', 'ru')
  await backup.restore(file, ['application.settings'])
  expect(stored.get('ui.language')).toBe('en')
  expect(stored.get('ui.launcher.enabled')).toBe(true)
  expect(refreshes).toBe(1)
})

test('old synthetic application backups without a language restore system default', async () => {
  const stored = new Map<string, boolean | string>([['ui.launcher.enabled', true]])
  const backup = createLabBackup(stored, createMockSettingsAdapter(), 'chatgpt-booster')
  const file = await backup.export(['application.settings'])
  stored.set('ui.language', 'ru')
  await backup.restore(file, ['application.settings'])
  expect(stored.get('ui.language')).toBe('auto')
})
