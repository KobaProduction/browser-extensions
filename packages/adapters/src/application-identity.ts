import { type DeliveryTarget, instanceScope } from '@kobaproduction/browser-core'

declare const __BOOSTER_APPLICATION__:
  | {
      id: string
      title: string
      version: string
      components: readonly { id: string; title: string; version: string }[]
    }
  | undefined
export function getApplicationIdentity(target: DeliveryTarget) {
  const compiled = typeof __BOOSTER_APPLICATION__ === 'object' ? __BOOSTER_APPLICATION__ : undefined
  const id = instanceScope().split(':')[0] ?? ''
  return {
    ...(compiled ?? {
      id,
      title:
        id === 'all-in-one'
          ? 'Koba Browser Tools'
          : id === 'vk-booster'
            ? 'VK Booster'
            : 'ChatGPT Booster',
    }),
    installation: target === 'chromium' ? 'Chromium' : 'Tampermonkey',
  }
}
