import { type DeliveryTarget, instanceScope } from '@kobaproduction/browser-core'

declare const GM_info: { isIncognito?: boolean } | undefined

/** DEV never attaches to a normal tab. The synthetic Lab has its own composition. */
export function isDevelopmentContextAllowed(target: DeliveryTarget, scope = instanceScope()): boolean {
  if (!/^(vk-booster|chatgpt-booster|all-in-one):(dev|prod)$/.test(scope)) return false
  if (scope.endsWith(':prod')) return true
  if (target === 'chromium')
    return typeof chrome !== 'undefined' && chrome.extension?.inIncognitoContext === true
  return typeof GM_info === 'object' && GM_info?.isIncognito === true
}
