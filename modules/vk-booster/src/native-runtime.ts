import {
  type Feature,
  instanceScope,
  ScopedTelemetry,
  type ScopedTelemetrySink,
} from '@kobaproduction/browser-core'
import { createVkSource } from './api/vk-source'
import { createIndexedVkArchive } from './infrastructure/indexeddb'
import { auditVkExportFolder, exportVkBackup, exportVkConversation } from './model/export'
import { createVkArchiveService } from './model/service'
import {
  type CaptureProgress,
  type ExportFolder,
  type ExportOptions,
  scopedVkDatabaseName,
  type VkArchiveBackup,
  type VkArchiveRepository,
  type VkMessageSource,
} from './model/types'

const scope = instanceScope() || 'vk-booster:prod'
export interface VkArchiveRuntime {
  readonly scope: string
  readonly database: string
  readonly repository: VkArchiveRepository
  readonly source: VkMessageSource
  readonly telemetry: ScopedTelemetry
  currentPeer(): number | null
  collect(
    peerId: number,
    notify?: (p: CaptureProgress) => void,
    force?: boolean,
  ): Promise<CaptureProgress>
  export(
    peerId: number,
    output: ExportFolder,
    selection: ExportOptions,
  ): ReturnType<typeof exportVkConversation>
  audit(peerId: number, output: ExportFolder): ReturnType<typeof auditVkExportFolder>
  backup(): ReturnType<typeof exportVkBackup>
  restore(backup: VkArchiveBackup): Promise<void>
}
let installed: VkArchiveRuntime | null = null
export const peerFromPath = (pathname: string): number | null => {
  const match = pathname.match(/^\/im\/convo\/(\d+)(?:\/|$)/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
/** One service composition per delivery bundle, no global VKExport bridge. */
export function initializeVkNativeArchive(
  repository: VkArchiveRepository = createIndexedVkArchive(scope),
  source: VkMessageSource = createVkSource(),
  overrideScope?: string,
  sink?: ScopedTelemetrySink,
): VkArchiveRuntime {
  const selectedScope = overrideScope ?? scope
  scopedVkDatabaseName(selectedScope)
  const service = createVkArchiveService(repository, source)
  const telemetry = new ScopedTelemetry('VK Booster Service', selectedScope, sink)
  const runtime: VkArchiveRuntime = {
    scope: selectedScope,
    database: scopedVkDatabaseName(selectedScope),
    repository,
    source,
    telemetry,
    currentPeer: () => peerFromPath(location.pathname),
    async collect(peerId, notify, force) {
      const start = Date.now()
      await telemetry.record('archive.capture.started')
      try {
        const result = await service.captureFull(peerId, notify, force)
        await telemetry.record('archive.capture.completed', result.stored, Date.now() - start)
        return result
      } catch (error) {
        await telemetry.record('archive.capture.failed', undefined, Date.now() - start)
        throw error
      }
    },
    async export(peerId, output, selection) {
      try {
        const result = await exportVkConversation({
          repo: repository,
          source,
          scope: selectedScope,
          peerId,
          output,
          selection,
        })
        await telemetry.record('archive.export.completed', result.messages)
        return result
      } catch (error) {
        await telemetry.record('archive.export.failed')
        throw error
      }
    },
    async audit(peerId, output) {
      const result = await auditVkExportFolder(output, selectedScope, peerId)
      await telemetry.record('archive.audit.completed', result.ok.length)
      return result
    },
    async backup() {
      const blob = await exportVkBackup(repository)
      await telemetry.record('archive.backup.completed')
      return blob
    },
    async restore(backup) {
      await repository.restore(backup)
      await telemetry.record('archive.restore.completed')
    },
  }
  installed = runtime
  return runtime
}
export function vkArchiveRuntime(): VkArchiveRuntime | null {
  return installed
}
export const vkBoosterFeature: Feature = {
  id: 'vk-booster',
  title: 'VK Booster',
  description: 'Архив переписок VK и независимый экспорт',
  targets: ['userscript', 'chromium'],
  requiredCapabilities: ['page-dom', 'origin-storage', 'local-files'],
  match: (url) => /^(vk\.ru|vk\.com)$/.test(url.hostname) && url.pathname.startsWith('/im'),
  start() {
    initializeVkNativeArchive()
  },
  stop() {
    installed = null
  },
}
