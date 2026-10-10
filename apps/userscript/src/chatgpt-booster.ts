import { createDiagnosticsStore, isChatGptPage } from '@chatgpt-booster/core'
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
  installTransportObserver(bridge)
  const telemetry = createUserscriptTelemetry(userscriptSettings)
  const { feature, startEarly } = createChatGptBoosterFeature({
    label: 'Tampermonkey', settings: userscriptSettings,
    diagnostics: createDiagnosticsStore(), persistentDiagnostics: userscriptAnalytics,
    secrets: userscriptSecrets, telemetry, telemetryControl: createUserscriptTelemetryControl(telemetry),
    pageBridgeWindow: bridge,
  })
  void startEarly().catch(error => console.warn('[ChatGPT Booster] Early capture failed', error instanceof Error ? error.name : 'unknown'))
  bootstrapUserscript([feature], 'ChatGPT Booster', { 'chatgpt-booster': ChatGptPanel })
}
