import {
  type BoosterSettings,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { mountBoosterUi } from './mount'

let current = normalizeSettings()
const listeners = new Set<(settings: BoosterSettings) => void>()

const devSettings: SettingsAdapter = {
  async get() {
    return structuredClone(current)
  },
  async set(settings) {
    current = structuredClone(settings)
    for (const listener of listeners) listener(structuredClone(current))
  },
  async update(patch) {
    current = mergeSettings(current, patch)
    for (const listener of listeners) listener(structuredClone(current))
    return structuredClone(current)
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

mountBoosterUi({
  settingsAdapter: devSettings,
  target: 'userscript',
})
