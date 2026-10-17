import { type DeliveryTarget, instanceScope } from '@kobaproduction/browser-core'

/** Both channels run in normal/private tabs; the validated installation scope owns isolation. */
export function isDevelopmentContextAllowed(_target: DeliveryTarget, scope = instanceScope()): boolean {
  return /^(vk-booster|chatgpt-booster|all-in-one):(dev|prod)$/.test(scope)
}
