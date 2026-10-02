import { mountControlCenter } from '@chatgpt-booster/ui'
import { chromeSettings } from '../settings'

document.body.style.margin = '0'
document.body.style.minWidth = '380px'

const host = document.getElementById('app')
if (!host) throw new Error('Popup mount point is missing')

mountControlCenter(host, {
  settingsAdapter: chromeSettings,
  target: 'extension',
})
