import { type DeliveryTarget, instanceKey } from '@kobaproduction/browser-core'
import { createVkArchiveService } from './features/chat-export/model/archive-service'
import type { ArchiveApi } from './features/chat-export/model/types'

export { createVkArchiveService } from './features/chat-export/model/archive-service'
/** Compatibility publication for existing provider/UI ports; lifecycle owns destruction. */
export function installVkArchive(target: DeliveryTarget = 'userscript'): void {
  const key = instanceKey('VKExport', 'vk-booster:prod')
  const published = globalThis as Record<string, unknown>
  if ((published[key] as ArchiveApi | undefined)?.version === '1.0.0') return
  const service: ArchiveApi = createVkArchiveService(target, () => {
    if (published[key] === service) delete published[key]
  })
  published[key] = service
}
