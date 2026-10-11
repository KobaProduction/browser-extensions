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

export { attachChromeInstallationToggle } from './installation-popup'
export type { OtlpDeliveryConfiguration, OtlpRequest, OtlpSender } from './scoped-otlp'
export {
  resolveOtlpLogsEndpoint,
  ScopedOtlpService,
  scopedOtlpPayload,
  sendOtlpRequest,
} from './scoped-otlp'
export { asTelemetryPort } from './telemetry-port'
