import { type BoosterSettings, DEFAULT_SETTINGS, type SettingsAdapter } from '@chatgpt-booster/core'

const STORAGE_KEY = 'chatgpt-booster:settings'
const EVENT_NAME = 'chatgpt-booster:settings-changed'

function read(): BoosterSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<BoosterSettings>) }
      : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const userscriptSettings: SettingsAdapter = {
  async get() {
    return read()
  },

  async set(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: settings }))
  },

  subscribe(listener) {
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<BoosterSettings>
      listener(customEvent.detail ?? read())
    }

    window.addEventListener(EVENT_NAME, onChanged)
    return () => window.removeEventListener(EVENT_NAME, onChanged)
  },
}
