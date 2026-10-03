import {
  type ArchiveExportOptions,
  type ArchiveSettings,
  type CaptureRule,
  DEFAULT_CAPTURE_RULE,
  DEFAULT_EXPORT_OPTIONS,
  normalizeCaptureRule,
  normalizeExportOptions,
} from './archive'
import { clampRatio, type DockSide } from './docking'
export interface FeatureSettings {
  toolInspector: boolean
}

export interface LauncherSettings {
  x: number | null
  y: number | null
  side: DockSide
  heightRatio: number
}

export type LanguagePreference = 'auto' | 'en' | 'ru'
export type SettingsSection = 'modules' | 'analytics' | 'other' | 'archive'

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
  archive: ArchiveSettings
  export: ArchiveExportOptions
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
  archive?: {
    defaultRule?: Partial<CaptureRule>
    projects?: Record<string, CaptureRule | null>
    conversations?: Record<string, CaptureRule | null>
  }
  export?: Partial<ArchiveExportOptions>
}

export const SETTINGS_SCHEMA_VERSION = 3

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
    side: 'right',
    heightRatio: 0.65,
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
  archive: { defaultRule: { ...DEFAULT_CAPTURE_RULE }, projects: {}, conversations: {} },
  export: { ...DEFAULT_EXPORT_OPTIONS },
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
      side: value?.launcher?.side === 'left' ? 'left' : 'right',
      heightRatio: clampRatio(value?.launcher?.heightRatio),
    },
    observer: {
      ...DEFAULT_SETTINGS.observer,
      ...value?.observer,
    },
    telemetry: {
      ...DEFAULT_SETTINGS.telemetry,
      ...value?.telemetry,
      endpoint:
        incomingSchema < 2
          ? DEFAULT_SETTINGS.telemetry.endpoint
          : (value?.telemetry?.endpoint ?? DEFAULT_SETTINGS.telemetry.endpoint),
    },
    archive: {
      defaultRule: normalizeCaptureRule(value?.archive?.defaultRule),
      projects: mergeCaptureRules({}, value?.archive?.projects),
      conversations: mergeCaptureRules({}, value?.archive?.conversations),
    },
    export: normalizeExportOptions(value?.export),
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
      side: normalized.launcher.side,
      heightRatio: normalized.launcher.heightRatio,
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
    archive: {
      defaultRule: { ...normalized.archive.defaultRule },
      projects: Object.fromEntries(
        Object.entries(normalized.archive.projects).map(([id, rule]) => [id, { ...rule }]),
      ),
      conversations: Object.fromEntries(
        Object.entries(normalized.archive.conversations).map(([id, rule]) => [id, { ...rule }]),
      ),
    },
    export: { ...normalized.export },
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
    archive: {
      defaultRule: { ...normalized.archive.defaultRule, ...patch.archive?.defaultRule },
      projects: mergeCaptureRules(normalized.archive.projects, patch.archive?.projects),
      conversations: mergeCaptureRules(
        normalized.archive.conversations,
        patch.archive?.conversations,
      ),
    },
    export: { ...normalized.export, ...patch.export },
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

function mergeCaptureRules(
  current: Record<string, CaptureRule>,
  patch?: Record<string, CaptureRule | null>,
): Record<string, CaptureRule> {
  const entries = new Map(Object.entries(current))
  for (const [id, rule] of Object.entries(patch ?? {})) {
    if (rule === null) entries.delete(id)
    else if (rule && typeof rule === 'object') entries.set(id, normalizeCaptureRule(rule))
  }
  return Object.fromEntries(entries)
}
