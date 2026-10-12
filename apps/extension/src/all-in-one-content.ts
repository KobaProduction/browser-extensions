import { isChatGptPage } from '@chatgpt-booster/core'
import {
  createApplicationTelemetry,
  createSettingsStore,
  onInstallationStateChange,
} from '@kobaproduction/browser-adapters'
import {
  type Capability,
  FeatureRuntime,
  FeatureSettings,
  SHELL_OPEN_FEATURE_EVENT,
} from '@kobaproduction/browser-core'
import { mountControlCenter } from '@kobaproduction/browser-shell'
import ChatGptPanel from '@kobaproduction/module-chatgpt-booster/ui'
import { vkBoosterFeature } from '@kobaproduction/module-vk-booster'
import ArchivePanel from '@kobaproduction/module-vk-booster/ui'
import { createChatGptChromeFeature } from './chatgpt-content'

const url = new URL(location.href)
const chatgpt = isChatGptPage()
if (chatgpt || vkBoosterFeature.match(url)) {
  const chatFeature = chatgpt ? createChatGptChromeFeature() : null
  const feature = chatFeature?.feature ?? vkBoosterFeature
  if (chatFeature) {
    void new FeatureSettings(createSettingsStore('chromium'))
      .enabled('chatgpt-booster')
      .then(async (enabled) =>
        enabled && (await new FeatureSettings(createSettingsStore('chromium')).installationEnabled())
          ? chatFeature.startEarly()
          : undefined,
      )
      .catch((error) =>
        console.warn(
          '[ChatGPT Booster] Early capture failed',
          error instanceof Error ? error.name : 'unknown',
        ),
      )
  }
  const telemetry = createApplicationTelemetry('chromium', createSettingsStore('chromium'))
  const runtime = new FeatureRuntime([feature], {
    target: 'chromium',
    url,
    capabilities: new Set<Capability>(['page-dom', 'origin-storage', 'local-files']),
    settings: new FeatureSettings(createSettingsStore('chromium')),
  })
  const unsubscribeState = onInstallationStateChange('chromium', () => {
    void runtime.refreshFromSettings()
  })
  window.addEventListener(
    'pagehide',
    () => {
      unsubscribeState()
      telemetry.close()
    },
    { once: true },
  )
  const launch = async () => {
    await runtime.start()
    const ui = mountControlCenter({
      runtime,
      telemetry,
      title: 'Koba Browser Tools',
      views: chatgpt ? { 'chatgpt-booster': ChatGptPanel } : { 'vk-booster': ArchivePanel },
    })
    chrome.runtime.onMessage.addListener(
      (message: { type?: string; id?: string; enabled?: boolean }, _, respond) => {
        if (message?.type === 'koba:installation-status') {
          respond({ enabled: runtime.isRunning(), features: runtime.list() })
          return
        }
        if (message?.type === 'koba:installation-set-running') {
          if (typeof message.enabled !== 'boolean') {
            respond({ ok: false })
            return
          }
          void runtime
            .setRunning(message.enabled)
            .then(() => respond({ ok: true, enabled: runtime.isRunning() }))
            .catch(() => respond({ ok: false }))
          return true
        }
        if (message?.type === 'koba:open') {
          ui.open()
          respond({ ok: true })
          return
        }
        if (message?.type === 'koba:open-feature' && message.id === feature.id) {
          ui.open()
          window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: feature.id } }))
          respond({ ok: true })
          return
        }
        if (message?.type === 'koba:list') respond({ features: runtime.list() })
      },
    )
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => void launch(), { once: true })
  else void launch()
}
