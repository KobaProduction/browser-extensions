import {
  createBrowserToolsPopupCommands,
  createInstallationLocale,
  getApplicationIdentity,
} from '@kobaproduction/browser-adapters'
import { mountBrowserToolsPopup } from '@kobaproduction/browser-shell'

const options = {
  ...createBrowserToolsPopupCommands(/^https:\/\/(?:vk\.ru|vk\.com|chatgpt\.com)\//),
  application: getApplicationIdentity('chromium'),
}
void createInstallationLocale('chromium').then(
  (locale) => mountBrowserToolsPopup(document.body, { ...options, locale }),
  () => mountBrowserToolsPopup(document.body, options),
)
