export type { TelemetryEvent, TelemetryEventName, TelemetrySink } from './telemetry'
export { TelemetryBus } from './telemetry'
export type DeliveryTarget = 'userscript' | 'chromium'
export type Capability =
  | 'page-dom'
  | 'origin-storage'
  | 'local-files'
  | 'proxy-settings'
  | 'request-routing'
  | 'user-agent'
export type FeatureId = string
/** Browser shell events carry no chat data or provider-specific payloads. */
export const SHELL_OPEN_FEATURE_EVENT = 'koba:open-feature'
export const SHELL_CLOSE_EVENT = 'koba:close-shell'

export interface FeatureContext {
  readonly target: DeliveryTarget
  readonly url: URL
  readonly capabilities: ReadonlySet<Capability>
  readonly settings: FeatureSettings
}
export interface Feature {
  readonly id: FeatureId
  readonly title: string
  readonly description: string
  /** Provider-independent view sizing; default is standard. */
  readonly presentation?: { readonly panel: 'standard' | 'wide' }
  readonly match: (url: URL) => boolean
  readonly targets: readonly DeliveryTarget[]
  readonly requiredCapabilities: readonly Capability[]
  start(context: FeatureContext): Promise<void> | void
  stop?(): Promise<void> | void
  open?(): Promise<void> | void
}
export interface SettingsStore {
  get(key: string): Promise<boolean | undefined>
  set(key: string, enabled: boolean): Promise<void>
}
export class FeatureSettings {
  constructor(private readonly store: SettingsStore) {}
  enabled(id: string) {
    return this.store.get(`features.${id}.enabled`).then((value) => value !== false)
  }
  setEnabled(id: string, enabled: boolean) {
    return this.store.set(`features.${id}.enabled`, enabled)
  }
}
export type FeatureStatus = {
  id: string
  title: string
  description: string
  state: 'active' | 'disabled' | 'unsupported' | 'failed'
  reason?: string
}
export class FeatureRuntime {
  private readonly active = new Map<string, Feature>()
  private readonly status = new Map<string, FeatureStatus>()
  private started = false
  constructor(
    readonly features: readonly Feature[],
    readonly context: FeatureContext,
    private readonly telemetry?: import('./telemetry').TelemetryBus,
  ) {
    const names = new Set<string>()
    for (const feature of features) {
      if (!/^[a-z][a-z0-9-]+$/.test(feature.id) || names.has(feature.id))
        throw new Error(`Invalid or duplicate module id: ${feature.id}`)
      names.add(feature.id)
    }
  }
  async start() {
    if (this.started) return
    this.started = true
    for (const feature of this.features) {
      const base = { id: feature.id, title: feature.title, description: feature.description }
      if (!feature.match(this.context.url)) {
        this.status.set(feature.id, { ...base, state: 'unsupported', reason: 'Wrong site' })
        continue
      }
      const missing = feature.requiredCapabilities.find((cap) => !this.context.capabilities.has(cap))
      if (!feature.targets.includes(this.context.target) || missing) {
        this.status.set(feature.id, {
          ...base,
          state: 'unsupported',
          reason: missing ? `Requires ${missing}` : 'Unsupported delivery target',
        })
        continue
      }
      if (!(await this.context.settings.enabled(feature.id))) {
        this.status.set(feature.id, { ...base, state: 'disabled' })
        continue
      }
      try {
        const begin = Date.now()
        await feature.start(this.context)
        this.active.set(feature.id, feature)
        this.status.set(feature.id, { ...base, state: 'active' })
        void this.telemetry?.record('feature.started', feature.id, Date.now() - begin)
      } catch (error) {
        this.status.set(feature.id, {
          ...base,
          state: 'failed',
          reason: error instanceof Error ? error.message : 'Unknown startup error',
        })
        void this.telemetry?.record('feature.failed', feature.id)
      }
    }
  }
  async stop() {
    for (const f of [...this.active.values()].reverse())
      try {
        await f.stop?.()
        void this.telemetry?.record('feature.stopped', f.id)
      } catch {}
    this.active.clear()
    this.started = false
  }
  list(): FeatureStatus[] {
    return this.features.map(
      (f) =>
        this.status.get(f.id) ?? {
          id: f.id,
          title: f.title,
          description: f.description,
          state: 'disabled',
        },
    )
  }
  async open(id: string) {
    const feature = this.active.get(id)
    if (!feature) throw new Error(`Module is not active: ${id}`)
    await feature.open?.()
  }
  async setEnabled(id: string, value: boolean) {
    await this.context.settings.setEnabled(id, value)
    await this.stop()
    this.status.clear()
    await this.start()
  }
}
export function defaultCapabilities(_target: DeliveryTarget): ReadonlySet<Capability> {
  return new Set<Capability>(['page-dom', 'origin-storage', 'local-files'])
}
