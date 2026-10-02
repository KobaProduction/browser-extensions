export interface FeatureSettings {
  toolInspector: boolean
}

export interface BoosterSettings {
  enabled: boolean
  features: FeatureSettings
}

export const DEFAULT_SETTINGS: BoosterSettings = {
  enabled: true,
  features: {
    toolInspector: true,
  },
}

export function normalizeSettings(value?: Partial<BoosterSettings>): BoosterSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    features: {
      ...DEFAULT_SETTINGS.features,
      ...value?.features,
    },
  }
}

export interface SettingsAdapter {
  get(): Promise<BoosterSettings>
  set(settings: BoosterSettings): Promise<void>
  subscribe(listener: (settings: BoosterSettings) => void): () => void
}
