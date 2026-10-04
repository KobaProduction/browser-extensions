import {
  applyTransportCounterEvent,
  type BoosterSettings,
  type BoosterSettingsPatch,
  EMPTY_TRANSPORT_COUNTERS,
  mergeSettings,
  normalizeSettings,
  type TransportCounterEvent,
  type TransportCounters,
} from '@chatgpt-booster/core'

const TOKEN_KEY = 'telemetryToken'
const SETTINGS_KEY = 'settings'
const ANALYTICS_KEY = 'analyticsTransportLifetime'

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

interface AnalyticsRecordMessage {
  type: 'chatgpt-booster:analytics-record'
  event: TransportCounterEvent
}

interface AnalyticsGetMessage {
  type: 'chatgpt-booster:analytics-get'
}

type BoosterMessage =
  | TelemetryMessage
  | SettingsSetMessage
  | SettingsUpdateMessage
  | AnalyticsRecordMessage
  | AnalyticsGetMessage

let settingsWriteQueue: Promise<void> = Promise.resolve()
let analyticsWriteQueue: Promise<void> = Promise.resolve()

function enqueueSettingsWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = settingsWriteQueue.then(work, work)
  settingsWriteQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function enqueueAnalyticsWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = analyticsWriteQueue.then(work, work)
  analyticsWriteQueue = result.then(
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

async function readAnalytics(): Promise<TransportCounters> {
  const stored = await chrome.storage.local.get(ANALYTICS_KEY)
  return {
    ...EMPTY_TRANSPORT_COUNTERS,
    ...(stored[ANALYTICS_KEY] as Partial<TransportCounters> | undefined),
  }
}

async function recordAnalytics(event: TransportCounterEvent): Promise<TransportCounters> {
  return await enqueueAnalyticsWrite(async () => {
    const next = applyTransportCounterEvent(await readAnalytics(), event)
    await chrome.storage.local.set({ [ANALYTICS_KEY]: next })
    return next
  })
}

async function postTelemetry(message: TelemetryMessage): Promise<{ ok: true; status: number }> {
  const settings = normalizeSettings(
    (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as
      | Partial<BoosterSettings>
      | undefined,
  )
  const configuredEndpoint = settings.telemetry.endpoint.trim()
  if (!configuredEndpoint) throw new Error('Telemetry endpoint is not configured')

  const parsed = new URL(message.url)
  const configured = new URL(configuredEndpoint)
  if (parsed.protocol !== 'https:' || parsed.origin !== configured.origin) {
    throw new Error('Telemetry origin does not match the configured endpoint')
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
      counters?: TransportCounters
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
        if (message.type === 'chatgpt-booster:analytics-get') {
          sendResponse({ ok: true, counters: await readAnalytics() })
          return
        }
        if (message.type === 'chatgpt-booster:analytics-record') {
          sendResponse({ ok: true, counters: await recordAnalytics(message.event) })
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

const CHATGPT_MATCH = 'https://chatgpt.com/*'

async function bootstrapExistingChatGptTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: CHATGPT_MATCH })
  await Promise.all(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === 'number')
      .map(async (tab) => {
        try {
          const [presence] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'ISOLATED',
            injectImmediately: true,
            func: () =>
              Boolean(
                document.documentElement.dataset.chatgptBoosterRuntimeVersion ||
                  document.querySelector('#chatgpt-booster-root, [data-chatgpt-booster]'),
              ),
          })
          if (presence?.result === true) return

          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/observer/index.js'],
            world: 'MAIN',
            injectImmediately: true,
          })
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/content/index.js'],
            world: 'ISOLATED',
            injectImmediately: true,
          })
        } catch {
          // Tab may navigate or close between query and injection. Manifest scripts cover the next load.
        }
      }),
  )
}

chrome.runtime.onInstalled.addListener(() => {
  void bootstrapExistingChatGptTabs()
})

chrome.runtime.onStartup.addListener(() => {
  void bootstrapExistingChatGptTabs()
})

// Unpacked extension reloads restart the worker without necessarily navigating existing tabs.
void bootstrapExistingChatGptTabs()
