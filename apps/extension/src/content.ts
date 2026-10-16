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
import { vkBoosterFeature } from '@kobaproduction/module-vk-booster'
import ArchivePanel from '@kobaproduction/module-vk-booster/ui'

if (isDevelopmentContextAllowed('chromium')) {
  const telemetry = createApplicationTelemetry('chromium', createSettingsStore('chromium'))
  const runtime = new FeatureRuntime(
    [vkBoosterFeature],
    {
      target: 'chromium',
      url: new URL(location.href),
      // The current manifest does not grant proxy or user-agent powers.
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
  async function launch() {
    await runtime.start()
    const ui = mountControlCenter({
      runtime,
      launcher: true,
      views: { 'vk-booster': ArchivePanel },
      telemetry,
      backup: createApplicationBackup(
        'chromium',
        runtime,
        [async () => [await createTelemetryBackupSource(telemetry, 'chromium')]],
        telemetry,
      ),
      application: getApplicationIdentity('chromium'),
    })
    bindBrowserToolsMessages(runtime, ui)
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => void launch(), { once: true })
  else void launch()
}
