import type {
  ArchiveCaptureContext,
  ChatGptAutomationControl,
  PersistentDiagnosticsAdapter,
  SecretAdapter,
  SettingsAdapter,
  TelemetryControlAdapter,
  TransportDiagnosticsAdapter,
} from '@chatgpt-booster/core'
import {
  BOOSTER_VERSION,
  OPEN_ARCHIVE_EVENT,
  OPEN_CAPTURE_SETTINGS_EVENT,
  OPEN_SETTINGS_EVENT,
  resolveCaptureRule,
} from '@chatgpt-booster/core'
import {
  type BoosterTargetAdapter,
  createBoosterPageRuntime,
  type FixedChatGptView,
} from '@chatgpt-booster/features'
import type { ArchiveDataAdapter } from '@chatgpt-booster/ui'
import { createIndexedBackupSource, createSettingsBackupSource } from '@kobaproduction/browser-adapters'
import { type Feature, SHELL_OPEN_FEATURE_EVENT } from '@kobaproduction/browser-core'
import { ref, shallowRef, watch } from 'vue'
import {
  chatGptCompleteSettingsBackupPort,
  chatGptSettingsBackupPort,
} from '../packages/ui/src/settings-backup'
import { chatGptIndicators } from './provider-indicators'

export interface ChatGptViewContext {
  archiveAdapter: ArchiveDataAdapter
  fixedArchive?: FixedChatGptView
  settingsAdapter: SettingsAdapter
  diagnosticsAdapter: TransportDiagnosticsAdapter
  persistentDiagnosticsAdapter?: PersistentDiagnosticsAdapter
  secretAdapter?: SecretAdapter
  telemetryControlAdapter?: TelemetryControlAdapter
  targetLabel: string
  automationControl?: ChatGptAutomationControl
}

/** Per-provider service composition; a shared shell owns the only launcher. */
export const chatGptViewContext = shallowRef<ChatGptViewContext | null>(null)
export const chatGptSafeView = ref<'archive' | 'settings' | 'capture'>('archive')
export const chatGptViewRevision = ref(0)
export function setChatGptSafeView(view: typeof chatGptSafeView.value) {
  chatGptViewRevision.value++
  chatGptRequestedSection.value = null
  chatGptSafeView.value = view
}
/** Transient commands are consumed once by the mounted provider view. */
export const chatGptRequestedSection = ref<
  'archive' | 'settings' | 'capture' | 'collect' | 'export' | null
>(null)
export const chatGptArchiveRequest = shallowRef<ArchiveCaptureContext | null>(null)

export interface ChatGptObserverLifecycle {
  /** Install a reversible page-world transport observer only while enabled. */
  install(): () => void
}

