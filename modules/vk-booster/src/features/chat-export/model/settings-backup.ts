import { createSettingsBackupSource } from '@kobaproduction/browser-adapters'
import type { ApplicationBackupSource } from '@kobaproduction/browser-core'
import { instanceScope } from '@kobaproduction/browser-core'
import {
  exportSettingsBackup,
  type PersistentSettingsPort,
  restoreSettingsBackup,
  validateSettingsBackup,
} from '@kobaproduction/browser-storage'
import type { VkPreferencesPersistence } from './durable-preferences'
import type { ArchiveApi, ArchiveOptions } from './types'

/** Capture preferences only. No conversation, owner, checkpoint or folder identity. */
export type VkCapturePreferences = Omit<ArchiveOptions, 'peerId'>
export function defaultVkCapturePreferences(): VkCapturePreferences {
  return { mode: 'recent', limit: 10, from: '', through: '', pageSize: 50, delay: 450, media: true }
}
const fields = ['mode', 'limit', 'from', 'through', 'pageSize', 'delay', 'media'] as const
const fieldNames = [...fields].sort().join(',')

function validDay(value: string): boolean {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const millis = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value
}

export function validateVkCapturePreferences(input: unknown): VkCapturePreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Invalid VK capture preferences')
  const value = input as Record<string, unknown>
  if (
    Object.keys(value).sort().join(',') !== fieldNames ||
    !['recent', 'incremental', 'backfill'].includes(String(value.mode)) ||
    !Number.isSafeInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > 100000 ||
    !Number.isSafeInteger(value.pageSize) ||
    (value.pageSize as number) < 1 ||
    (value.pageSize as number) > 100 ||
    !Number.isSafeInteger(value.delay) ||
    (value.delay as number) < 300 ||
    typeof value.media !== 'boolean' ||
    typeof value.from !== 'string' ||
    typeof value.through !== 'string' ||
    !validDay(value.from as string) ||
    !validDay(value.through as string) ||
    (value.from && value.through && (value.from as string) > (value.through as string))
  )
    throw Error('Invalid VK capture preferences')
  return {
    mode: value.mode as VkCapturePreferences['mode'],
    limit: value.limit as number,
    from: value.from as string,
    through: value.through as string,
    pageSize: value.pageSize as number,
    delay: value.delay as number,
    media: value.media as boolean,
  }
}

function withoutPeer(options: ArchiveOptions): VkCapturePreferences {
  return validateVkCapturePreferences(Object.fromEntries(fields.map((name) => [name, options[name]])))
}

/** The same scoped settings source is usable with or without the archive child. */
export function createVkPreferencesBackupSource(
  persistence: VkPreferencesPersistence,
  live?: {
    read(): VkCapturePreferences
    apply(value: VkCapturePreferences): void
    requireIdle(): void
  },
): ApplicationBackupSource {
  const [productId, channel, extra] = persistence.scopeId.split(':')
  if (
    (productId !== 'vk-booster' && productId !== 'all-in-one') ||
    (channel !== 'dev' && channel !== 'prod') ||
    extra !== undefined
  )
    throw Error('Invalid VK settings scope')
  const port: PersistentSettingsPort<VkCapturePreferences> = {
    scope: { productId, channel, installationId: `${productId}-${persistence.target}` },
    schemaVersion: 1,
    validateSettings: validateVkCapturePreferences,
    async exportSettings() {
      return validateVkCapturePreferences(
        live?.read() ?? (await persistence.read()) ?? defaultVkCapturePreferences(),
      )
    },
    async restoreSettingsAtomically(value) {
      live?.requireIdle()
      const next = validateVkCapturePreferences(value),
        before = await port.exportSettings()
      live?.requireIdle()
      await persistence.write(next)
      try {
        live?.apply(next)
      } catch (error) {
        await persistence.write(before)
        throw error
      }
    },
  }
  return createSettingsBackupSource('vk-booster.settings', 'Параметры VK Booster', port)
}

export function unavailableVkArchiveBackupSource(
  settings: ApplicationBackupSource,
  reason: string,
): ApplicationBackupSource {
  return {
    id: 'vk-booster.indexeddb',
    label: 'Архив VK проверенного аккаунта',
    kind: 'indexeddb',
    available: false,
    reason,
    scope: { ...settings.scope, productId: 'vk-booster' },
    schema: null,
    readRows() {
      throw Error(reason)
    },
    validateRows() {
      throw Error(reason)
    },
    async restoreRows() {
      throw Error(reason)
    },
  }
}

/** A session preset, not persisted application settings and NOT a v1 archive backup.
 * The selected VK peer and folder always remain under the archive engine's control. */
export function vkCaptureSettingsPort(
  api: Pick<ArchiveApi, 'status' | 'configure'>,
  scopeId = instanceScope(),
): PersistentSettingsPort<VkCapturePreferences> {
  const [productId, channel, extra] = scopeId.split(':')
  if (
    (productId !== 'vk-booster' && productId !== 'all-in-one') ||
    (channel !== 'dev' && channel !== 'prod') ||
    extra !== undefined
  )
    throw Error('VK capture settings require a VK or aggregate product/channel scope')

  function requireIdle(): ArchiveOptions {
    const status = api.status()
    if (status.busy || status.folderPending) throw Error('Archive operation in progress')
    if (status.blockedReason) throw Error('VK conversation does not match selected archive')
    return status.options
  }

  return {
    scope: { productId, channel },
    schemaVersion: 1,
    async exportSettings() {
      return withoutPeer(requireIdle())
    },
    validateSettings: validateVkCapturePreferences,
    async restoreSettingsAtomically(value) {
      requireIdle()
      // configure validates the current peer and all options before changing live settings.
      // Never pass peerId or write the v1 archive folder during preset import.
      api.configure(validateVkCapturePreferences(value))
    },
  }
}

export async function exportVkCaptureSettings(api: ArchiveApi): Promise<Blob> {
  return exportSettingsBackup(vkCaptureSettingsPort(api))
}

export async function restoreVkCaptureSettings(
  api: ArchiveApi,
  backup: Blob,
  persistence?: VkPreferencesPersistence,
): Promise<void> {
  const port = vkCaptureSettingsPort(api, persistence?.scopeId)
  if (!persistence) return restoreSettingsBackup(port, backup)
  // Preflight the entire file and the live conversation before any mutation.
  const validated = await validateSettingsBackup(port, backup)
  const before = withoutPeer(api.status().options)
  await port.exportSettings()
  // One storage.set is atomic; live configuration is rolled back on a failed write.
  await port.restoreSettingsAtomically(validated.settings)
  try {
    await persistence.write(validated.settings)
  } catch (error) {
    try {
      await port.restoreSettingsAtomically(before)
    } catch {
      throw Error('VK settings persistence failed and live rollback was blocked')
    }
    throw error
  }
}
