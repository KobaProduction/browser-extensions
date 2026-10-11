import type { Feature } from '@kobaproduction/browser-core'
import { installVkArchive } from './archive-runtime'
import {
  loadVkCaptureDefaults,
  setVkPreferencesPersistence,
} from './features/chat-export/model/durable-preferences'
import { archiveApi } from './features/chat-export/model/types'

export const vkBoosterFeature: Feature = {
  id: 'vk-booster',
  title: 'VK Booster',
  description: 'История переписки, вложения и офлайн-просмотр',
  targets: ['userscript', 'chromium'],
  requiredCapabilities: ['page-dom', 'origin-storage', 'local-files'],
  match: (url) => /^(vk\.ru|vk\.com)$/.test(url.hostname) && url.pathname.startsWith('/im'),
  async start(context) {
    installVkArchive(context.target)
    await loadVkCaptureDefaults((value) => archiveApi()?.configure(value), context.target)
  },
  open() {
    archiveApi()?.show()
  },
  stop() {
    archiveApi()?.destroy?.()
    setVkPreferencesPersistence(null)
  },
}
