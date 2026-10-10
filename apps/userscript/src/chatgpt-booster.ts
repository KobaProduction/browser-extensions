import { createDiagnosticsStore, isChatGptPage } from '@chatgpt-booster/core'
import { installTransportObserver } from '@chatgpt-booster/observer'
import { createSettingsStore } from '@kobaproduction/browser-adapters'
import { FeatureSettings } from '@kobaproduction/browser-core'
import { createChatGptBoosterFeature } from '@kobaproduction/module-chatgpt-booster'
import { userscriptAnalytics } from '../../../modules/chatgpt-booster/packages/userscript/src/analytics'
import { userscriptSettings } from '../../../modules/chatgpt-booster/packages/userscript/src/settings'
import {
  createUserscriptTelemetry,
  createUserscriptTelemetryControl,
  userscriptSecrets,
} from '../../../modules/chatgpt-booster/packages/userscript/src/telemetry'

declare const unsafeWindow: Window
/** One delivery adapter for the standalone ChatGPT script and all-in-one.
 * Creating it is allowed only on chatgpt.com; capture follows feature enablement. */
export function createChatGptUserscriptFeature() {
  if (!isChatGptPage()) throw new Error('ChatGPT feature requested on the wrong origin')
  const bridge = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window) as Window &
    typeof globalThis
  // Install observation before DOMContentLoaded; saved history must never wait
  // for opening the shared Control Center.
  const telemetry = createUserscriptTelemetry(userscriptSettings)
  const { feature, startEarly } = createChatGptBoosterFeature(
    {
      label: 'Tampermonkey',
      settings: userscriptSettings,
      diagnostics: createDiagnosticsStore(),
      persistentDiagnostics: userscriptAnalytics,
      secrets: userscriptSecrets,
      telemetry,
      telemetryControl: createUserscriptTelemetryControl(telemetry),
      pageBridgeWindow: bridge,
    },
    { install: () => installTransportObserver(bridge) },
  )
  // Respect the shared module switch before enabling any native history capture.
  // The active feature's start() also invokes startEarly() after a later enable.
  void new FeatureSettings(createSettingsStore('userscript'))
    .enabled('chatgpt-booster')
    .then((enabled) => {
      if (!enabled) return
      return startEarly()
    })
    .catch((error) =>
      console.warn(
        '[ChatGPT Booster] Early capture failed',
        error instanceof Error ? error.name : 'unknown',
      ),
    )
  return feature
}
