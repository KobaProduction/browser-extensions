import {
  type BoosterSettings,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
  snapshotSettings,
} from '@chatgpt-booster/core'
import { mountBoosterUi } from './mount'

let current = normalizeSettings()
const listeners = new Set<(settings: BoosterSettings) => void>()

const devSettings: SettingsAdapter = {
  async get() {
    return snapshotSettings(current)
  },
  async set(settings) {
    current = snapshotSettings(settings)
    for (const listener of listeners) listener(snapshotSettings(current))
  },
  async update(patch) {
    current = mergeSettings(current, patch)
    for (const listener of listeners) listener(snapshotSettings(current))
    return snapshotSettings(current)
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
