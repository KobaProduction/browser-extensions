import { isChatGptPage } from '@chatgpt-booster/core'
import { createSettingsStore } from '@kobaproduction/browser-adapters'
import {
  type Capability,
  FeatureRuntime,
  FeatureSettings,
  SHELL_OPEN_FEATURE_EVENT,
} from '@kobaproduction/browser-core'
import { mountControlCenter } from '@kobaproduction/browser-shell'
import ChatGptPanel from '@kobaproduction/module-chatgpt-booster/ui'
import { createChatGptChromeFeature } from './chatgpt-content'

if (isChatGptPage()) {
  const { feature, startEarly } = createChatGptChromeFeature()
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
  const launch = async () => {
    await runtime.start()
    const ui = mountControlCenter({
      runtime,
      title: 'ChatGPT Booster',
      views: { 'chatgpt-booster': ChatGptPanel },
    })
    chrome.runtime.onMessage.addListener((message: { type?: string; id?: string }, _, respond) => {
      if (message?.type === 'koba:open') {
        ui.open()
        respond({ ok: true })
        return
      }
      if (message?.type === 'koba:open-feature' && message.id === 'chatgpt-booster') {
        ui.open()
        window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id: message.id } }))
        respond({ ok: true })
        return
      }
      if (message?.type === 'koba:list') respond({ features: runtime.list() })
    })
  }
  if (document.body) void launch()
  else window.addEventListener('DOMContentLoaded', () => void launch(), { once: true })
}
