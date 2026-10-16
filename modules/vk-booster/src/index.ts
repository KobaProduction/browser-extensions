import { type Feature, SHELL_OPEN_FEATURE_EVENT } from '@kobaproduction/browser-core'
import { watch } from 'vue'
import { installVkArchive } from './archive-runtime'
import { conversationPeerFromLocation } from './features/chat-export/model/conversation-context'
import {
  applyVkCaptureDefaults,
  loadVkCaptureDefaults,
  setVkPreferencesPersistence,
  vkPreferencesPersistence,
} from './features/chat-export/model/durable-preferences'
import {
  createVkPreferencesBackupSource,
  unavailableVkArchiveBackupSource,
} from './features/chat-export/model/settings-backup'
import { archiveApi } from './features/chat-export/model/types'
import { vkActiveView, vkRequestedView } from './features/chat-export/model/ui-navigation'

const presentation = {
  panel: 'standard' as const,
  version: '1.0.0',
  installation: 'Browser extension',
  viewModuleId: 'archive',
}
function openVkView(view: 'capture' | 'reader' | 'settings' | 'collect' | 'export') {
  vkRequestedView.value = view
  window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: 'vk-booster' } }))
}
export const vkBoosterFeature: Feature = {
  id: 'vk-booster',
  title: 'VK Booster',
  presentation,
  launcher: { mode: 'quick-menu' },
  indicators: {
    current() {
      const status = archiveApi()?.status()
      if (!status) return []
      return [
        {
          id: 'capture',
          label: 'Сохранение',
          labelEn: 'Capture',
          status: status.busy
            ? 'active'
            : status.progress.phase.includes('ошибка')
              ? 'error'
              : status.progress.done > 0
                ? 'success'
                : 'idle',
          detail:
            status.progress.total > 0
              ? `${status.progress.done} из ${status.progress.total}`
              : undefined,
          detailEn:
            status.progress.total > 0
              ? `${status.progress.done} of ${status.progress.total}`
              : undefined,
        },
      ]
    },
    subscribe(listener) {
      return archiveApi()?.subscribe(() => listener()) ?? (() => {})
    },
  },
  settings: {
    categories: [
      {
        id: 'capture',
        title: 'Выгрузка',
        titleEn: 'Capture',
        description: 'Сбор истории открытого диалога',
        descriptionEn: 'Collect history from the open conversation',
      },
      {
        id: 'reader',
        title: 'Архив',
        titleEn: 'Archive',
        description: 'Сохранённые сообщения и экспорт',
        descriptionEn: 'Saved messages and export',
      },
      {
        id: 'settings',
        title: 'Параметры',
        titleEn: 'Parameters',
        description: 'Размер запросов и паузы VK',
        descriptionEn: 'VK request size and delays',
      },
    ],
    currentCategory: () => vkActiveView.value,
    subscribe: (listener) => watch(vkActiveView, listener),
    restoreCategory(categoryId) {
      if (categoryId === 'capture' || categoryId === 'reader' || categoryId === 'settings')
        vkActiveView.value = categoryId
    },
    open(categoryId) {
      if (categoryId === 'capture' || categoryId === 'reader' || categoryId === 'settings')
        openVkView(categoryId)
    },
  },
  async backup() {
    const api = archiveApi()
    if (api?.backupSources) return api.backupSources()
    const persistence = vkPreferencesPersistence()
    if (!persistence) throw Error('VK settings backup is unavailable')
    const settings = createVkPreferencesBackupSource(persistence)
    return [settings, unavailableVkArchiveBackupSource(settings, 'Модуль архива VK выключен')]
  },
  modules: [
    {
      id: 'archive',
      title: 'Архив переписки',
      titleEn: 'Conversation archive',
      description: 'Сбор, чтение и экспорт сообщений выбранного диалога',
      descriptionEn: 'Collect, read and export messages from the selected conversation',
      defaultEnabled: true,
      requiredCapabilities: ['origin-storage', 'local-files'],
      settingsCategory: 'settings',
      async start(context) {
        installVkArchive(context.target)
        await applyVkCaptureDefaults((value) => archiveApi()?.configure(value))
      },
      stop() {
        archiveApi()?.destroy?.()
      },
    },
  ],
  subscribeQuickContext(listener) {
    const unsubscribe = archiveApi()?.subscribe(() => listener())
    window.addEventListener('popstate', listener)
    return () => {
      unsubscribe?.()
      window.removeEventListener('popstate', listener)
    }
  },
  async quickMetrics() {
    const api = archiveApi()
    const peerId = conversationPeerFromLocation(location)
    if (!api || !peerId || api.status().activePeerId !== peerId || api.status().blockedReason) return []
    const saved = await api.countFixed()
    if (conversationPeerFromLocation(location) !== peerId) return []
    return [
      { label: 'Сохранено сообщений', labelEn: 'Saved messages', value: saved, moduleId: 'archive' },
      {
        label: 'Новых за запуск',
        labelEn: 'New this run',
        value: api.status().progress.newCount ?? 0,
        moduleId: 'archive',
      },
    ]
  },
  quickActions: [
    {
      id: 'settings',
      label: 'Настройки',
      labelEn: 'Settings',
      icon: 'settings',
      availableWhenDisabled: true,
      run: () => openVkView('settings'),
    },
    {
      id: 'archive',
      moduleId: 'archive',
      label: 'Открыть архив',
      labelEn: 'Open archive',
      icon: 'archive',
      visible: () => conversationPeerFromLocation(location) !== null,
      run: () => openVkView('reader'),
    },
    {
      id: 'collect',
      moduleId: 'archive',
      label: 'Собрать диалог',
      labelEn: 'Collect conversation',
      icon: 'collect',
      visible: () => conversationPeerFromLocation(location) !== null,
      enabled: () => conversationPeerFromLocation(location) !== null,
      run: () => openVkView('collect'),
    },
    {
      id: 'export',
      moduleId: 'archive',
      label: 'Экспорт сохранённого чата',
      labelEn: 'Export saved conversation',
      icon: 'export',
      visible: () => conversationPeerFromLocation(location) !== null,
      enabled: () => conversationPeerFromLocation(location) !== null,
      run: () => openVkView('export'),
    },
  ],
  description: 'Инструменты VK с действиями для текущей страницы',
  descriptionEn: 'VK tools and actions for the current page',
  targets: ['userscript', 'chromium'],
  requiredCapabilities: ['page-dom', 'origin-storage'],
  match: (url) => /^(vk\.ru|vk\.com)$/.test(url.hostname),
  async start(context) {
    presentation.installation = context.target === 'userscript' ? 'Tampermonkey' : 'Chromium'
    await loadVkCaptureDefaults(() => {}, context.target)
  },
  stop() {
    setVkPreferencesPersistence(null)
  },
  open() {
    archiveApi()?.show()
  },
}
