import { describe, expect, test } from 'bun:test'
import type { PersistentSettingsPort, ServiceScope } from './service-contract'
import { exportSettingsBackup, restoreSettingsBackup, validateSettingsBackup } from './settings-backup'

const scope: ServiceScope = { productId: 'chatgpt-booster', channel: 'dev' }
function makePort() {
  let current = { language: 'ru', enabled: false }
  let writes = 0
  const port: PersistentSettingsPort<typeof current> = {
    scope,
    schemaVersion: 1,
    async exportSettings() {
      return { ...current }
    },
    validateSettings(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('bad settings')
      const o = value as Record<string, unknown>
      if (
        Object.keys(o).sort().join(',') !== 'enabled,language' ||
        typeof o.enabled !== 'boolean' ||
        (o.language !== 'ru' && o.language !== 'en')
      )
        throw Error('bad settings')
      return { language: o.language, enabled: o.enabled }
    },
    async restoreSettingsAtomically(value) {
      current = { ...value }
      writes++
    },
  }
  return {
    port,
    get current() {
      return current
    },
    get writes() {
      return writes
    },
  }
}
describe('scoped portable settings backup', () => {
  test('validates round-trip and includes only settings', async () => {
    const adapter = makePort()
    const backup = await exportSettingsBackup(adapter.port)
    const parsed = await validateSettingsBackup(adapter.port, backup)
    expect(parsed.includes).toEqual({ settings: true, archive: false, attachments: false })
    expect(parsed.scope).toEqual(scope)
    await restoreSettingsBackup(adapter.port, backup)
    expect(adapter.current).toEqual({ language: 'ru', enabled: false })
    expect(adapter.writes).toBe(1)
  })
  test('rejects tampering without writing', async () => {
    const adapter = makePort()
    const original = JSON.parse(await (await exportSettingsBackup(adapter.port)).text())
    original.settings.language = 'en'
    await expect(
      restoreSettingsBackup(adapter.port, new Blob([JSON.stringify(original)])),
    ).rejects.toThrow('integrity')
    expect(adapter.writes).toBe(0)
  })
  test('rejects another channel, product or owner before writing', async () => {
    const adapter = makePort()
    const parsed = JSON.parse(await (await exportSettingsBackup(adapter.port)).text())
    for (const bad of [
      { productId: 'vk-booster', channel: 'dev' },
      { productId: 'chatgpt-booster', channel: 'prod' },
      { productId: 'chatgpt-booster', channel: 'dev', ownerId: 'someone' },
    ]) {
      await expect(
        restoreSettingsBackup(adapter.port, new Blob([JSON.stringify({ ...parsed, scope: bad })])),
      ).rejects.toThrow('mismatch')
    }
    expect(adapter.writes).toBe(0)
  })
  test('rejects invalid format, schema, size and unknown values', async () => {
    const adapter = makePort()
    const source = JSON.parse(await (await exportSettingsBackup(adapter.port)).text())
    await expect(restoreSettingsBackup(adapter.port, new Blob([]))).rejects.toThrow('size')
    await expect(
      restoreSettingsBackup(adapter.port, new Blob([JSON.stringify({ ...source, schemaVersion: 2 })])),
    ).rejects.toThrow('format')
    await expect(
      restoreSettingsBackup(
        adapter.port,
        new Blob([JSON.stringify({ ...source, settings: { ...source.settings, token: 'secret' } })]),
      ),
    ).rejects.toThrow()
    expect(adapter.writes).toBe(0)
  })
  test('requires adapter atomic restore and preserves existing settings on preflight errors', async () => {
    const adapter = makePort()
    const backup = await exportSettingsBackup(adapter.port)
    await expect(
      restoreSettingsBackup(
        {
          ...adapter.port,
          restoreSettingsAtomically: async () => {
            throw Error('quota')
          },
        },
        backup,
      ),
    ).rejects.toThrow('quota')
    expect(adapter.writes).toBe(0)
    expect(adapter.current.language).toBe('ru')
  })
})
