import { createDiagnosticsStore, isChatGptPage } from '@chatgpt-booster/core'
import { installTransportObserver } from '@chatgpt-booster/observer'
import { userscriptAnalytics, userscriptSettings } from '@chatgpt-booster/userscript/services'
import { createSettingsStore } from '@kobaproduction/browser-adapters'
import { type ApplicationTelemetryController, FeatureSettings } from '@kobaproduction/browser-core'
import { createChatGptBoosterFeature } from '@kobaproduction/module-chatgpt-booster'

declare const unsafeWindow: Window
/** One delivery adapter for the standalone ChatGPT script and all-in-one.
 * Creating it is allowed only on chatgpt.com; capture follows feature enablement. */
export function createChatGptUserscriptFeature(applicationTelemetry?: ApplicationTelemetryController) {
  if (!isChatGptPage()) throw new Error('ChatGPT feature requested on the wrong origin')
  const bridge = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window) as Window &
    typeof globalThis
  // Install observation before DOMContentLoaded; saved history must never wait
  // for opening the shared Control Center.
  const { feature, startEarly } = createChatGptBoosterFeature(
    {
      label: 'Tampermonkey',
      settings: userscriptSettings,
      diagnostics: createDiagnosticsStore(),
      persistentDiagnostics: userscriptAnalytics,
      applicationTelemetry,
      pageBridgeWindow: bridge,
    },
    { install: () => installTransportObserver(bridge) },
  )
  // Respect the shared module switch before enabling any native history capture.
  // The active feature's start() also invokes startEarly() after a later enable.
  void new FeatureSettings(createSettingsStore('userscript'))
    .enabled('chatgpt-booster')
    .then(async (enabled) => {
      if (
        !enabled ||
        !(await new FeatureSettings(createSettingsStore('userscript')).installationEnabled())
      )
        return
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
