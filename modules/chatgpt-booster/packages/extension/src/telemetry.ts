import {
  BOOSTER_VERSION,
  type SecretAdapter,
  type SettingsAdapter,
  type TelemetryControlAdapter,
} from '@chatgpt-booster/core'
import { OtlpTelemetryClient } from '@chatgpt-booster/telemetry'
import { instanceKey } from '@kobaproduction/browser-core'

const TOKEN_KEY = 'telemetryToken'

export const chromeSecrets: SecretAdapter = {
  async getTelemetryToken() {
    const stored = await chrome.storage.local.get(TOKEN_KEY)
    return typeof stored[TOKEN_KEY] === 'string' ? stored[TOKEN_KEY] : ''
  },
  async setTelemetryToken(token) {
    await chrome.storage.local.set({ [TOKEN_KEY]: token })
  },
  async getRemoteToken() {
    const key = instanceKey('chatgpt-booster:remote-token')
    const stored = await chrome.storage.local.get(key)
    return typeof stored[key] === 'string' ? stored[key] : ''
  },
  async setRemoteToken(token) {
    if (typeof token !== 'string' || token.length > 8192) throw Error('Invalid remote credential')
    const key = instanceKey('chatgpt-booster:remote-token')
    if (token) await chrome.storage.local.set({ [key]: token })
    else await chrome.storage.local.remove(key)
  },
}

export function createChromeTelemetry(settings: SettingsAdapter): OtlpTelemetryClient {
  return new OtlpTelemetryClient({
    serviceVersion: BOOSTER_VERSION,
    getSettings: async () => (await settings.get()).telemetry,
    // The background worker owns the token and adds Authorization.
    getToken: async () => '',
    sender: async ({ url, body }) => {
      const response = (await chrome.runtime.sendMessage({
        type: 'chatgpt-booster:telemetry-post',
        url,
        body,
      })) as { ok?: boolean; status?: number; error?: string }

      if (!response?.ok) throw new Error(response?.error ?? 'Telemetry background request failed')
    },
  })
}

export function createChromeTelemetryControl(
  telemetry: OtlpTelemetryClient,
  settings?: SettingsAdapter,
): TelemetryControlAdapter {
  return {
    async test() {
      if (settings) {
        const endpoint = (await settings.get()).telemetry.endpoint.trim()
        if (!endpoint) throw new Error('Configure a telemetry endpoint first')
        const parsed = new URL(endpoint)
        if (parsed.protocol !== 'https:') throw new Error('Telemetry endpoint must use HTTPS')
        const origin = `${parsed.origin}/*`
        // permissions.request is only available in a privileged extension page.
        // A page content script must not fake a permission prompt or expand hosts.
        if (chrome.permissions?.contains && chrome.permissions.request) {
          if (!(await chrome.permissions.contains({ origins: [origin] }))) {
            const granted = await chrome.permissions.request({ origins: [origin] })
            if (!granted) throw new Error('Telemetry host permission was not granted')
          }
        } else {
          const state = (await chrome.runtime.sendMessage({
            type: 'chatgpt-booster:telemetry-permission-check',
            origin: parsed.origin,
          })) as { granted?: boolean }
          if (!state?.granted)
            throw new Error('Allow this telemetry endpoint in the ChatGPT Booster extension popup first')
        }
      }
      await telemetry.test()
    },
  }
}
