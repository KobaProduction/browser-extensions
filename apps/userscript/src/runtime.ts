import {
  createApplicationBackup,
  createApplicationTelemetry,
  createRuntimeTelemetry,
  createSettingsStore,
  createTelemetryBackupSource,
  getApplicationIdentity,
  isDevelopmentContextAllowed,
  onInstallationStateChange,
} from '@kobaproduction/browser-adapters'
import {
  type ApplicationTelemetryController,
  defaultCapabilities,
  type Feature,
  FeatureRuntime,
  FeatureSettings,
} from '@kobaproduction/browser-core'
import { mountControlCenter } from '@kobaproduction/browser-shell'
import type { Component } from 'vue'
export function bootstrapUserscript(
  features: Feature[] | ((telemetry: ApplicationTelemetryController) => Feature[]),
  title = 'Koba Browser Tools',
  views: Record<string, Component> = {},
) {
  if (!isDevelopmentContextAllowed('userscript')) return
  const telemetry = createApplicationTelemetry('userscript', createSettingsStore('userscript'))
  const runtime = new FeatureRuntime(
    typeof features === 'function' ? features(telemetry) : features,
    {
      target: 'userscript',
      url: new URL(location.href),
      capabilities: defaultCapabilities('userscript'),
      settings: new FeatureSettings(createSettingsStore('userscript')),
    },
    createRuntimeTelemetry(telemetry),
  )
  const unsubscribeState = onInstallationStateChange('userscript', () => {
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
  let openSettings: () => void = () => {}
  let openMenu: () => void = () => {}
  const launch = async () => {
    await runtime.start()
    const ui = mountControlCenter({
      runtime,
      title,
      launcher: true,
      views,
      telemetry,
      backup: createApplicationBackup(
        'userscript',
        runtime,
        [async () => [await createTelemetryBackupSource(telemetry, 'userscript')]],
        telemetry,
      ),
      application: getApplicationIdentity('userscript'),
    })
    openSettings = ui.openSettings
    openMenu = ui.openMenu
  }
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Browser Tools — открыть настройки', () => openSettings())
    GM_registerMenuCommand('Browser Tools — показать меню', () => openMenu())
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => void launch(), { once: true })
  else void launch()
}
declare function GM_registerMenuCommand(title: string, callback: () => void): unknown
