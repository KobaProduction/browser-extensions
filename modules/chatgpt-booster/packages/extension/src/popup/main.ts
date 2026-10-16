import {
  createBrowserToolsPopupCommands,
  getApplicationIdentity,
} from '@kobaproduction/browser-adapters'
import { mountBrowserToolsPopup } from '@kobaproduction/browser-shell'

mountBrowserToolsPopup(document.body, {
  ...createBrowserToolsPopupCommands(/^https:\/\/chatgpt\.com\//),
  application: getApplicationIdentity('chromium'),
})
