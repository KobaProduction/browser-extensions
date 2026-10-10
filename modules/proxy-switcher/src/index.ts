import type { Feature } from '@kobaproduction/browser-core'
// Proxy settings are a privileged Chrome background API, unavailable to
// userscripts/content scripts. This is a typed feature boundary, not a fake proxy.
export const proxySwitcherFeature: Feature = {
  id: 'proxy-switcher',
  title: 'Proxy Switcher (planned)',
  description: 'HTTP/SOCKS profiles and domain rules — requires privileged background runtime',
  targets: ['chromium'],
  requiredCapabilities: ['proxy-settings', 'request-routing'],
  match: () => false,
  start() {
    throw new Error('Proxy engine is not implemented yet')
  },
}
