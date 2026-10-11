import { instanceScope } from '@kobaproduction/browser-core'
import { type PersistentSettingsPort, exportSettingsBackup, restoreSettingsBackup } from '@kobaproduction/browser-storage'
import {
  type BoosterSettings,
  type SettingsAdapter,
  SETTINGS_SCHEMA_VERSION,
  snapshotSettings,
} from '@chatgpt-booster/core'

/** Account-specific capture rules and telemetry endpoints are intentionally
 * excluded; this is only global UI/features configuration. */
const portable = (settings: BoosterSettings) => ({
  enabled: settings.enabled,
  language: settings.language,
  features: settings.features,
  alerts: settings.alerts,
  monitoring: settings.monitoring,
  historyLoader: settings.historyLoader,
  launcher: settings.launcher,
  observer: settings.observer,
  ui: settings.ui,
  export: settings.export,
})
export type PortableChatGptSettings = ReturnType<typeof portable>

const keys = ['enabled', 'language', 'features', 'alerts', 'monitoring', 'historyLoader', 'launcher', 'observer', 'ui', 'export']

export function chatGptSettingsBackupPort(
  adapter: SettingsAdapter,
  scopeId = instanceScope(),
): PersistentSettingsPort<PortableChatGptSettings> {
  const [productId, channel, extra] = scopeId.split(':')
  if (productId !== 'chatgpt-booster' && productId !== 'all-in-one')
    throw new Error('ChatGPT settings backup requires a compiled ChatGPT or aggregate identity')
  if ((channel !== 'dev' && channel !== 'prod') || extra !== undefined)
    throw new Error('Unknown ChatGPT settings backup channel')

  return {
    scope: { productId, channel },
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    async exportSettings() { return portable(snapshotSettings(await adapter.get())) },
    validateSettings(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('Unsupported settings payload')
      const raw = input as Record<string, unknown>
      if (Object.keys(raw).sort().join(',') !== [...keys].sort().join(','))
        throw Error('Unknown settings keys in backup')
      const normalized = portable(snapshotSettings(raw as unknown as Partial<BoosterSettings>))
      if (JSON.stringify(normalized) !== JSON.stringify(input))
        throw Error('Invalid or noncanonical settings in backup')
      return normalized
    },
    async restoreSettingsAtomically(value) {
      const before = snapshotSettings(await adapter.get())
      // The settings adapter writes a single versioned storage record atomically.
      // Never overwrite owner-specific capture rules, telemetry endpoint or secrets.
      const next = snapshotSettings({ ...before, ...value })
      await adapter.set(next)
    },
  }
}

export async function exportChatGptSettings(adapter: SettingsAdapter): Promise<Blob> {
  return exportSettingsBackup(chatGptSettingsBackupPort(adapter))
}

export async function restoreChatGptSettings(adapter: SettingsAdapter, blob: Blob): Promise<void> {
  return restoreSettingsBackup(chatGptSettingsBackupPort(adapter), blob)
}
