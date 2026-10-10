import { createDiagnosticsStore, isChatGptPage } from '@chatgpt-booster/core'
import { createSettingsStore } from '@kobaproduction/browser-adapters'
import {
  type Capability,
  FeatureRuntime,
  FeatureSettings,
  SHELL_OPEN_FEATURE_EVENT,
} from '@kobaproduction/browser-core'
import { mountControlCenter } from '@kobaproduction/browser-shell'
import { createChatGptBoosterFeature } from '@kobaproduction/module-chatgpt-booster'
import ChatGptPanel from '@kobaproduction/module-chatgpt-booster/ui'
import { chromeAnalytics } from '../../../modules/chatgpt-booster/packages/extension/src/analytics'
import { chromeSettings } from '../../../modules/chatgpt-booster/packages/extension/src/settings'
import {
  chromeSecrets,
  createChromeTelemetry,
  createChromeTelemetryControl,
} from '../../../modules/chatgpt-booster/packages/extension/src/telemetry'

if (isChatGptPage()) {
  const telemetry = createChromeTelemetry(chromeSettings)
  const { feature, startEarly } = createChatGptBoosterFeature({
    label: 'Chromium',
    settings: chromeSettings,
    diagnostics: createDiagnosticsStore(),
    persistentDiagnostics: chromeAnalytics,
    secrets: chromeSecrets,
    telemetry,
    telemetryControl: createChromeTelemetryControl(telemetry, chromeSettings),
  })
  // MAIN-world observer is a separate manifest script at document_start.
  void new FeatureSettings(createSettingsStore('chromium'))
    .enabled('chatgpt-booster')
    .then((enabled) => (enabled ? startEarly() : undefined))
    .catch((error) =>
      console.warn(
        '[ChatGPT Booster] Early capture failed',
        error instanceof Error ? error.name : 'unknown',
      ),
    )
  const runtime = new FeatureRuntime([feature], {
    target: 'chromium',
    url: new URL(location.href),
    capabilities: new Set<Capability>(['page-dom', 'origin-storage', 'local-files']),
    settings: new FeatureSettings(createSettingsStore('chromium')),
  })
  const start = async () => {
    await runtime.start()
    const shell = mountControlCenter({
      runtime,
      title: 'ChatGPT Booster',
      views: { 'chatgpt-booster': ChatGptPanel },
    })
    chrome.runtime.onMessage.addListener((message: { type?: string; id?: string }, _, sendResponse) => {
      if (message?.type === 'koba:open') {
        shell.open()
        sendResponse({ ok: true })
        return
      }
      if (message?.type === 'koba:open-feature' && message.id === 'chatgpt-booster') {
        shell.open()
        window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: message.id } }))
        sendResponse({ ok: true })
        return
      }
      if (message?.type === 'koba:list') sendResponse({ features: runtime.list() })
    })
  }
  if (document.body) void start()
  else window.addEventListener('DOMContentLoaded', () => void start(), { once: true })
}
