import { createDiagnosticsStore, isChatGptPage } from '@chatgpt-booster/core'
import { TRANSPORT_CHANNEL } from '@chatgpt-booster/observer'
import { createChatGptBoosterFeature } from '@kobaproduction/module-chatgpt-booster'
import { chromeAnalytics } from '../../../modules/chatgpt-booster/packages/extension/src/analytics'
import { chromeSettings } from '../../../modules/chatgpt-booster/packages/extension/src/settings'
import {
  chromeSecrets,
  createChromeTelemetry,
  createChromeTelemetryControl,
} from '../../../modules/chatgpt-booster/packages/extension/src/telemetry'

export function createChatGptChromeFeature() {
  if (!isChatGptPage()) throw new Error('ChatGPT feature requested on the wrong origin')
  const telemetry = createChromeTelemetry(chromeSettings)
  const { feature, startEarly } = createChatGptBoosterFeature(
    {
      label: 'Chromium',
      settings: chromeSettings,
      diagnostics: createDiagnosticsStore(),
      persistentDiagnostics: chromeAnalytics,
      secrets: chromeSecrets,
      telemetry,
      telemetryControl: createChromeTelemetryControl(telemetry, chromeSettings),
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