export function createChatGptBoosterFeature(
  target: BoosterTargetAdapter,
  observer?: ChatGptObserverLifecycle,
) {
  const page = createBoosterPageRuntime({ target, mountUi: false, externalSounds: true })
  let indicatorSettings: import('@chatgpt-booster/core').BoosterSettings | undefined
  let currentCategory: import('@chatgpt-booster/core').SettingsSection = 'modules'
  const categoryIds = [
    'archive',
    'modules',
    'sounds',
    'analytics',
    'other',
    'triggers',
    'remote',
  ] as const
  const restoreCategory = async (categoryId: string) => {
    if (!(categoryIds as readonly string[]).includes(categoryId)) return
    const selected = categoryId === 'other' ? 'modules' : categoryId
    // The caller owns Shell routing. Only this synchronous presentation change
    // precedes persistence; a late storage completion cannot navigate anywhere.
    setChatGptSafeView('settings')
    const updated = await page.settings.update({
      ui: { activeSection: selected as typeof currentCategory },
    })
    currentCategory = updated.ui.activeSection
  }
  let early: Promise<void> | null = null
  let detachObserver: (() => void) | null = null
  const startEarly = () => {
    if (!early) {
      detachObserver = observer?.install() ?? null
      early = page.startEarly().catch((error) => {
        detachObserver?.()
        detachObserver = null
        early = null
        throw error
      })
    }
    return early
  }
  const reveal = (section: 'archive' | 'settings' | 'capture' | 'collect' | 'export') => {
    if (section === 'archive' || section === 'settings' || section === 'capture')
      setChatGptSafeView(section)
    else chatGptViewRevision.value++
    chatGptRequestedSection.value = section
    window.dispatchEvent(
      new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: 'chatgpt-booster' } }),
    )
  }
  const onArchive = (event: Event) => {
    const detail = (event as CustomEvent<ArchiveCaptureContext | undefined>).detail
    chatGptArchiveRequest.value =
      detail && ['project', 'conversation'].includes(detail.scope) && typeof detail.id === 'string'
        ? detail
        : null
    reveal('archive')
  }
  const onSettings = () => reveal('settings')
  const onCapture = () => {
    void page.settings.update({ ui: { activeSection: 'archive' } }).catch(() => undefined)
    reveal('capture')
  }
  const metricListeners = new Set<() => void>()
  let metricKey = '',
    metricValue: number | string = '…',
    metricPending = false,
    metricDirty = true
  const notifyMetrics = () => {
    for (const listener of metricListeners) {
      try {
        listener()
      } catch {}
    }
  }
  const feature: Feature = {
    id: 'chatgpt-booster',
    title: 'ChatGPT Booster',
    legacyLanguagePreference: async () => (await page.settings.get()).language,
    presentation: {
      panel: 'wide',
      version: BOOSTER_VERSION,
      installation: target.label,
      onViewHidden: () => {
        chatGptRequestedSection.value = null
        chatGptArchiveRequest.value = null
      },
    },
    launcher: { mode: 'quick-menu' },
    indicators: {
      current() {
        const automation = page.automation.status(),
          id = page.fixedArchive.currentConversationId()
        const remoteOnly = Boolean(
          indicatorSettings?.automation.remote.enabled &&
            indicatorSettings.automation.remote.mode === 'remote-only',
        )
        const rule =
          indicatorSettings && id
            ? resolveCaptureRule(indicatorSettings.archive, id, page.archiveAdapter.currentProjectId())
                .rule
            : null
        return chatGptIndicators(automation, page.fixedArchive.collectionSession.snapshot(), {
          enabled: Boolean(
            automation.verifiedOwner && indicatorSettings?.enabled && (remoteOnly || rule?.enabled),
          ),
          failed: page.fixedArchive.captureFailed(),
          remoteOnly,
        })
      },
      subscribe(listener) {
        let active = true
        void page.settings
          .get()
          .then((settings) => {
            if (active) {
              indicatorSettings = settings
              listener()
            }
          })
          .catch(() => undefined)
        const settings = page.settings.subscribe((value) => {
          indicatorSettings = value
          listener()
        })
        const automation = page.automation.subscribe(listener),
          saved = page.fixedArchive.subscribeSaved(listener)
        const collection = page.fixedArchive.collectionSession.subscribe(listener)
        return () => {
          active = false
          settings()
          automation()
          saved()
          collection()
        }
      },
    },
    modules: [
      {
        id: 'sounds',
        title: 'Звуки',
        titleEn: 'Sounds',
        description: 'Уведомления по событиям ChatGPT',
        descriptionEn: 'Notifications for ChatGPT events',
        defaultEnabled: true,
        settingsCategory: 'sounds',
        start: () => page.sounds.start(),
        stop: () => page.sounds.stop(),
      },
    ],
    settings: {
      currentCategory: () =>
        chatGptSafeView.value === 'settings'
          ? currentCategory === 'other'
            ? 'modules'
            : currentCategory
          : '',
      restoreCategory,
      subscribe(listener) {
        let active = true,
          previous = currentCategory
        const update = (settings: import('@chatgpt-booster/core').BoosterSettings) => {
          if (!active) return
          currentCategory = settings.ui.activeSection
          if (previous !== currentCategory) {
            previous = currentCategory
            listener()
          }
        }
        void page.settings
          .get()
          .then(update)
          .catch(() => undefined)
        const unsubscribe = page.settings.subscribe(update)
        const unwatchView = watch(
          chatGptSafeView,
          () => {
            if (active) listener()
          },
          { flush: 'sync' },
        )
        return () => {
          active = false
          unsubscribe()
          unwatchView()
        }
      },
      categories: [
        {
          id: 'archive',
          title: 'Архив и сохранение',
          titleEn: 'Archive and capture',
          description: 'Политика захвата, история и чтение',
          descriptionEn: 'Capture policy, history and reading',
        },
        {
          id: 'modules',
          title: 'Модули ChatGPT',
          titleEn: 'ChatGPT modules',
          description: 'Метаданные, активность, таймер и инструменты',
          descriptionEn: 'Metadata, activity, timer and tools',
        },
        {
          id: 'sounds',
          title: 'Звуки',
          titleEn: 'Sounds',
          description: 'Отправка, завершение ответа и конец контекста',
          descriptionEn: 'Sending, response completion and context limits',
        },
        {
          id: 'triggers',
          title: 'Триггеры',
          titleEn: 'Triggers',
          description: 'События, условия и действия',
          descriptionEn: 'Events, conditions and actions',
        },
        {
          id: 'remote',
          title: 'Сервер и синхронизация',
          titleEn: 'Server and sync',
          description: 'WebSocket, очередь и удалённые команды',
          descriptionEn: 'WebSocket, queue and remote commands',
        },
        {
          id: 'analytics',
          title: 'Сетевая активность',
          titleEn: 'Network activity',
          description: 'Локальные технические счётчики',
          descriptionEn: 'Local technical counters',
        },
      ],
      async open(categoryId) {
        if (!(categoryIds as readonly string[]).includes(categoryId)) return
        reveal('settings')
        await restoreCategory(categoryId)
      },
    },
    async backup() {
      const owner = page.archiveAdapter.currentAccountId?.()
      const scoped = <T>(port: import('@kobaproduction/browser-storage').PersistentSettingsPort<T>) => ({
        ...port,
        scope: {
          ...port.scope,
          installationId: `${port.scope.productId}-${target.label === 'Tampermonkey' ? 'userscript' : 'chromium'}`,
        },
      })
      const sources = [
        owner
          ? createSettingsBackupSource(
              'chatgpt-booster.settings',
              'Настройки ChatGPT',
              scoped(chatGptCompleteSettingsBackupPort(page.settings, owner)),
            )
          : createSettingsBackupSource(
              'chatgpt-booster.settings',
              'Настройки ChatGPT',
              scoped(chatGptSettingsBackupPort(page.settings)),
            ),
      ]
      if (owner)
        sources.push(
          createIndexedBackupSource(
            'chatgpt-booster.indexeddb',
            'Архив ChatGPT',
            page.fixedArchive.backupPort(),
          ),
        )
      return sources
    },
    subscribeQuickContext(listener) {
      metricListeners.add(listener)
      const received = page.observations.subscribeCounts(listener)
      const saved = page.fixedArchive.subscribeCounts(() => {
        metricDirty = true
        listener()
      })
      return () => {
        metricListeners.delete(listener)
        received()
        saved()
      }
    },
    async quickMetrics() {
      const id = page.archiveAdapter.currentConversationId()
      const scope = page.observations.scope()
      if (!id || !scope.ownerId) return []
      const key = JSON.stringify([scope.ownerId, scope.epoch, id])
      if (key !== metricKey) {
        metricKey = key
        metricValue = '…'
        metricPending = false
        metricDirty = true
      }
      const owns = () =>
        metricKey === key &&
        page.observations.scope().ownerId === scope.ownerId &&
        page.observations.scope().epoch === scope.epoch &&
        page.archiveAdapter.currentConversationId() === id
      if (metricDirty && !metricPending) {
        metricPending = true
        metricDirty = false
        void page.fixedArchive
          .savedCount(id)
          .then((count) => {
            if (owns()) {
              metricValue = count
              metricPending = false
              notifyMetrics()
            }
          })
          .catch(() => {
            if (owns()) {
              metricValue = '—'
              metricPending = false
              notifyMetrics()
            }
          })
      }
      return [
        {
          label: 'Получено сообщений',
          labelEn: 'Received messages',
          value: page.observations.receivedCount(id),
        },
        { label: 'Сохранено сообщений', labelEn: 'Saved messages', value: metricValue },
      ]
    },
    quickActions: [
      {
        id: 'settings',
        label: 'Настройки',
        labelEn: 'Settings',
        icon: 'settings',
        availableWhenDisabled: true,
        run: () => reveal('settings'),
      },
      {
        id: 'archive',
        label: 'Открыть архив',
        labelEn: 'Open archive',
        icon: 'archive',
        run: () => reveal('archive'),
      },
      {
        id: 'collect',
        label: 'Собрать историю',
        labelEn: 'Collect history',
        icon: 'collect',
        enabled: () => Boolean(page.archiveAdapter.currentConversationId()),
        run: () => reveal('collect'),
      },
      {
        id: 'export',
        label: 'Экспорт сохранённого чата',
        labelEn: 'Export saved conversation',
        icon: 'export',
        enabled: () => Boolean(page.archiveAdapter.currentConversationId()),
        run: () => reveal('export'),
      },
    ],
    description: 'Архив диалогов, исходные метаданные, экспорт, инструменты и аналитика',
    descriptionEn: 'Conversation archive, source metadata, export, tools and analytics',
    targets: ['userscript', 'chromium'],
    requiredCapabilities: ['page-dom', 'origin-storage', 'local-files'],
    match: (url) => url.hostname === 'chatgpt.com',
    async start() {
      currentCategory = (await page.settings.get()).ui.activeSection
      await startEarly()
      await page.runtime.start()
      window.addEventListener(OPEN_ARCHIVE_EVENT, onArchive)
      window.addEventListener(OPEN_SETTINGS_EVENT, onSettings)
      window.addEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onCapture)
      chatGptViewContext.value = {
        archiveAdapter: page.archiveAdapter,
        ...(page.fixedArchive ? { fixedArchive: page.fixedArchive } : {}),
        settingsAdapter: page.settings,
        automationControl: page.automation,
        diagnosticsAdapter: target.diagnostics,
        targetLabel: target.label,
        ...(target.persistentDiagnostics
          ? { persistentDiagnosticsAdapter: target.persistentDiagnostics }
          : {}),
        ...(target.secrets ? { secretAdapter: target.secrets } : {}),
        ...(target.telemetryControl ? { telemetryControlAdapter: target.telemetryControl } : {}),
      }
    },
    async stop() {
      chatGptViewContext.value = null
      chatGptRequestedSection.value = null
      chatGptArchiveRequest.value = null
      chatGptViewRevision.value++
      window.removeEventListener(OPEN_ARCHIVE_EVENT, onArchive)
      window.removeEventListener(OPEN_SETTINGS_EVENT, onSettings)
      window.removeEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onCapture)
      try {
        await page.runtime.stop()
      } finally {
        try {
          // startEarly can run before BoosterRuntime owns its active modules.
          await page.stopEarly()
        } finally {
          // Never leave MAIN-world interceptors installed on a failed teardown.
          detachObserver?.()
          detachObserver = null
          early = null
          metricKey = ''
          metricValue = '…'
          metricPending = false
          metricDirty = true
        }
      }
    },
    open() {
      window.dispatchEvent(
        new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: 'chatgpt-booster' } }),
      )
    },
  }
  return { feature, startEarly }
}
