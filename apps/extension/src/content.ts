import { createSettingsStore } from '@kobaproduction/browser-adapters'
import { type Capability, FeatureRuntime, FeatureSettings } from '@kobaproduction/browser-core'
import { mountControlCenter } from '@kobaproduction/browser-shell'
import { vkBoosterFeature } from '@kobaproduction/module-vk-booster'
import ArchivePanel from '@kobaproduction/module-vk-booster/ui'

const runtime = new FeatureRuntime([vkBoosterFeature], {
  target: 'chromium',
  url: new URL(location.href),
  // The current manifest does not grant proxy or user-agent powers.
  capabilities: new Set<Capability>(['page-dom', 'origin-storage', 'local-files']),
  settings: new FeatureSettings(createSettingsStore('chromium')),
})
async function launch() {
  await runtime.start()
  const ui = mountControlCenter({ runtime, launcher: true, views: { 'vk-booster': ArchivePanel } })
  chrome.runtime.onMessage.addListener(
    (message: { type?: string; id?: string; enabled?: boolean }, _, sendResponse) => {
      if (message?.type === 'koba:installation-status') {
        sendResponse({ enabled: runtime.isRunning(), features: runtime.list() })
        return
      }
      if (message?.type === 'koba:installation-set-running') {
        if (typeof message.enabled !== 'boolean') {
          sendResponse({ ok: false })
          return
        }
        void runtime
          .setRunning(message.enabled)
          .then(() => sendResponse({ ok: true, enabled: runtime.isRunning() }))
          .catch(() => sendResponse({ ok: false }))
        return true
      }
      if (message?.type === 'koba:open') {
        ui.open()
        sendResponse({ ok: true })
        return
      }
      if (message?.type === 'koba:open-feature' && message.id) {
        void runtime.open(message.id)
        sendResponse({ ok: true })
        return
      }
      if (message?.type === 'koba:list') {
        sendResponse({ features: runtime.list() })
      }
    },
  )
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', () => void launch(), { once: true })
else void launch()
