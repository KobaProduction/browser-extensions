import { type BoosterSettings, DEFAULT_SETTINGS, type SettingsAdapter } from '@chatgpt-booster/core'

const STORAGE_KEY = 'settings'

function normalize(value: Partial<BoosterSettings> | undefined): BoosterSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
  }
}

export const chromeSettings: SettingsAdapter = {
  async get() {
    const data = await chrome.storage.local.get(STORAGE_KEY)
    return normalize(data[STORAGE_KEY] as Partial<BoosterSettings> | undefined)
  },

  async set(settings) {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings })
  },

  subscribe(listener) {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return
      listener(normalize(changes[STORAGE_KEY].newValue as Partial<BoosterSettings> | undefined))
    }

    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  },
}
