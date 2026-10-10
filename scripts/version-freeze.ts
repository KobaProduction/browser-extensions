/** Owner decision: VK 3.0.0 remains the fixed product base while it is still
 * under development and has no production adoption. DEV releases use a
 * separate -dev.<run> identifier. Only an explicit subsequent owner decision
 * can remove or change this freeze. */
export const VK_FROZEN_BASE_VERSION = '3.0.0' as const

export function isVkBaseFrozen(id: string, version: string): boolean {
  return id === 'vk-booster' && version === VK_FROZEN_BASE_VERSION
}
