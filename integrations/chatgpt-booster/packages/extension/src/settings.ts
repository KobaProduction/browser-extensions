import {
  type BoosterSettings,
  type BoosterSettingsPatch,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'

const STORAGE_KEY = 'settings'

type SettingsResponse = {
  ok: boolean
  settings?: BoosterSettings
  error?: string
}

async function sendSettingsMessage(message: {
  type: 'chatgpt-booster:settings-set' | 'chatgpt-booster:settings-update'
  settings?: BoosterSettings
  patch?: BoosterSettingsPatch
}): Promise<BoosterSettings> {
  const response = (await chrome.runtime.sendMessage(message)) as SettingsResponse
  if (!response?.ok || !response.settings) {
    throw new Error(response?.error ?? 'Settings persistence failed')
  }
  return normalizeSettings(response.settings)
}

export const chromeSettings: SettingsAdapter = {
  async get() {
    const data = await chrome.storage.local.get(STORAGE_KEY)
    return normalizeSettings(data[STORAGE_KEY] as Partial<BoosterSettings> | undefined)
  },

  async set(settings) {
    await sendSettingsMessage({
      type: 'chatgpt-booster:settings-set',
      settings,
    })
  },

  async update(patch) {
    return await sendSettingsMessage({
      type: 'chatgpt-booster:settings-update',
      patch,
    })
  },

  subscribe(listener) {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return
      listener(
        normalizeSettings(changes[STORAGE_KEY].newValue as Partial<BoosterSettings> | undefined),
      )
    }

    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  },
}
