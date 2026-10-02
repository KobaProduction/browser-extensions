import {
  type BoosterSettings,
  type BoosterSettingsPatch,
  mergeSettings,
  normalizeSettings,
} from '@chatgpt-booster/core'

const TOKEN_KEY = 'telemetryToken'
const SETTINGS_KEY = 'settings'

interface TelemetryMessage {
  type: 'chatgpt-booster:telemetry-post'
  url: string
  body: string
}

interface SettingsSetMessage {
  type: 'chatgpt-booster:settings-set'
  settings: BoosterSettings
}

interface SettingsUpdateMessage {
  type: 'chatgpt-booster:settings-update'
  patch: BoosterSettingsPatch
}

type BoosterMessage = TelemetryMessage | SettingsSetMessage | SettingsUpdateMessage

let settingsWriteQueue: Promise<void> = Promise.resolve()

function enqueueSettingsWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = settingsWriteQueue.then(work, work)
  settingsWriteQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function replaceSettings(settings: BoosterSettings): Promise<BoosterSettings> {
  return await enqueueSettingsWrite(async () => {
    const normalized = normalizeSettings(settings)
    await chrome.storage.local.set({ [SETTINGS_KEY]: normalized })
    return normalized
  })
}

async function updateSettings(patch: BoosterSettingsPatch): Promise<BoosterSettings> {
  return await enqueueSettingsWrite(async () => {
    const stored = await chrome.storage.local.get(SETTINGS_KEY)
    const next = mergeSettings(stored[SETTINGS_KEY] as Partial<BoosterSettings> | undefined, patch)
    await chrome.storage.local.set({ [SETTINGS_KEY]: next })
    return next
  })
}

async function postTelemetry(message: TelemetryMessage): Promise<{ ok: true; status: number }> {
  const parsed = new URL(message.url)
  if (parsed.origin !== 'https://telemetry.koba-nexus.ru') {
    throw new Error('Telemetry origin is not allowlisted')
  }

  const stored = await chrome.storage.local.get(TOKEN_KEY)
  const token = typeof stored[TOKEN_KEY] === 'string' ? stored[TOKEN_KEY] : ''
  if (!token) throw new Error('Telemetry token is not configured')

  const response = await fetch(message.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: message.body,
  })

  if (!response.ok) throw new Error(`Telemetry HTTP ${response.status}`)
  return { ok: true, status: response.status }
}

chrome.runtime.onMessage.addListener(
  (
    message: BoosterMessage,
    _sender,
    sendResponse: (response: {
      ok: boolean
      status?: number
      settings?: BoosterSettings
      error?: string
    }) => void,
  ) => {
    if (!message?.type?.startsWith('chatgpt-booster:')) return

    void (async () => {
      try {
        if (message.type === 'chatgpt-booster:settings-set') {
          sendResponse({ ok: true, settings: await replaceSettings(message.settings) })
          return
        }
        if (message.type === 'chatgpt-booster:settings-update') {
          sendResponse({ ok: true, settings: await updateSettings(message.patch) })
          return
        }

        const result = await postTelemetry(message)
        sendResponse(result)
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Background operation failed',
        })
      }
    })()

    return true
  },
)
