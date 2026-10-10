import { createDiagnosticsStore, isChatGptPage } from '@chatgpt-booster/core'
import { FeatureSettings } from '@kobaproduction/browser-core'
import { createSettingsStore } from '@kobaproduction/browser-adapters'
import { installTransportObserver } from '@chatgpt-booster/observer'
import { userscriptSettings } from '../../../modules/chatgpt-booster/packages/userscript/src/settings'
import { userscriptAnalytics } from '../../../modules/chatgpt-booster/packages/userscript/src/analytics'
import { userscriptSecrets, createUserscriptTelemetry, createUserscriptTelemetryControl } from '../../../modules/chatgpt-booster/packages/userscript/src/telemetry'
import { createChatGptBoosterFeature } from '@kobaproduction/module-chatgpt-booster'
import ChatGptPanel from '@kobaproduction/module-chatgpt-booster/ui'
import { bootstrapUserscript } from './runtime'

declare const unsafeWindow: Window
if (isChatGptPage()) {
  const bridge = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window) as Window & typeof globalThis
  // Install observation before DOMContentLoaded; saved history must never wait
  // for opening the shared Control Center.
  const telemetry = createUserscriptTelemetry(userscriptSettings)
  const { feature, startEarly } = createChatGptBoosterFeature({
    label: 'Tampermonkey', settings: userscriptSettings,
    diagnostics: createDiagnosticsStore(), persistentDiagnostics: userscriptAnalytics,
    secrets: userscriptSecrets, telemetry, telemetryControl: createUserscriptTelemetryControl(telemetry),
    pageBridgeWindow: bridge,
  }, { install: () => installTransportObserver(bridge) })
  // Respect the shared module switch before enabling any native history capture.
  // The active feature's start() also invokes startEarly() after a later enable.
  void new FeatureSettings(createSettingsStore('userscript'))
    .enabled('chatgpt-booster')
    .then((enabled) => {
      if (!enabled) return
      return startEarly()
    })
    .catch(error => console.warn('[ChatGPT Booster] Early capture failed', error instanceof Error ? error.name : 'unknown'))
  bootstrapUserscript([feature], 'ChatGPT Booster', { 'chatgpt-booster': ChatGptPanel })
}
