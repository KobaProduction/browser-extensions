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
      .then((enabled) => (enabled ? chatFeature.startEarly() : undefined))
      .catch((error) =>
        console.warn(
          '[ChatGPT Booster] Early capture failed',
          error instanceof Error ? error.name : 'unknown',
        ),
      )
  }
  const runtime = new FeatureRuntime([feature], {
    target: 'chromium',
    url,
    capabilities: new Set<Capability>(['page-dom', 'origin-storage', 'local-files']),
    settings: new FeatureSettings(createSettingsStore('chromium')),
  })
  const launch = async () => {
    await runtime.start()
    const ui = mountControlCenter({
      runtime,
      title: 'Koba Browser Tools',
      views: chatgpt ? { 'chatgpt-booster': ChatGptPanel } : { 'vk-booster': ArchivePanel },
    })
    chrome.runtime.onMessage.addListener((message: { type?: string; id?: string }, _, respond) => {
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
    })
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => void launch(), { once: true })
  else void launch()
}
