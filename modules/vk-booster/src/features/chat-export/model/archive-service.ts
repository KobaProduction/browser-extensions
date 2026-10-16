import { type DeliveryTarget, SHELL_OPEN_FEATURE_EVENT } from '@kobaproduction/browser-core'
import { createVkArchiveBackup } from './archive-backup'
import { createVkArchiveCapture } from './archive-capture'
import { createVkArchiveReader } from './archive-reader'
import { createVkArchiveSession, type VkArchiveDependencies } from './archive-session'
import type { ArchiveApi } from './types'

/** The sole active VK archive composition. It never imports the retained folder engine. */
export function createVkArchiveService(
  target: DeliveryTarget = 'userscript',
  onDestroy?: () => void,
  dependencies: VkArchiveDependencies = {},
): ArchiveApi {
  const session = createVkArchiveSession(target, dependencies)
  const capture = createVkArchiveCapture(session)
  const { disposeReader, ...reader } = createVkArchiveReader(session)
  const backup = createVkArchiveBackup(session, session)
  const unavailable = async (): Promise<never> => {
    throw Error('Историческая файловая выгрузка недоступна в основном режиме Dexie.')
  }
  const service: ArchiveApi = {
    version: '1.0.0',
    configure: session.configure,
    status: session.status,
    subscribe: session.subscribe,
    stop: session.stop,
    ...capture,
    ...reader,
    ...backup,
    show() {
      window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: 'vk-booster' } }))
    },
    hide() {
      /* One shared Control Center owns visibility. */
    },
    // Temporary shape compatibility only. No folder, checkpoint, media writer
    // or legacy authorization implementation is reachable through this API.
    selectFolder: unavailable,
    useFolder: unavailable,
    run: unavailable,
    resume: unavailable,
    buildViewer: unavailable,
    getMessages: () => [],
    previewMessages: () => ({ messages: [], matching: 0 }),
    previewAttachments: () => ({}),
    destroy() {
      disposeReader()
      session.destroy()
      onDestroy?.()
    },
  }
  return Object.freeze(service)
}
