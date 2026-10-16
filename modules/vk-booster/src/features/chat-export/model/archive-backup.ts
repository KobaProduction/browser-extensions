import { createIndexedBackupSource } from '@kobaproduction/browser-adapters'
import type { ApplicationBackupSource } from '@kobaproduction/browser-core'
import type {
  BackupTarChoice,
  BackupTarOptions,
  BackupTarReporter,
  PortableBackupIndexedPort,
  PortableBackupReader,
} from '@kobaproduction/browser-storage'
import type { FixedVkDexieRepository } from './archive-fixed-dexie'
import type { VkArchiveSession } from './archive-session'
import { vkPreferencesPersistence } from './durable-preferences'
import {
  exportVkPortableBackup,
  inspectVkPortableBackup,
  restoreVkPortableBackup,
  vkPortableBackupPorts,
} from './portable-backup'
import {
  createVkPreferencesBackupSource,
  unavailableVkArchiveBackupSource,
  validateVkCapturePreferences,
} from './settings-backup'
import type { ArchiveApi } from './types'
/** Verified provider backup sources. The application owns the shared TAR container. */
export function createVkArchiveBackup(
  session: VkArchiveSession,
  apiObject: Pick<ArchiveApi, 'status' | 'configure'>,
) {
  const {
    state,
    cfg,
    currentPeer,
    auth,
    openFixedArchive,
    verifyOwner,
    withFixed,
    configure,
    configureDuringBackup,
    refresh,
    archiveChanges,
  } = session
  async function withBackup<T>(
    operation: (ports: ReturnType<typeof vkPortableBackupPorts>) => Promise<T>,
  ): Promise<T> {
    if (state.disposed || state.backupRunning || state.busy)
      throw Error('Another VK operation is in progress')
    const storage = vkPreferencesPersistence()
    if (!storage) throw Error('Persistent VK settings adapter is unavailable')
    state.backupRunning = true
    try {
      return await withFixed(async (repo, peerId) => {
        const ports = vkPortableBackupPorts(
          { status: apiObject.status, configure: configureDuringBackup },
          repo,
          storage,
        )
        const ownerId = repo.scope.ownerId
        if (!ownerId) throw Error('Verified VK backup owner unavailable')
        let revision = archiveChanges.revision()
        let invalidated = false
        const fence = () => {
          if (
            invalidated ||
            state.disposed ||
            state.busy ||
            currentPeer() !== peerId ||
            archiveChanges.revision() !== revision
          ) {
            invalidated = true
            throw Error('VK backup context changed')
          }
        }
        const verify = async () => {
          fence()
          await verifyOwner(ownerId, peerId)
          fence()
        }
        const indexed = repo.backupPort({ beforeCommit: verify })
        const restore = async (write: () => Promise<void>) => {
          await verify()
          await write()
          try {
            fence()
          } finally {
            archiveChanges.publish()
            // A portable settings failure may compensate its own successful
            // IndexedDB replacement through this same port. Accept only that
            // locally published revision, never a changed external context.
            if (!invalidated) revision = archiveChanges.revision()
          }
          await verify()
        }
        const scopedIndexed: PortableBackupIndexedPort = {
          ...indexed,
          async countRows() {
            await verify()
            const counts = await indexed.countRows()
            await verify()
            return counts
          },
          async *readRows(pageSize) {
            await verify()
            for await (const row of indexed.readRows(pageSize)) {
              fence()
              yield row
            }
            await verify()
          },
          async validateRows(rows) {
            await verify()
            if (!indexed.validateRows) throw Error('VK read-only backup validation unavailable')
            await indexed.validateRows(rows)
            await verify()
          },
          restoreAtomically(rows) {
            return restore(() => indexed.restoreAtomically(rows))
          },
          async validateStagedRows(reader) {
            await verify()
            if (!indexed.validateStagedRows) throw Error('VK staged backup validation unavailable')
            await indexed.validateStagedRows(reader)
            await verify()
          },
          async restoreStagedAtomically(reader) {
            if (!indexed.restoreStagedAtomically) throw Error('VK staged backup restore unavailable')
            const write = indexed.restoreStagedAtomically
            await restore(() => write(reader))
          },
        }
        return operation({ ...ports, indexeddb: scopedIndexed })
      }, true)
    } finally {
      state.backupRunning = false
      if (!state.disposed) refresh()
    }
  }
  async function backupPortable(
    options: BackupTarChoice,
    output?: BackupTarOptions,
  ): Promise<Blob | null> {
    return withBackup((ports) => exportVkPortableBackup(ports, options, output))
  }
  async function inspectPortable(backup: Blob, progress?: BackupTarReporter) {
    return withBackup((ports) => inspectVkPortableBackup(ports, backup, progress))
  }
  async function restorePortable(
    backup: Blob,
    chosen: Pick<BackupTarChoice, 'settings' | 'indexeddb'>,
    progress?: BackupTarReporter,
  ) {
    return withBackup((ports) => restoreVkPortableBackup(ports, backup, chosen, progress))
  }

  async function backupSources(): Promise<readonly ApplicationBackupSource[]> {
    if (state.disposed || state.busy || state.backupRunning) throw Error('VK operation in progress')
    const persistence = vkPreferencesPersistence()
    if (!persistence) throw Error('VK settings backup is unavailable')
    const settingsSource = createVkPreferencesBackupSource(persistence, {
      read() {
        const { mode, limit, from, through, pageSize, delay, media } = cfg
        return validateVkCapturePreferences({ mode, limit, from, through, pageSize, delay, media })
      },
      requireIdle() {
        if (state.busy || state.backupRunning || state.disposed) throw Error('VK is busy')
      },
      apply(value) {
        configure(value)
      },
    })
    const unavailable = (): readonly ApplicationBackupSource[] => [
      settingsSource,
      unavailableVkArchiveBackupSource(settingsSource, 'Для архива нужна авторизация VK'),
    ]
    if (!(await auth())) return unavailable()
    const peer = currentPeer()
    let initial: FixedVkDexieRepository
    try {
      initial = await openFixedArchive(peer)
    } catch {
      return unavailable()
    }
    const template = initial.backupPort()
    if (!template.scope.ownerId) {
      initial.close()
      return unavailable()
    }
    const ownerId = template.scope.ownerId
    initial.close()
    const requireRepository = async () => {
      if (
        state.disposed ||
        state.busy ||
        state.backupRunning ||
        currentPeer() !== peer ||
        !(await auth())
      )
        throw Error('VK backup context changed')
      const repo = await openFixedArchive(peer)
      if (repo.scope.ownerId !== template.scope.ownerId) {
        repo.close()
        throw Error('VK backup account changed')
      }
      return repo
    }
    const contextFence = (revision: number) => {
      if (
        state.disposed ||
        state.busy ||
        currentPeer() !== peer ||
        archiveChanges.revision() !== revision
      )
        throw Error('VK backup context changed')
    }
    const ownerFence = async (revision: number) => {
      contextFence(revision)
      await verifyOwner(ownerId, peer)
      contextFence(revision)
    }
    const fencedReader = (reader: PortableBackupReader, revision: number): PortableBackupReader => ({
      count: reader.count,
      async *readRows(store) {
        contextFence(revision)
        for await (const row of reader.readRows(store)) {
          contextFence(revision)
          yield row
        }
        contextFence(revision)
      },
      async get(store, key) {
        contextFence(revision)
        const row = await reader.get(store, key)
        contextFence(revision)
        return row
      },
    })
    async function validateBackup(
      validate: (port: PortableBackupIndexedPort, revision: number) => Promise<void>,
    ): Promise<void> {
      const repo = await requireRepository(),
        revision = archiveChanges.revision()
      state.backupRunning = true
      try {
        await ownerFence(revision)
        await validate(repo.backupPort(), revision)
        await ownerFence(revision)
      } finally {
        state.backupRunning = false
        repo.close()
        if (!state.disposed) refresh()
      }
    }
    async function restoreBackup(
      restore: (port: PortableBackupIndexedPort, revision: number) => Promise<void>,
    ): Promise<void> {
      const repo = await requireRepository(),
        revision = archiveChanges.revision()
      state.backupRunning = true
      try {
        await ownerFence(revision)
        // The repository calls this guard inside the active full-store write
        // transaction, after bounded inserts but before any replacement commits.
        await restore(repo.backupPort({ beforeCommit: () => ownerFence(revision) }), revision)
        // Announce a committed replacement even when the post-commit context
        // proof rejects it and the application must attempt compensation.
        try {
          contextFence(revision)
        } finally {
          archiveChanges.publish()
        }
        await ownerFence(archiveChanges.revision())
      } finally {
        state.backupRunning = false
        repo.close()
        if (!state.disposed) refresh()
      }
    }
    const port: PortableBackupIndexedPort = {
      ...template,
      async countRows() {
        const repo = await requireRepository()
        try {
          return await repo.backupPort().countRows()
        } finally {
          repo.close()
        }
      },
      async *readRows(pageSize) {
        const repo = await requireRepository()
        const revision = archiveChanges.revision()
        state.backupRunning = true
        try {
          for await (const row of repo.backupPort().readRows(pageSize)) {
            if (currentPeer() !== peer || archiveChanges.revision() !== revision)
              throw Error('VK backup context changed')
            yield row
          }
          if (archiveChanges.revision() !== revision) throw Error('VK archive changed during backup')
          await verifyOwner(ownerId, peer)
          if (archiveChanges.revision() !== revision)
            throw Error('VK archive changed during backup verification')
        } finally {
          state.backupRunning = false
          repo.close()
        }
      },
      async validateRows(rows) {
        await validateBackup(async (repositoryPort) => {
          const validate = repositoryPort.validateRows
          if (!validate) throw Error('VK read-only backup validation unavailable')
          await validate(rows)
        })
      },
      async restoreAtomically(rows) {
        await restoreBackup((repositoryPort) => repositoryPort.restoreAtomically(rows))
      },
      async validateStagedRows(reader) {
        await validateBackup(async (repositoryPort, revision) => {
          if (!repositoryPort.validateStagedRows) throw Error('VK staged backup validation unavailable')
          await repositoryPort.validateStagedRows(fencedReader(reader, revision))
        })
      },
      async restoreStagedAtomically(reader) {
        await restoreBackup(async (repositoryPort, revision) => {
          if (!repositoryPort.restoreStagedAtomically)
            throw Error('VK staged backup restore unavailable')
          await repositoryPort.restoreStagedAtomically(fencedReader(reader, revision))
        })
      },
    }
    return [
      settingsSource,
      createIndexedBackupSource('vk-booster.indexeddb', 'Архив VK проверенного аккаунта', port),
    ]
  }
  return { backupPortable, inspectPortable, restorePortable, backupSources }
}
