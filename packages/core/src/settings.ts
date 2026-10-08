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
  messageMetadata: boolean
  activityIndicator: boolean
  toolInspector: boolean
  requestTimer: boolean
}

export interface AlertSettings {
  responseCompleteSound: boolean
  longRunningSound: boolean
  longRunningThresholdMs: number
}

export interface MonitoringSettings {
  intervalMs: number
}

export interface HistoryLoaderSettings {
  speedPxPerSecond: number
  burstDurationMs: number
  pauseMs: number
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

export interface ArchiveWindowSettings {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
  minimizedSide: DockSide
  minimizedHeightRatio: number
}

export interface UiSettings {
  archiveStart: 'first' | 'latest'
  activeSection: SettingsSection
  telemetryExpanded: boolean
  archiveWindow: ArchiveWindowSettings
}

export interface BoosterSettings {
  schemaVersion: number
  enabled: boolean
  language: LanguagePreference
  features: FeatureSettings
  historyLoader: HistoryLoaderSettings
  alerts: AlertSettings
  monitoring: MonitoringSettings
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
  historyLoader?: Partial<HistoryLoaderSettings>
  alerts?: Partial<AlertSettings>
  monitoring?: Partial<MonitoringSettings>
  launcher?: Partial<LauncherSettings>
  observer?: Partial<ObserverSettings>
  telemetry?: Partial<TelemetrySettings>
  ui?: Omit<Partial<UiSettings>, 'archiveWindow'> & {
    archiveWindow?: Partial<ArchiveWindowSettings>
  }
  archive?: {
    defaultRule?: Partial<CaptureRule>
    projects?: Record<string, CaptureRule | null>
    conversations?: Record<string, CaptureRule | null>
  }
  export?: Partial<ArchiveExportOptions>
}

export const SETTINGS_SCHEMA_VERSION = 7

function clampWindowRatio(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}

export const DEFAULT_SETTINGS: BoosterSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  enabled: true,
  language: 'auto',
  features: {
    messageMetadata: true,
    activityIndicator: true,
    toolInspector: true,
    requestTimer: true,
  },
  historyLoader: {
    speedPxPerSecond: 2600,
    burstDurationMs: 650,
    pauseMs: 90,
  },
  alerts: {
    responseCompleteSound: false,
    longRunningSound: false,
    longRunningThresholdMs: 120_000,
  },
  monitoring: {
    intervalMs: 500,
  },
  launcher: {
    x: null,
    y: null,
    side: 'right',
    heightRatio: 0.65,
  },
  observer: {
    enabled: false,
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
    archiveStart: 'latest',
    activeSection: 'modules',
    telemetryExpanded: true,
    archiveWindow: {
      xRatio: 0.08,
      yRatio: 0.08,
      widthRatio: 0.72,
      heightRatio: 0.82,
      minimizedSide: 'right',
      minimizedHeightRatio: 0.45,
    },
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
    historyLoader: {
      speedPxPerSecond: clampWindowRatio(
        value?.historyLoader?.speedPxPerSecond,
        DEFAULT_SETTINGS.historyLoader.speedPxPerSecond,
        600,
        6000,
      ),
      burstDurationMs: clampWindowRatio(
        value?.historyLoader?.burstDurationMs,
        DEFAULT_SETTINGS.historyLoader.burstDurationMs,
        180,
        1600,
      ),
      pauseMs: clampWindowRatio(
        value?.historyLoader?.pauseMs,
        DEFAULT_SETTINGS.historyLoader.pauseMs,
        20,
        1200,
      ),
    },
    alerts: {
      responseCompleteSound:
        value?.alerts?.responseCompleteSound ?? DEFAULT_SETTINGS.alerts.responseCompleteSound,
      longRunningSound: value?.alerts?.longRunningSound ?? DEFAULT_SETTINGS.alerts.longRunningSound,
      longRunningThresholdMs: clampWindowRatio(
        value?.alerts?.longRunningThresholdMs,
        DEFAULT_SETTINGS.alerts.longRunningThresholdMs,
        15_000,
        30 * 60_000,
      ),
    },
    monitoring: {
      intervalMs: clampWindowRatio(
        value?.monitoring?.intervalMs,
        DEFAULT_SETTINGS.monitoring.intervalMs,
        100,
        10_000,
      ),
    },
    launcher: {
      ...DEFAULT_SETTINGS.launcher,
      // Schema < 3 stored absolute viewport pixels. They are resolution-specific,
      // so migration intentionally discards them instead of pretending they are portable.
      x: null,
      y: null,
      side:
        incomingSchema >= 3 && value?.launcher?.side === 'left'
          ? 'left'
          : DEFAULT_SETTINGS.launcher.side,
      heightRatio:
        incomingSchema >= 3
          ? clampRatio(value?.launcher?.heightRatio)
          : DEFAULT_SETTINGS.launcher.heightRatio,
    },
    observer: {
      ...DEFAULT_SETTINGS.observer,
      ...value?.observer,
      enabled:
        incomingSchema >= 5
          ? (value?.observer?.enabled ?? DEFAULT_SETTINGS.observer.enabled)
          : value && (value.observer?.captureBodies === true || value.telemetry?.enabled === true)
            ? (value.observer?.enabled ?? true)
            : false,
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
      archiveStart: value?.ui?.archiveStart === 'first' ? 'first' : 'latest',
      archiveWindow: {
        ...DEFAULT_SETTINGS.ui.archiveWindow,
        ...value?.ui?.archiveWindow,
        xRatio: clampWindowRatio(
          value?.ui?.archiveWindow?.xRatio,
          DEFAULT_SETTINGS.ui.archiveWindow.xRatio,
          0,
          0.95,
        ),
        yRatio: clampWindowRatio(
          value?.ui?.archiveWindow?.yRatio,
          DEFAULT_SETTINGS.ui.archiveWindow.yRatio,
          0,
          0.95,
        ),
        widthRatio: clampWindowRatio(
          value?.ui?.archiveWindow?.widthRatio,
          DEFAULT_SETTINGS.ui.archiveWindow.widthRatio,
          0.32,
          0.96,
        ),
        heightRatio: clampWindowRatio(
          value?.ui?.archiveWindow?.heightRatio,
          DEFAULT_SETTINGS.ui.archiveWindow.heightRatio,
          0.4,
          0.96,
        ),
        minimizedSide: value?.ui?.archiveWindow?.minimizedSide === 'left' ? 'left' : 'right',
        minimizedHeightRatio: clampRatio(value?.ui?.archiveWindow?.minimizedHeightRatio),
      },
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
      messageMetadata: normalized.features.messageMetadata,
      activityIndicator: normalized.features.activityIndicator,
      toolInspector: normalized.features.toolInspector,
      requestTimer: normalized.features.requestTimer,
    },
    historyLoader: { ...normalized.historyLoader },
    alerts: { ...normalized.alerts },
    monitoring: { ...normalized.monitoring },
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
      archiveStart: normalized.ui.archiveStart,
      activeSection: normalized.ui.activeSection,
      telemetryExpanded: normalized.ui.telemetryExpanded,
      archiveWindow: { ...normalized.ui.archiveWindow },
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
    historyLoader: {
      ...normalized.historyLoader,
      ...patch.historyLoader,
    },
    alerts: {
      ...normalized.alerts,
      ...patch.alerts,
    },
    monitoring: {
      ...normalized.monitoring,
      ...patch.monitoring,
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
      archiveWindow: {
        ...normalized.ui.archiveWindow,
        ...patch.ui?.archiveWindow,
      },
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

export function createCachedSettingsAdapter(source: SettingsAdapter): SettingsAdapter {
  let cached: BoosterSettings | undefined
  let pending: Promise<BoosterSettings> | undefined
  let upstreamUnsubscribe: (() => void) | undefined
  const listeners = new Set<(settings: BoosterSettings) => void>()

  const store = (settings: BoosterSettings) => {
    cached = snapshotSettings(settings)
    return snapshotSettings(cached)
  }

  const ensureSubscription = () => {
    if (upstreamUnsubscribe) return
    upstreamUnsubscribe = source.subscribe((next) => {
      const snapshot = store(next)
      for (const listener of listeners) listener(snapshotSettings(snapshot))
    })
  }

  return {
    async get() {
      if (cached) return snapshotSettings(cached)
      pending ??= source
        .get()
        .then(store)
        .finally(() => {
          pending = undefined
        })
      return snapshotSettings(await pending)
    },
    async set(settings) {
      const snapshot = snapshotSettings(settings)
      await source.set(snapshot)
      cached = snapshot
    },
    async update(patch) {
      return store(await source.update(patch))
    },
    subscribe(listener) {
      listeners.add(listener)
      ensureSubscription()
      return () => {
        listeners.delete(listener)
        if (listeners.size || !upstreamUnsubscribe) return
        upstreamUnsubscribe()
        upstreamUnsubscribe = undefined
      }
    },
  }
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
