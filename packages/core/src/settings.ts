export interface FeatureSettings {
  toolInspector: boolean
}

export interface LauncherSettings {
  x: number | null
  y: number | null
}

export type LanguagePreference = 'auto' | 'en' | 'ru'

export interface BoosterSettings {
  enabled: boolean
  language: LanguagePreference
  features: FeatureSettings
  launcher: LauncherSettings
}

export const DEFAULT_SETTINGS: BoosterSettings = {
  enabled: true,
  language: 'auto',
  features: {
    toolInspector: true,
  },
  launcher: {
    x: null,
    y: null,
  },
}

export function normalizeSettings(value?: Partial<BoosterSettings>): BoosterSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    language: value?.language ?? DEFAULT_SETTINGS.language,
    features: {
      ...DEFAULT_SETTINGS.features,
      ...value?.features,
    },
    launcher: {
      ...DEFAULT_SETTINGS.launcher,
      ...value?.launcher,
    },
  }
}

export interface SettingsAdapter {
  get(): Promise<BoosterSettings>
  set(settings: BoosterSettings): Promise<void>
  subscribe(listener: (settings: BoosterSettings) => void): () => void
}

export const OPEN_SETTINGS_EVENT = 'chatgpt-booster:open-settings'
