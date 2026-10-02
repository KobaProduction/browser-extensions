export interface FeatureSettings {
  toolInspector: boolean
}

export interface LauncherSettings {
  x: number | null
  y: number | null
}

export type LanguagePreference = 'auto' | 'en' | 'ru'

export interface ObserverSettings {
  enabled: boolean
  captureBodies: boolean
  maxBodyChars: number
}

export interface TelemetrySettings {
  enabled: boolean
  endpoint: string
}

export interface BoosterSettings {
  enabled: boolean
  language: LanguagePreference
  features: FeatureSettings
  launcher: LauncherSettings
  observer: ObserverSettings
  telemetry: TelemetrySettings
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
  observer: {
    enabled: true,
    captureBodies: false,
    maxBodyChars: 2048,
  },
  telemetry: {
    enabled: false,
    endpoint: 'https://telemetry.koba-nexus.ru',
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
    observer: {
      ...DEFAULT_SETTINGS.observer,
      ...value?.observer,
    },
    telemetry: {
      ...DEFAULT_SETTINGS.telemetry,
      ...value?.telemetry,
    },
  }
}

export interface SecretAdapter {
  getTelemetryToken(): Promise<string>
  setTelemetryToken(token: string): Promise<void>
}

export interface SettingsAdapter {
  get(): Promise<BoosterSettings>
  set(settings: BoosterSettings): Promise<void>
  subscribe(listener: (settings: BoosterSettings) => void): () => void
}

export const OPEN_SETTINGS_EVENT = 'chatgpt-booster:open-settings'
