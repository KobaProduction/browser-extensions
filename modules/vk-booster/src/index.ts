import { type Feature, SHELL_OPEN_FEATURE_EVENT } from '@kobaproduction/browser-core'
import { installVkArchive } from './archive-runtime'
import { conversationPeerFromLocation } from './features/chat-export/model/conversation-context'
import {
  loadVkCaptureDefaults,
  setVkPreferencesPersistence,
} from './features/chat-export/model/durable-preferences'
import { archiveApi } from './features/chat-export/model/types'
import { vkRequestedView } from './features/chat-export/model/ui-navigation'

const presentation = { panel: 'standard' as const, version: '1.0.0', installation: 'Browser extension' }
function openVkView(view: 'capture' | 'reader' | 'settings' | 'collect' | 'export') {
  vkRequestedView.value = view
  window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: 'vk-booster' } }))
}
export const vkBoosterFeature: Feature = {
  id: 'vk-booster',
  title: 'VK Booster',
  presentation,
  launcher: { mode: 'quick-menu' },
  async quickMetrics() {
    const api = archiveApi()
    const peerId = conversationPeerFromLocation(location)
    if (!api || !peerId || api.status().blockedReason) return []
    const saved = await api.countFixed()
    if (conversationPeerFromLocation(location) !== peerId) return []
    return [
      { label: 'Сохранено сообщений', value: saved },
      { label: 'Диалог VK', value: peerId },
    ]
  },
  quickActions: [
    { id: 'settings', label: 'Настройки', icon: 'settings', run: () => openVkView('settings') },
    { id: 'archive', label: 'Открыть архив', icon: 'archive', run: () => openVkView('reader') },
    {
      id: 'collect',
      label: 'Собрать диалог',
      icon: 'collect',
      enabled: () => conversationPeerFromLocation(location) !== null,
      run: () => openVkView('collect'),
    },
    {
      id: 'export',
      label: 'Экспорт сохранённого чата',
      icon: 'export',
      enabled: () => conversationPeerFromLocation(location) !== null,
      run: () => openVkView('export'),
    },
  ],
  description: 'История переписки, вложения и офлайн-просмотр',
  targets: ['userscript', 'chromium'],
  requiredCapabilities: ['page-dom', 'origin-storage', 'local-files'],
  match: (url) => /^(vk\.ru|vk\.com)$/.test(url.hostname),
  async start(context) {
    presentation.installation = context.target === 'userscript' ? 'Tampermonkey' : 'Chromium'
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
