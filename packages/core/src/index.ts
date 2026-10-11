import { instanceKey } from './instance-scope'

export { instanceKey, instanceScope, scopedIdentity } from './instance-scope'
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
export const SHELL_OPEN_FEATURE_EVENT = instanceKey('koba:open-feature')
export const SHELL_CLOSE_EVENT = instanceKey('koba:close-shell')

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
  installationEnabled() {
    return this.store.get('installation.enabled').then((value) => value !== false)
  }
  setInstallationEnabled(enabled: boolean) {
    return this.store.set('installation.enabled', enabled)
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
  private readonly listeners = new Set<() => void>()
  private started = false
  private running = true
  private operations: Promise<void> = Promise.resolve()
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
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private changed() {
    for (const listener of [...this.listeners]) listener()
  }
  private transition(task: () => Promise<void>): Promise<void> {
    const next = this.operations.then(task)
    this.operations = next.catch(() => undefined)
    return next
  }
  private async startNow() {
    if (this.started) return
    this.started = true
    this.running = await this.context.settings.installationEnabled()
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
      if (!this.running || !(await this.context.settings.enabled(feature.id))) {
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
        // Failed starts can still have partial observers or DOM mounts.
        try {
          await feature.stop?.()
        } catch {}
        this.status.set(feature.id, {
          ...base,
          state: 'failed',
          reason: error instanceof Error ? error.message : 'Unknown startup error',
        })
        void this.telemetry?.record('feature.failed', feature.id)
      }
    }
    this.changed()
  }
  private async stopNow() {
    for (const f of [...this.active.values()].reverse())
      try {
        await f.stop?.()
        void this.telemetry?.record('feature.stopped', f.id)
      } catch {}
    this.active.clear()
    this.started = false
    this.status.clear()
    this.changed()
  }
  start(): Promise<void> {
    return this.transition(() => this.startNow())
  }
  stop(): Promise<void> {
    return this.transition(() => this.stopNow())
  }
  isRunning(): boolean {
    return this.running
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
  /** Completely detach provider hooks, observers and mounts, but retain the
   * shared launcher/control panel so the installation can be re-enabled. */
  setRunning(enabled: boolean): Promise<void> {
    return this.transition(async () => {
      await this.context.settings.setInstallationEnabled(enabled)
      await this.stopNow()
      await this.startNow()
    })
  }
  setEnabled(id: string, value: boolean): Promise<void> {
    if (!this.features.some((feature) => feature.id === id))
      return Promise.reject(Error(`Unknown module ${id}`))
    return this.transition(async () => {
      await this.context.settings.setEnabled(id, value)
      await this.stopNow()
      await this.startNow()
    })
  }
}

export function defaultCapabilities(_target: DeliveryTarget): ReadonlySet<Capability> {
  return new Set<Capability>(['page-dom', 'origin-storage', 'local-files'])
}

export type { ScopedTelemetryEvent, ScopedTelemetryName, ScopedTelemetrySink } from './scoped-telemetry'
export {
  isScopedTelemetryName,
  SCOPED_TELEMETRY_SCHEMA_VERSION,
  ScopedTelemetry,
} from './scoped-telemetry'
