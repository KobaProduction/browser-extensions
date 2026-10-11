import { expect, test } from 'bun:test'
import {
  exportSettingsBackup,
  restoreSettingsBackup,
  validateSettingsBackup,
} from '@kobaproduction/browser-storage'
import {
  type VkCapturePreferences,
  validateVkCapturePreferences,
  vkCaptureSettingsPort,
} from './settings-backup'
import type { ArchiveApi, ArchiveOptions, ArchiveStatus } from './types'

function fixture() {
  const options: ArchiveOptions = {
    peerId: 123456,
    mode: 'recent',
    limit: 3000,
    from: '',
    through: '',
    pageSize: 50,
    delay: 450,
    media: true,
  }
  const status: ArchiveStatus = {
    version: '1.0.0',
    folder: 'VK_Archive_v1',
    activePeerId: options.peerId,
    blockedReason: null,
    busy: false,
    folderPending: false,
    options,
    progress: { phase: 'Ожидание', done: 0, total: 0 },
    messages: 3000,
    checkpoint: null,
  }
  let changes = 0
  const api = {
    status: () => status,
    configure(value: Partial<ArchiveOptions>) {
      if (status.busy || status.folderPending || status.blockedReason) throw Error('Archive is blocked')
      if ('peerId' in value) throw Error('Peer must never be restored')
      Object.assign(status.options, value)
      changes++
      return status
    },
  } as ArchiveApi
  return {
    api,
    status,
    get changes() {
      return changes
    },
  }
}

test('VK v1 preset exports only seven non-sensitive options and exact scope', async () => {
  const f = fixture()
  const port = vkCaptureSettingsPort(f.api, 'vk-booster:dev')
  const blob = await exportSettingsBackup(port)
  const raw = await blob.text()
  const parsed = await validateSettingsBackup(port, blob)
  expect(raw).not.toContain('123456')
  expect(raw).not.toContain('VK_Archive_v1')
  expect(raw).not.toContain('messages')
  expect(parsed.scope).toEqual({ productId: 'vk-booster', channel: 'dev' })
  expect(parsed.includes).toEqual({ settings: true, archive: false, attachments: false })
  expect(Object.keys(parsed.settings).sort()).toEqual(
    ['mode', 'limit', 'from', 'through', 'pageSize', 'delay', 'media'].sort(),
  )
  expect(f.changes).toBe(0)
})

test('restores capture options in memory while preserving peer and v1 archive folder', async () => {
  const f = fixture()
  const port = vkCaptureSettingsPort(f.api, 'vk-booster:prod')
  const backup = await exportSettingsBackup(port)
  f.status.options.limit = 10
  f.status.options.mode = 'incremental'
  await restoreSettingsBackup(port, backup)
  expect(f.status.options).toMatchObject({ peerId: 123456, limit: 3000, mode: 'recent' })
  expect(f.status.folder).toBe('VK_Archive_v1')
  expect(f.status.messages).toBe(3000)
  expect(f.changes).toBe(1)
})

test('rejects wrong product/channel, tampering and peer injection without mutation', async () => {
  const f = fixture()
  const source = vkCaptureSettingsPort(f.api, 'vk-booster:dev')
  const backup = await exportSettingsBackup(source)
  const raw = JSON.parse(await backup.text()) as Record<string, unknown>
  for (const scope of ['vk-booster:prod', 'all-in-one:dev']) {
    await expect(restoreSettingsBackup(vkCaptureSettingsPort(f.api, scope), backup)).rejects.toThrow(
      'mismatch',
    )
  }
  await expect(
    restoreSettingsBackup(
      source,
      new Blob([
        JSON.stringify({
          ...raw,
          settings: { ...(raw.settings as object), peerId: 777 },
        }),
      ]),
    ),
  ).rejects.toThrow()
  await expect(
    restoreSettingsBackup(
      source,
      new Blob([
        JSON.stringify({
          ...raw,
          settings: { ...(raw.settings as object), limit: 1 },
        }),
      ]),
    ),
  ).rejects.toThrow('integrity')
  expect(f.changes).toBe(0)
  expect(f.status.options.peerId).toBe(123456)
})

test('rejects invalid mode, dates, limits and unexpected keys before touching the archive', () => {
  const good: VkCapturePreferences = {
    mode: 'recent',
    limit: 15,
    from: '2026-01-01',
    through: '2026-12-31',
    pageSize: 100,
    delay: 300,
    media: false,
  }
  expect(validateVkCapturePreferences(good)).toEqual(good)
  for (const bad of [
    { ...good, mode: 'migrate' },
    { ...good, limit: 100001 },
    { ...good, delay: 299 },
    { ...good, pageSize: 0 },
    { ...good, from: '2026-02-30' },
    { ...good, from: '2027-01-01' },
    { ...good, media: 'yes' },
    { ...good, peerId: 888 },
    { ...good, token: 'secret' },
  ])
    expect(() => validateVkCapturePreferences(bad)).toThrow('Invalid VK capture preferences')
})

test('blocks preset import during active export, folder selection or peer mismatch', async () => {
  const f = fixture()
  const port = vkCaptureSettingsPort(f.api, 'vk-booster:dev')
  const backup = await exportSettingsBackup(port)
  for (const state of [
    { busy: true, folderPending: false, blockedReason: null },
    { busy: false, folderPending: true, blockedReason: null },
    { busy: false, folderPending: false, blockedReason: 'Another conversation' },
  ]) {
    Object.assign(f.status, state)
    await expect(restoreSettingsBackup(port, backup)).rejects.toThrow()
    expect(f.changes).toBe(0)
  }
})

test('rejects unknown runtime and valid-but-different installation scope', async () => {
  const f = fixture()
  expect(() => vkCaptureSettingsPort(f.api, 'chatgpt-booster:prod')).toThrow('scope')
  expect(() => vkCaptureSettingsPort(f.api, 'vk-booster:test')).toThrow('scope')
  expect(() => vkCaptureSettingsPort(f.api, 'vk-booster:prod:other')).toThrow('scope')
  const backed = await exportSettingsBackup(vkCaptureSettingsPort(f.api, 'vk-booster:prod'))
  await expect(
    restoreSettingsBackup(vkCaptureSettingsPort(f.api, 'all-in-one:prod'), backed),
  ).rejects.toThrow('mismatch')
})
