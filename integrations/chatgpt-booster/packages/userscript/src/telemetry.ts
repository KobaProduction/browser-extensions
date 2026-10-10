import {
  BOOSTER_VERSION,
  type SecretAdapter,
  type SettingsAdapter,
  type TelemetryControlAdapter,
} from '@chatgpt-booster/core'
import { OtlpTelemetryClient } from '@chatgpt-booster/telemetry'

declare function GM_getValue<T>(key: string, defaultValue: T): Promise<T> | T
declare function GM_setValue<T>(key: string, value: T): Promise<void> | void
declare function GM_xmlhttpRequest(details: {
  method: string
  url: string
  headers?: Record<string, string>
  data?: string
  timeout?: number
  onload?: (response: { status: number; responseText: string }) => void
  onerror?: (error: unknown) => void
  ontimeout?: () => void
}): void

const TOKEN_KEY = 'chatgpt-booster:telemetry-token'

export const userscriptSecrets: SecretAdapter = {
  async getTelemetryToken() {
    return await GM_getValue(TOKEN_KEY, '')
  },
  async setTelemetryToken(token) {
    await GM_setValue(TOKEN_KEY, token)
  },
}

export function createUserscriptTelemetry(settings: SettingsAdapter): OtlpTelemetryClient {
  return new OtlpTelemetryClient({
    serviceVersion: BOOSTER_VERSION,
    getSettings: async () => (await settings.get()).telemetry,
    getToken: () => userscriptSecrets.getTelemetryToken(),
    sender: async ({ url, headers, body }) => {
      await new Promise<void>((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST',
          url,
          headers,
          data: body,
          timeout: 10_000,
          onload: (response) => {
            if (response.status >= 200 && response.status < 300) resolve()
            else reject(new Error(`Telemetry HTTP ${response.status}`))
          },
          onerror: () => reject(new Error('Telemetry network error')),
          ontimeout: () => reject(new Error('Telemetry request timed out')),
        })
      })
    },
  })
}

export function createUserscriptTelemetryControl(
  telemetry: OtlpTelemetryClient,
): TelemetryControlAdapter {
  return {
    async test() {
      await telemetry.test()
    },
  }
}
