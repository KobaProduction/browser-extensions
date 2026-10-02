export interface FeatureSettings {
  toolInspector: boolean
}

export interface LauncherSettings {
  x: number | null
  y: number | null
}

export type LanguagePreference = 'auto' | 'en' | 'ru'
export type SettingsSection = 'modules' | 'analytics' | 'other'

export interface ObserverSettings {
  enabled: boolean
  captureBodies: boolean
  maxBodyChars: number
}

export interface TelemetrySettings {
  enabled: boolean
  endpoint: string
}

export interface UiSettings {
  activeSection: SettingsSection
  telemetryExpanded: boolean
}

export interface BoosterSettings {
  schemaVersion: number
  enabled: boolean
  language: LanguagePreference
  features: FeatureSettings
  launcher: LauncherSettings
  observer: ObserverSettings
  telemetry: TelemetrySettings
  ui: UiSettings
}

export interface BoosterSettingsPatch {
  schemaVersion?: number
  enabled?: boolean
  language?: LanguagePreference
  features?: Partial<FeatureSettings>
  launcher?: Partial<LauncherSettings>
  observer?: Partial<ObserverSettings>
  telemetry?: Partial<TelemetrySettings>
  ui?: Partial<UiSettings>
}

export const SETTINGS_SCHEMA_VERSION = 2

export const DEFAULT_SETTINGS: BoosterSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
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
    endpoint: '',
  },
  ui: {
    activeSection: 'modules',
    telemetryExpanded: true,
  },
}

export function normalizeSettings(value?: Partial<BoosterSettings>): BoosterSettings {
  const incomingSchema = value?.schemaVersion ?? 0
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
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
      endpoint:
        incomingSchema < SETTINGS_SCHEMA_VERSION
          ? DEFAULT_SETTINGS.telemetry.endpoint
          : (value?.telemetry?.endpoint ?? DEFAULT_SETTINGS.telemetry.endpoint),
    },
    ui: {
      ...DEFAULT_SETTINGS.ui,
      ...value?.ui,
    },
  }
}

export function snapshotSettings(
  value: Partial<BoosterSettings> | BoosterSettings,
): BoosterSettings {
  const normalized = normalizeSettings(value)
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabled: normalized.enabled,
    language: normalized.language,
    features: {
      toolInspector: normalized.features.toolInspector,
    },
    launcher: {
      x: normalized.launcher.x,
      y: normalized.launcher.y,
    },
    observer: {
      enabled: normalized.observer.enabled,
      captureBodies: normalized.observer.captureBodies,
      maxBodyChars: normalized.observer.maxBodyChars,
    },
    telemetry: {
      enabled: normalized.telemetry.enabled,
      endpoint: normalized.telemetry.endpoint,
    },
    ui: {
      activeSection: normalized.ui.activeSection,
      telemetryExpanded: normalized.ui.telemetryExpanded,
    },
  }
}

export function mergeSettings(
  current: Partial<BoosterSettings> | undefined,
  patch: BoosterSettingsPatch,
): BoosterSettings {
  const normalized = normalizeSettings(current)
  return normalizeSettings({
    ...normalized,
    ...patch,
    features: {
      ...normalized.features,
      ...patch.features,
    },
    launcher: {
      ...normalized.launcher,
      ...patch.launcher,
    },
    observer: {
      ...normalized.observer,
      ...patch.observer,
    },
    telemetry: {
      ...normalized.telemetry,
      ...patch.telemetry,
    },
    ui: {
      ...normalized.ui,
      ...patch.ui,
    },
  })
}

export interface SecretAdapter {
  getTelemetryToken(): Promise<string>
  setTelemetryToken(token: string): Promise<void>
}

export interface SettingsAdapter {
  get(): Promise<BoosterSettings>
  set(settings: BoosterSettings): Promise<void>
  update(patch: BoosterSettingsPatch): Promise<BoosterSettings>
  subscribe(listener: (settings: BoosterSettings) => void): () => void
}

export const OPEN_SETTINGS_EVENT = 'chatgpt-booster:open-settings'
