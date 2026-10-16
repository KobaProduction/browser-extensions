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
import { vkBoosterFeature } from '@kobaproduction/module-vk-booster'
import ArchivePanel from '@kobaproduction/module-vk-booster/ui'
import { createChatGptChromeFeature } from './chatgpt-content'

const url = new URL(location.href)
const chatgpt = isChatGptPage()
if ((chatgpt || vkBoosterFeature.match(url)) && isDevelopmentContextAllowed('chromium')) {
  const telemetry = createApplicationTelemetry('chromium', createSettingsStore('chromium'))
  const chatFeature = chatgpt ? createChatGptChromeFeature(telemetry) : null
  const feature = chatFeature?.feature ?? vkBoosterFeature
  if (chatFeature) {
    void new FeatureSettings(createSettingsStore('chromium'))
      .enabled('chatgpt-booster')
      .then(async (enabled) =>
        enabled && (await new FeatureSettings(createSettingsStore('chromium')).installationEnabled())
          ? chatFeature.startEarly()
          : undefined,
      )
      .catch((error) =>
        console.warn(
          '[ChatGPT Booster] Early capture failed',
          error instanceof Error ? error.name : 'unknown',
        ),
      )
  }
  const runtime = new FeatureRuntime(
    [feature],
    {
      target: 'chromium',
      url,
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
      title: 'Koba Browser Tools',
      views: chatgpt ? { 'chatgpt-booster': ChatGptPanel } : { 'vk-booster': ArchivePanel },
    })
    bindBrowserToolsMessages(runtime, ui)
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => void launch(), { once: true })
  else void launch()
}
