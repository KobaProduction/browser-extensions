import { isChatGptPage } from '@chatgpt-booster/core'
import {
  bindBrowserToolsMessages,
  createApplicationBackup,
  createApplicationTelemetry,
  createRuntimeTelemetry,
  createSettingsStore,
  createTelemetryBackupSource,
  getApplicationIdentity,
  isDevelopmentContextAllowed,
  onInstallationStateChange,
} from '@kobaproduction/browser-adapters'
import { type Capability, FeatureRuntime, FeatureSettings } from '@kobaproduction/browser-core'
import { mountControlCenter } from '@kobaproduction/browser-shell'
import ChatGptPanel from '@kobaproduction/module-chatgpt-booster/ui'
import { createChatGptChromeFeature } from './chatgpt-content'

if (isChatGptPage() && isDevelopmentContextAllowed('chromium')) {
  const telemetry = createApplicationTelemetry('chromium', createSettingsStore('chromium'))
  const { feature, startEarly } = createChatGptChromeFeature(telemetry)
  void new FeatureSettings(createSettingsStore('chromium'))
    .enabled('chatgpt-booster')
    .then(async (enabled) =>
      enabled && (await new FeatureSettings(createSettingsStore('chromium')).installationEnabled())
        ? startEarly()
        : undefined,
    )
    .catch((error) =>
      console.warn(
        '[ChatGPT Booster] Early capture failed',
        error instanceof Error ? error.name : 'unknown',
      ),
    )
  const runtime = new FeatureRuntime(
    [feature],
    {
      target: 'chromium',
      url: new URL(location.href),
      capabilities: new Set<Capability>(['page-dom', 'origin-storage', 'local-files']),
      settings: new FeatureSettings(createSettingsStore('chromium')),
    },
    createRuntimeTelemetry(telemetry),
  )
  const unsubscribeState = onInstallationStateChange('chromium', () => {
    void runtime.refreshFromSettings()
  })
  window.addEventListener(
    'pagehide',
    () => {
      unsubscribeState()
      telemetry.close()
    },
    { once: true },
  )
  const launch = async () => {
    await runtime.start()
    const ui = mountControlCenter({
      runtime,
      telemetry,
      backup: createApplicationBackup(
        'chromium',
        runtime,
        [async () => [await createTelemetryBackupSource(telemetry, 'chromium')]],
        telemetry,
      ),
      application: getApplicationIdentity('chromium'),
      title: 'ChatGPT Booster',
      views: { 'chatgpt-booster': ChatGptPanel },
    })
    bindBrowserToolsMessages(runtime, ui)
  }
  if (document.body) void launch()
  else window.addEventListener('DOMContentLoaded', () => void launch(), { once: true })
}
