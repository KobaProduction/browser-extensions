import {
  type BackupTarChoice,
  type BackupTarOptions,
  type BackupTarReporter,
  exportBackupTar,
  inspectBackupTar,
  type PersistentSettingsPort,
  type PortableBackupPorts,
  restoreBackupTar,
} from '@kobaproduction/browser-storage'
import type { FixedVkDexieRepository } from './archive-fixed-dexie'
import type { VkPreferencesPersistence } from './durable-preferences'
import {
  type VkCapturePreferences,
  validateVkCapturePreferences,
  vkCaptureSettingsPort,
} from './settings-backup'
import type { ArchiveApi } from './types'

/** VK adapter, no VK DTO/schema knowledge in the common portable backup core. */
export function vkPortableBackupPorts(
  api: ArchiveApi,
  repository: FixedVkDexieRepository,
  persistence: VkPreferencesPersistence,
): PortableBackupPorts<VkCapturePreferences> {
  const sessionPort = vkCaptureSettingsPort(api, persistence.scopeId)
  const settings: PersistentSettingsPort<VkCapturePreferences> = {
    scope: repository.scope,
    schemaVersion: sessionPort.schemaVersion,
    exportSettings: () => sessionPort.exportSettings(),
    validateSettings: validateVkCapturePreferences,
    async restoreSettingsAtomically(next) {
      const before = await sessionPort.exportSettings()
      // Make settings durable first, then update the live reactive ArchiveApi.
      await persistence.write(next)
      try {
        await sessionPort.restoreSettingsAtomically(next)
      } catch (error) {
        await persistence.write(before)
        throw error
      }
    },
  }
  return { scope: repository.scope, settings, indexeddb: repository.backupPort() }
}

export function exportVkPortableBackup(
  ports: PortableBackupPorts<VkCapturePreferences>,
  options: BackupTarChoice,
  output?: BackupTarOptions,
) {
  return exportBackupTar(ports, options, output)
}
export function inspectVkPortableBackup(
  ports: PortableBackupPorts<VkCapturePreferences>,
  backup: Blob,
  progress?: BackupTarReporter,
) {
  return inspectBackupTar(ports, backup, progress)
}
export function restoreVkPortableBackup(
  ports: PortableBackupPorts<VkCapturePreferences>,
  backup: Blob,
  selected: Pick<BackupTarChoice, 'settings' | 'indexeddb'>,
  progress?: BackupTarReporter,
) {
  return restoreBackupTar(ports, backup, selected, progress)
}
