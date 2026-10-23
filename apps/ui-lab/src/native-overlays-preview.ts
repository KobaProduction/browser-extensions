import { mountMessageMetadata } from '../../../modules/chatgpt-booster/packages/ui/src/message-metadata'

document.documentElement.style.cssText =
  'color-scheme:dark;background:#171717;color:#eee;font:14px system-ui'
const main = document.querySelector('main'),
  stack = document.getElementById('stack'),
  anchor = document.getElementById('metadata'),
  warning = document.getElementById('warning')
if (!main || !stack || !anchor || !warning) throw Error('Missing synthetic overlay anchors')
main.style.cssText = 'position:relative;max-width:480px;margin:32px auto;padding:16px'
stack.style.cssText =
  'position:relative;z-index:0;transform:translateZ(0);overflow:hidden;height:90px;border:1px solid #444;padding:16px'
warning.style.cssText =
  'position:relative;z-index:10;margin-top:-25px;padding:24px;background:#240d0d;border:1px solid #803030'
const mounted = mountMessageMetadata(
  anchor,
  {
    sentAt: 1800000000,
    editedAt: null,
    edited: false,
    model: 'Synthetic model',
    thinking: 'Synthetic effort',
  },
  'ru',
)
window.addEventListener('pagehide', () => mounted.unmount(), { once: true })
