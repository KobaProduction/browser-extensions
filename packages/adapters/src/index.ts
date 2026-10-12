export { createArchiveFiles } from './folder-archive'

import { type DeliveryTarget, instanceKey, type SettingsStore } from '@kobaproduction/browser-core'
export function createSettingsStore(target: DeliveryTarget, namespace = 'koba-browser'): SettingsStore {
  const scopedNamespace = instanceKey(namespace)
  if (target === 'chromium')
    return {
      async get(key) {
        const data = await chrome.storage.local.get(`${scopedNamespace}:${key}`)
        return data[`${scopedNamespace}:${key}`] as boolean | undefined
      },
      async set(key, enabled) {
        await chrome.storage.local.set({ [`${scopedNamespace}:${key}`]: enabled })
      },
    }
  return {
    async get(key) {
      try {
        const value = localStorage.getItem(`${scopedNamespace}:${key}`)
        return value === null ? undefined : value === 'true'
      } catch {
        return undefined
      }
    },
    async set(key, enabled) {
      localStorage.setItem(`${scopedNamespace}:${key}`, String(enabled))
    },
  }
}
export interface ProxyProfile {
  id: string
  name: string
  scheme: 'http' | 'https' | 'socks4' | 'socks5'
  host: string
  port: number
  bypass?: string[]
}
export function validateProxyProfile(v: ProxyProfile): ProxyProfile {
  if (
    !v ||
    !['http', 'https', 'socks4', 'socks5'].includes(v.scheme) ||
    !/^[a-z\d.-]+$/i.test(v.host) ||
    !Number.isInteger(v.port) ||
    v.port < 1 ||
    v.port > 65535
  )
    throw new Error('Invalid proxy profile')
  return v
}
// The userscript target cannot access browser-wide proxy settings. Chromium
// requires the manifest permission and a background-only adapter.
export function proxyAvailable(target: DeliveryTarget, granted: ReadonlySet<string>) {
  return target === 'chromium' && granted.has('proxy')
}

/** Observe just this installation's enable switch. One browser identity
 * never toggles the sibling DEV/PROD or other product; no DB is touched. */
export function onInstallationStateChange(target: DeliveryTarget, listener: () => void): () => void {
  const key = `${instanceKey('koba-browser')}:installation.enabled`
  if (target === 'chromium') {
    const changed = (items: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && Object.hasOwn(items, key)) listener()
    }
    chrome.storage.onChanged.addListener(changed)
    return () => chrome.storage.onChanged.removeListener(changed)
  }
  const changed = (event: StorageEvent) => {
    if (event.key === key) listener()
  }
  window.addEventListener('storage', changed)
  return () => window.removeEventListener('storage', changed)
}

export { createApplicationTelemetry } from './application-telemetry'
export { attachChromeInstallationToggle } from './installation-popup'
export type { OtlpDeliveryConfiguration, OtlpRequest, OtlpSender } from './scoped-otlp'
export {
  resolveOtlpLogsEndpoint,
  ScopedOtlpService,
  scopedOtlpPayload,
  sendOtlpRequest,
} from './scoped-otlp'
export { asTelemetryPort } from './telemetry-port'
