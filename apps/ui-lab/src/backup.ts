import type { SettingsAdapter } from '@chatgpt-booster/core'
import { normalizeSettings } from '@chatgpt-booster/core'
import { createSettingsBackupSource } from '@kobaproduction/browser-adapters'
import {
  type ApplicationBackupController,
  type ApplicationBackupSource,
  isApplicationLanguage,
} from '@kobaproduction/browser-core'
import {
  createMemoryBackupStage,
  discardSectionedBackupRecovery,
  exportSectionedBackup,
  inspectSectionedBackup,
  listSectionedBackupRecoveries,
  restoreSectionedBackup,
  retrySectionedBackupRollback,
} from '@kobaproduction/browser-storage'

/** Memory-only Lab recovery: never serializes host/extension storage or real archives. */
export function createLabBackup(
  stored: Map<string, boolean | string>,
  settings: SettingsAdapter,
  productId: string,
  onRestore?: () => Promise<void>,
): ApplicationBackupController {
  const scope = { productId, channel: 'dev' as const, installationId: 'ui-lab' }
  const stageFactory = createMemoryBackupStage()
  const options = { scope, stageFactory }
  const sources = (): ApplicationBackupSource[] => [
    createSettingsBackupSource('application.settings', 'Настройки приложения · демонстрация', {
      scope,
      schemaVersion: 1,
      async exportSettings() {
        return Object.fromEntries(stored)
      },
      validateSettings(input) {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.entries(input).some(([key, value]) =>
            key === 'ui.language' ? !isApplicationLanguage(value) : typeof value !== 'boolean',
          ) ||
          Object.keys(input).some(
            (key) => !/^(ui\.[a-z.-]+|installation.enabled|features\.[a-z.-]+)$/.test(key),
          )
        )
          throw Error('Invalid synthetic settings')
        return input as Record<string, boolean | string>
      },
      async restoreSettingsAtomically(value) {
        stored.clear()
        for (const [key, entry] of Object.entries(value)) stored.set(key, entry)
        if (!stored.has('ui.language')) stored.set('ui.language', 'auto')
      },
    }),
    ...(productId !== 'vk-booster'
      ? [
          createSettingsBackupSource('chatgpt-booster.settings', 'Настройки ChatGPT · демонстрация', {
            scope,
            schemaVersion: 1,
            exportSettings: () => settings.get(),
            validateSettings(input) {
              if (!input || typeof input !== 'object' || Array.isArray(input))
                throw Error('Invalid synthetic provider settings')
              return normalizeSettings(input as Parameters<typeof normalizeSettings>[0])
            },
            async restoreSettingsAtomically(value) {
              await settings.set(value)
            },
          }),
        ]
      : []),
  ]
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners])
      try {
        listener()
      } catch {
        /* Observers cannot fail a committed synthetic restore. */
      }
  }
  return {
    async status() {
      return sources()
    },
    async export(selected) {
      return exportSectionedBackup(sources(), selected, options)
    },
    async inspect(file) {
      return inspectSectionedBackup(file, sources(), options)
    },
    async restore(file, selected) {
      try {
        await restoreSectionedBackup(file, sources(), selected, options)
      } finally {
        await onRestore?.()
        notify()
      }
    },
    async recoveries() {
      return listSectionedBackupRecoveries(sources(), options)
    },
    async retryRollback(id) {
      try {
        await retrySectionedBackupRollback(sources(), id, options)
      } finally {
        await onRestore?.()
        notify()
      }
    },
    async discardRecovery(id) {
      await discardSectionedBackupRecovery(sources(), id, options)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
