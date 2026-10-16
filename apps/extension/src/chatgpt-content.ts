import { createDiagnosticsStore, isChatGptPage } from '@chatgpt-booster/core'
import { chromeAnalytics, chromeSettings } from '@chatgpt-booster/extension/services'
import { TRANSPORT_CHANNEL } from '@chatgpt-booster/observer'
import type { ApplicationTelemetryController } from '@kobaproduction/browser-core'
import { createChatGptBoosterFeature } from '@kobaproduction/module-chatgpt-booster'
export function createChatGptChromeFeature(applicationTelemetry?: ApplicationTelemetryController) {
  if (!isChatGptPage()) throw new Error('ChatGPT feature requested on the wrong origin')
  const { feature, startEarly } = createChatGptBoosterFeature(
    {
      label: 'Chromium',
      settings: chromeSettings,
      diagnostics: createDiagnosticsStore(),
      persistentDiagnostics: chromeAnalytics,
      applicationTelemetry,
    },
    {
      install: () => {
        window.postMessage({ channel: TRANSPORT_CHANNEL, type: 'koba:observer:enable' }, location.origin)
        return () => {
          window.postMessage(
            { channel: TRANSPORT_CHANNEL, type: 'koba:observer:disable' },
            location.origin,
          )
        }
      },
    },
  )
  return { feature, startEarly }
}
