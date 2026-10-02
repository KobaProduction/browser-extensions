import { mountControlCenter } from '@chatgpt-booster/ui'
import { chromeSettings } from '../settings'
import { chromeSecrets } from '../telemetry'

document.body.style.margin = '0'
document.body.style.minWidth = '380px'

const host = document.getElementById('app')
if (!host) throw new Error('Popup mount point is missing')

mountControlCenter(host, {
  settingsAdapter: chromeSettings,
  secretAdapter: chromeSecrets,
  target: 'extension',
})
