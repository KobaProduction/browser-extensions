import { mountControlCenter } from '@chatgpt-booster/ui'
import { chromeAnalytics } from '../analytics'
import { chromeSettings } from '../settings'
import { chromeSecrets, createChromeTelemetry, createChromeTelemetryControl } from '../telemetry'

document.body.style.margin = '0'
document.body.style.minWidth = '620px'

const host = document.getElementById('app')
if (!host) throw new Error('Popup mount point is missing')

const telemetry = createChromeTelemetry(chromeSettings)

mountControlCenter(host, {
  settingsAdapter: chromeSettings,
  persistentDiagnosticsAdapter: chromeAnalytics,
  secretAdapter: chromeSecrets,
  telemetryControlAdapter: createChromeTelemetryControl(telemetry),
  target: 'extension',
})
