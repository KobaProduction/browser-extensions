import {
  type BoosterSettings,
  SETTINGS_SCHEMA_VERSION,
  type SettingsAdapter,
  snapshotSettings,
} from '@chatgpt-booster/core'
import { instanceScope } from '@kobaproduction/browser-core'
import {
  exportSettingsBackup,
  type PersistentSettingsPort,
  restoreSettingsBackup,
} from '@kobaproduction/browser-storage'

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
  automation: settings.automation,
})
export type PortableChatGptSettings = ReturnType<typeof portable>

const keys = [
  'enabled',
  'language',
  'features',
  'alerts',
  'monitoring',
  'historyLoader',
  'launcher',
  'observer',
  'ui',
  'export',
  'automation',
]

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
    async exportSettings() {
      return portable(snapshotSettings(await adapter.get()))
    },
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
      const next = snapshotSettings({
        ...before,
        ...value,
        automation: {
          ...value.automation,
          enabled: false,
          remote: { ...value.automation.remote, enabled: false },
        },
      })
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

/** User-requested complete preference backup. Owner-specific capture/export
 * rules are included only with an independently verified account scope. */
export function chatGptCompleteSettingsBackupPort(
  adapter: SettingsAdapter,
  ownerId: string,
  scopeId = instanceScope(),
) {
  if (!ownerId || ownerId.length > 256) throw Error('Verified settings owner required')
  const global = chatGptSettingsBackupPort(adapter, scopeId)
  const portableFull = (settings: BoosterSettings) => ({
    ...portable(settings),
    archive: settings.archive,
    exportOverrides: settings.exportOverrides,
  })
  const fullKeys = [...keys, 'archive', 'exportOverrides'].sort().join(',')
  return {
    scope: { ...global.scope, ownerId },
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    async exportSettings() {
      return portableFull(snapshotSettings(await adapter.get()))
    },
    validateSettings(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('Invalid full settings backup')
      const raw = input as Record<string, unknown>
      if (Object.keys(raw).sort().join(',') !== fullKeys) throw Error('Unknown full settings fields')
      const normalized = portableFull(
        snapshotSettings({
          ...(raw as Partial<BoosterSettings>),
          schemaVersion: SETTINGS_SCHEMA_VERSION,
        }),
      )
      if (
        !['auto', 'ru', 'en'].includes(String(raw.language)) ||
        typeof raw.enabled !== 'boolean' ||
        !['archive', 'modules', 'sounds', 'analytics', 'other', 'triggers', 'remote'].includes(
          normalized.ui.activeSection,
        ) ||
        Object.values(normalized.features).some((value) => typeof value !== 'boolean') ||
        [
          'enabled',
          'userSendSound',
          'responseCompleteSound',
          'conversationEndSound',
          'longRunningSound',
        ].some((key) => typeof normalized.alerts[key as keyof typeof normalized.alerts] !== 'boolean') ||
        JSON.stringify(normalized) !== JSON.stringify(input)
      )
        throw Error('Invalid full settings preferences')
      return normalized
    },
    async restoreSettingsAtomically(input: ReturnType<typeof portableFull>) {
      const value = this.validateSettings(input)
      const current = snapshotSettings(await adapter.get())
      await adapter.set(
        snapshotSettings({
          ...current,
          ...value,
          automation: {
            ...value.automation,
            enabled: false,
            remote: { ...value.automation.remote, enabled: false },
          },
        }),
      )
    },
  } satisfies PersistentSettingsPort<ReturnType<typeof portableFull>>
}
