import {
  createApplicationTelemetry,
  createSettingsStore,
  onInstallationStateChange,
} from '@kobaproduction/browser-adapters'
import {
  defaultCapabilities,
  type Feature,
  FeatureRuntime,
  FeatureSettings,
} from '@kobaproduction/browser-core'
import { mountControlCenter } from '@kobaproduction/browser-shell'
import type { Component } from 'vue'
export function bootstrapUserscript(
  features: Feature[],
  title = 'Koba Browser Tools',
  views: Record<string, Component> = {},
) {
  const telemetry = createApplicationTelemetry('userscript', createSettingsStore('userscript'))
  const runtime = new FeatureRuntime(features, {
    target: 'userscript',
    url: new URL(location.href),
    capabilities: defaultCapabilities('userscript'),
    settings: new FeatureSettings(createSettingsStore('userscript')),
  })
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
  let open: () => void = () => {}
  const launch = async () => {
    await runtime.start()
    const ui = mountControlCenter({ runtime, title, launcher: true, views, telemetry })
    open = ui.open
  }
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Открыть ' + title, () => open())
    GM_registerMenuCommand('Включить/выключить эту установку', () => {
      void runtime.setRunning(!runtime.isRunning())
    })
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => void launch(), { once: true })
  else void launch()
}
declare function GM_registerMenuCommand(title: string, callback: () => void): unknown
