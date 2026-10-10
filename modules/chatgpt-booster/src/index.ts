import { SHELL_OPEN_FEATURE_EVENT, type Feature } from '@kobaproduction/browser-core'
import { createBoosterPageRuntime, type BoosterTargetAdapter } from '@chatgpt-booster/features'
import { OPEN_ARCHIVE_EVENT, OPEN_SETTINGS_EVENT, OPEN_CAPTURE_SETTINGS_EVENT } from '@chatgpt-booster/core'
import { shallowRef, ref } from 'vue'
import type { ArchiveDataAdapter } from '@chatgpt-booster/ui'
import type { SettingsAdapter, TransportDiagnosticsAdapter, PersistentDiagnosticsAdapter, SecretAdapter, TelemetryControlAdapter } from '@chatgpt-booster/core'

export interface ChatGptViewContext {
  archiveAdapter: ArchiveDataAdapter
  settingsAdapter: SettingsAdapter
  diagnosticsAdapter: TransportDiagnosticsAdapter
  persistentDiagnosticsAdapter?: PersistentDiagnosticsAdapter
  secretAdapter?: SecretAdapter
  telemetryControlAdapter?: TelemetryControlAdapter
  targetLabel: string
}

/** Per-provider service composition; a shared shell owns the only launcher. */
export const chatGptViewContext = shallowRef<ChatGptViewContext | null>(null)
export const chatGptRequestedSection = ref<'archive' | 'settings' | 'capture' | null>(null)

export interface ChatGptObserverLifecycle {
  /** Install a reversible page-world transport observer only while enabled. */
  install(): () => void
}

export function createChatGptBoosterFeature(
  target: BoosterTargetAdapter,
  observer?: ChatGptObserverLifecycle,
) {
  const page = createBoosterPageRuntime({ target, mountUi: false })
  let early: Promise<void> | null = null
  let detachObserver: (() => void) | null = null
  const startEarly = () => {
    if (!early) {
      detachObserver = observer?.install() ?? null
      early = page.startEarly().catch(error => {
        detachObserver?.()
        detachObserver = null
        early = null
        throw error
      })
    }
    return early
  }
  const reveal = (section: 'archive' | 'settings' | 'capture') => {
    chatGptRequestedSection.value = section
    window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: 'chatgpt-booster' } }))
  }
  const onArchive = () => reveal('archive')
  const onSettings = () => reveal('settings')
  const onCapture = () => {
    void page.settings.update({ ui: { activeSection: 'archive' } }).catch(() => undefined)
    reveal('capture')
  }
  const feature: Feature = {
    id: 'chatgpt-booster',
    title: 'ChatGPT Booster',
    presentation: { panel: 'wide' },
    description: 'Архив диалогов, исходные метаданные, экспорт, инструменты и аналитика',
    targets: ['userscript', 'chromium'],
    requiredCapabilities: ['page-dom', 'origin-storage', 'local-files'],
    match: (url) => url.hostname === 'chatgpt.com',
    async start() {
      await startEarly()
      await page.runtime.start()
      window.addEventListener(OPEN_ARCHIVE_EVENT, onArchive)
      window.addEventListener(OPEN_SETTINGS_EVENT, onSettings)
      window.addEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onCapture)
      chatGptViewContext.value = {
        archiveAdapter: page.archiveAdapter,
        settingsAdapter: page.settings,
        diagnosticsAdapter: target.diagnostics,
        targetLabel: target.label,
        ...(target.persistentDiagnostics ? { persistentDiagnosticsAdapter: target.persistentDiagnostics } : {}),
        ...(target.secrets ? { secretAdapter: target.secrets } : {}),
        ...(target.telemetryControl ? { telemetryControlAdapter: target.telemetryControl } : {}),
      }
    },
    async stop() {
      chatGptViewContext.value = null
      chatGptRequestedSection.value = null
      window.removeEventListener(OPEN_ARCHIVE_EVENT, onArchive)
      window.removeEventListener(OPEN_SETTINGS_EVENT, onSettings)
      window.removeEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onCapture)
      await page.runtime.stop()
      detachObserver?.()
      detachObserver = null
      early = null
    },
    open() {
      window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: 'chatgpt-booster' } }))
    },
  }
  return { feature, startEarly }
}
