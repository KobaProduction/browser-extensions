import {
  type BackupTarChoice,
  type BackupTarOptions,
  type BackupTarReporter,
  exportBackupTar,
  inspectBackupTar,
  type PortableBackupPorts,
  restoreBackupTar,
} from '@kobaproduction/browser-storage'
import type { FixedCanonicalDexieRepository } from './archive-fixed-dexie'

/** Internal fixed-v1 recovery, deliberately not wired to the ordinary UI. */
export function chatGptPortableBackupPorts(
  repo: FixedCanonicalDexieRepository,
): PortableBackupPorts<never> {
  return { scope: repo.scope, indexeddb: repo.backupPort() }
}
export function exportChatGptPortableArchive(
  repo: FixedCanonicalDexieRepository,
  choice: Pick<BackupTarChoice, 'compression' | 'chunkRows'>,
  output?: BackupTarOptions,
) {
  return exportBackupTar(
    chatGptPortableBackupPorts(repo),
    { ...choice, settings: false, indexeddb: true },
    output,
  )
}
export function inspectChatGptPortableArchive(
  repo: FixedCanonicalDexieRepository,
  archive: Blob,
  progress?: BackupTarReporter,
) {
  return inspectBackupTar(chatGptPortableBackupPorts(repo), archive, progress)
}
/** Operator-initiated only; no startup mutation or legacy database access. */
export function restoreChatGptPortableArchive(
  repo: FixedCanonicalDexieRepository,
  archive: Blob,
  progress?: BackupTarReporter,
) {
  return restoreBackupTar(
    chatGptPortableBackupPorts(repo),
    archive,
    { settings: false, indexeddb: true },
    progress,
  )
}
