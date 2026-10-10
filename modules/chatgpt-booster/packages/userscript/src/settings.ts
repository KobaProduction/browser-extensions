import { instanceKey } from '@kobaproduction/browser-core'
import {
  type BoosterSettings,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
  snapshotSettings,
} from '@chatgpt-booster/core'

const STORAGE_KEY = instanceKey('chatgpt-booster:settings', 'chatgpt-booster:prod')
const EVENT_NAME = instanceKey('chatgpt-booster:settings-changed', 'chatgpt-booster:prod')

function read(): BoosterSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeSettings(raw ? (JSON.parse(raw) as Partial<BoosterSettings>) : undefined)
  } catch {
    return normalizeSettings()
  }
}

function write(settings: BoosterSettings): BoosterSettings {
  const normalized = snapshotSettings(settings)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }))
  return normalized
}

export const userscriptSettings: SettingsAdapter = {
  async get() {
    return read()
  },

  async set(settings) {
    write(settings)
  },

  async update(patch) {
    return write(mergeSettings(read(), patch))
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
