import {
  BOOSTER_VERSION,
  type SecretAdapter,
  type SettingsAdapter,
  type TelemetryControlAdapter,
} from '@chatgpt-booster/core'
import { OtlpTelemetryClient } from '@chatgpt-booster/telemetry'

const TOKEN_KEY = 'telemetryToken'

export const chromeSecrets: SecretAdapter = {
  async getTelemetryToken() {
    const stored = await chrome.storage.local.get(TOKEN_KEY)
    return typeof stored[TOKEN_KEY] === 'string' ? stored[TOKEN_KEY] : ''
  },
  async setTelemetryToken(token) {
    await chrome.storage.local.set({ [TOKEN_KEY]: token })
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
): TelemetryControlAdapter {
  return {
    async test() {
      await telemetry.test()
    },
  }
}
