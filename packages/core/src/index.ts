import { type ApplicationLanguagePreference, isApplicationLanguage } from './application-locale'
import { shellInstanceKey } from './instance-scope'

export * from './application-locale'

export type {
  AutomationAction,
  AutomationCommand,
  AutomationCommandAction,
  AutomationCommandResult,
  AutomationCompletionOutcome,
  AutomationConfiguration,
  AutomationDispatchResult,
  AutomationEngine,
  AutomationEngineOptions,
  AutomationEvent,
  AutomationEventContext,
  AutomationEventHub,
  AutomationEventListener,
  AutomationEventType,
  AutomationOrigin,
  AutomationPattern,
  AutomationRule,
  AutomationTrigger,
  RemoteCommandKind,
  RemoteCommandPayloadMap,
  RemoteSessionConfig,
  RemoteSessionMode,
  TriggerCommandKind,
} from './automation'
export {
  createAutomationEngine,
  createAutomationEventHub,
  DEFAULT_AUTOMATION_CONFIGURATION,
  DEFAULT_REMOTE_SESSION_CONFIG,
  normalizeAutomationConfiguration,
  normalizeRemoteSessionConfig,
  REMOTE_COMMAND_KINDS,
  validateAutomationRule,
  validateAutomationRules,
  validateRemoteCommandPayload,
} from './automation'
export type { AutomationTriggerDraft, AutomationTriggerDraftState } from './automation-trigger-draft'
export { createAutomationTriggerDraft } from './automation-trigger-draft'
export {
  instanceKey,
  instanceScope,
  scopedIdentity,
  scopedShellIdentity,
  shellInstanceKey,
} from './instance-scope'
export type { RemoteSessionProbeResult, RemoteSessionStatus } from './remote-session'
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
export const SHELL_OPEN_FEATURE_EVENT = shellInstanceKey('koba:open-feature')
export const SHELL_CLOSE_EVENT = shellInstanceKey('koba:close-shell')
export const SHELL_RESTORE_UI_EVENT = shellInstanceKey('koba:restore-ui')

export interface FeatureContext {
  readonly target: DeliveryTarget
  readonly url: URL
  readonly capabilities: ReadonlySet<Capability>
  readonly settings: FeatureSettings
}
export interface FeatureQuickMetric {
  readonly label: string
  readonly labelEn?: string
  readonly moduleId?: string
  /** Counts are provided by the verified provider, never inferred by the shell. */
  readonly value: string | number
}
/** Provider-owned technical presentation signals; never conversation or credential data. */
export interface FeatureIndicator {
  readonly id: string
  readonly label: string
  readonly labelEn?: string
  readonly status: 'idle' | 'active' | 'success' | 'warning' | 'error' | 'offline' | 'connecting'
  readonly detail?: string
  readonly detailEn?: string
}
export interface FeatureIndicators {
  current(): readonly FeatureIndicator[]
  subscribe(listener: () => void): () => void
}
/** A neutral catalog contribution. The provider owns settings/workflow presentation.
 * Restoring a category must not replay capture, export or other user operations. */
export interface FeatureSettingsCategory {
  readonly id: string
  readonly title: string
  readonly titleEn?: string
  readonly description?: string
  readonly descriptionEn?: string
  /** Grouping nodes contain categories; only leaves are safe presentation routes. */
  readonly children?: readonly FeatureSettingsCategory[]
}
/** Stable leaf IDs are unique across one provider tree, regardless of depth.
 * This shared allowlist is used by navigation, session restore and backup. */
export function flattenFeatureSettingsCategories(
  categories: readonly FeatureSettingsCategory[],
): readonly FeatureSettingsCategory[] {
  const leaves: FeatureSettingsCategory[] = []
  const names = new Set<string>()
  function visit(items: readonly FeatureSettingsCategory[], depth: number): void {
    if (depth > 8) throw Error('Settings category hierarchy is too deep')
    for (const item of items) {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || names.has(item.id))
        throw Error(`Invalid or duplicate settings category id: ${item.id}`)
      names.add(item.id)
      if (item.children?.length) visit(item.children, depth + 1)
      else leaves.push(item)
    }
  }
  visit(categories, 0)
  return leaves
}
export interface FeatureSettingsContribution {
  readonly categories: readonly FeatureSettingsCategory[]
  /** Safe presentation state, independent of data operations or panel visibility. */
  currentCategory?(): string
  subscribe?(listener: () => void): () => void
  restoreCategory?(categoryId: string): void | Promise<void>
  open(categoryId: string): void | Promise<void>
}
export interface ShellPreferences {
  readonly language: ApplicationLanguagePreference
  readonly launcher: boolean
  readonly siteEntry: boolean
  readonly quickMenu: boolean
  readonly metrics: boolean
}
export interface FeatureQuickAction {
  readonly id: string
  /** Bind availability to an independently enabled provider capability. */
  readonly moduleId?: string
  readonly label: string
  readonly labelEn?: string
  readonly icon?: 'archive' | 'collect' | 'export' | 'settings' | 'capture' | 'open'
  /** Default: the action owns navigation; never unconditionally open the panel. */
  readonly after?: 'close-menu' | 'keep-menu' | 'open-panel'
  /** Override for recovery/settings actions that can run while the feature is off. */
  readonly availableWhenDisabled?: boolean
  /** Hide context-specific tools outside their owning page, rather than showing disabled clutter. */
  readonly visible?: () => boolean
  /** Source-owned context check; the shared shell never inspects private accounts. */
  readonly enabled?: () => boolean
  readonly run: () => void | Promise<void>
}
/** A provider can replace the launcher click entirely without editing the shell. */
export interface FeatureLauncher {
  readonly mode: 'quick-menu' | 'panel' | 'action'
  readonly run?: () => void | Promise<void>
}
/** Independently enabled provider capability (capture, sound, injection, etc.). */
export interface FeatureModule {
  readonly id: string
  readonly title: string
  readonly titleEn?: string
  readonly description: string
  readonly descriptionEn?: string
  readonly defaultEnabled?: boolean
  readonly requiredCapabilities?: readonly Capability[]
  readonly settingsCategory?: string
  readonly available?: (context: FeatureContext) => boolean
  start(context: FeatureContext): void | Promise<void>
  stop?(): void | Promise<void>
}
export interface Feature {
  readonly id: FeatureId
  readonly title: string
  readonly titleEn?: string
  readonly description: string
  readonly descriptionEn?: string
  /** Read-only compatibility seed, used once if the installation has no common preference. */
  readonly legacyLanguagePreference?: () => Promise<ApplicationLanguagePreference | undefined>
  /** Provider-independent view sizing; default is standard. */
  readonly presentation?: {
    readonly panel: 'standard' | 'wide'
    readonly version?: string
    readonly installation?: string
    /** Recreate a service-bound provider view when this child lifecycle changes. */
    readonly viewModuleId?: string
    /** Discard unconsumed view commands when leaving; running services stay independent. */
    readonly onViewHidden?: () => void
  }
  /** Product-owned actions rendered by the shared compact edge menu. */
  readonly quickActions?: readonly FeatureQuickAction[]
  readonly quickMetrics?: () => Promise<readonly FeatureQuickMetric[]>
  readonly indicators?: FeatureIndicators
  /** A provider signals navigation/context changes without exposing account or archive data. */
  readonly subscribeQuickContext?: (listener: () => void) => () => void
  readonly launcher?: FeatureLauncher
  /** Product categories are discoverable in the common settings catalog. */
  readonly settings?: FeatureSettingsContribution
  readonly modules?: readonly FeatureModule[]
  readonly backup?: import('./application-backup').ApplicationBackupProvider
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
  getText?(key: string): Promise<string | undefined>
  setText?(key: string, value: string): Promise<void>
}
export class FeatureSettings {
  constructor(private readonly store: SettingsStore) {}
  async languagePreference(): Promise<ApplicationLanguagePreference | undefined> {
    const value = await this.store.getText?.('ui.language')
    return isApplicationLanguage(value) ? value : undefined
  }
  async setLanguagePreference(value: ApplicationLanguagePreference): Promise<void> {
    if (!isApplicationLanguage(value) || !this.store.setText) throw Error('Invalid language setting')
    await this.store.setText('ui.language', value)
  }
  async seedLanguagePreference(
    value: ApplicationLanguagePreference,
  ): Promise<ApplicationLanguagePreference> {
    // A user in another tab may have selected a language while the legacy read awaited.
    const current = await this.languagePreference()
    if (current !== undefined) return current
    if (this.store.setText) await this.setLanguagePreference(value)
    return value
  }
  enabled(id: string) {
    return this.store.get(`features.${id}.enabled`).then((value) => value !== false)
  }
  setEnabled(id: string, enabled: boolean) {
    return this.store.set(`features.${id}.enabled`, enabled)
  }
  moduleEnabled(featureId: string, moduleId: string, defaultEnabled = true) {
    return this.store
      .get(`features.${featureId}.modules.${moduleId}.enabled`)
      .then((value) => value ?? defaultEnabled)
  }
  setModuleEnabled(featureId: string, moduleId: string, enabled: boolean) {
    return this.store.set(`features.${featureId}.modules.${moduleId}.enabled`, enabled)
  }
  installationEnabled() {
    return this.store.get('installation.enabled').then((value) => value !== false)
  }
  setInstallationEnabled(enabled: boolean) {
    return this.store.set('installation.enabled', enabled)
  }
  launcherEnabled() {
    return this.store.get('ui.launcher.enabled').then((value) => value !== false)
  }
  setLauncherEnabled(enabled: boolean) {
    return this.store.set('ui.launcher.enabled', enabled)
  }
  siteEntryEnabled() {
    return this.store.get('ui.site-entry.enabled').then((value) => value === true)
  }
  setSiteEntryEnabled(enabled: boolean) {
    return this.store.set('ui.site-entry.enabled', enabled)
  }
  quickMenuEnabled() {
    return this.store.get('ui.quick-menu.enabled').then((value) => value !== false)
  }
  setQuickMenuEnabled(enabled: boolean) {
    return this.store.set('ui.quick-menu.enabled', enabled)
  }
  metricsEnabled() {
    return this.store.get('ui.metrics.enabled').then((value) => value !== false)
  }
  setMetricsEnabled(enabled: boolean) {
    return this.store.set('ui.metrics.enabled', enabled)
  }
}
export type FeatureStatus = {
  id: string
  title: string
  titleEn?: string
  description: string
  descriptionEn?: string
  state: 'active' | 'disabled' | 'unsupported' | 'failed'
  reason?: string
}
export type FeatureModuleStatus = FeatureStatus & {
  featureId: string
  settingsCategory?: string
  enabled: boolean
}
export class FeatureRuntime {
  private readonly active = new Map<string, Feature>()
  private readonly status = new Map<string, FeatureStatus>()
  private readonly activeModules = new Map<string, FeatureModule>()
  private readonly featureCleanupPending = new Set<string>()
  private readonly moduleCleanupPending = new Set<string>()
  private readonly moduleStatus = new Map<string, FeatureModuleStatus>()
  private readonly featureEnabled = new Map<string, boolean>()
  private readonly listeners = new Set<() => void>()
  private started = false
  private running = true
  private shell: ShellPreferences = {
    language: 'auto',
    launcher: true,
    siteEntry: false,
    quickMenu: true,
    metrics: true,
  }
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
      const categoryIds = new Set(
        flattenFeatureSettingsCategories(feature.settings?.categories ?? []).map((item) => item.id),
      )
      const moduleIds = new Set<string>()
      for (const module of feature.modules ?? []) {
        if (!/^[a-z][a-z0-9-]+$/.test(module.id) || moduleIds.has(module.id))
          throw new Error(`Invalid or duplicate capability id: ${feature.id}/${module.id}`)
        moduleIds.add(module.id)
        if (module.settingsCategory && feature.settings && !categoryIds.has(module.settingsCategory))
          throw Error(`Unknown settings category: ${feature.id}/${module.settingsCategory}`)
      }
    }
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private changed() {
    for (const listener of [...this.listeners])
      try {
        listener()
      } catch {
        // Presentation observers cannot fail a completed lifecycle/storage operation.
      }
  }
  private transition(task: () => Promise<void>): Promise<void> {
    const next = this.operations.then(async () => {
      try {
        await task()
      } finally {
        // A rejected teardown still changes status; the shell must show it.
        this.changed()
      }
    })
    this.operations = next.catch(() => undefined)
    return next
  }
  /** Serialize recovery with settings/lifecycle changes. The callback must not
   * call queued runtime methods; they would wait for this maintenance task. */
  runMaintenance(action: () => Promise<void>): Promise<void> {
    return this.transition(action)
  }
  private async startModule(feature: Feature, module: FeatureModule) {
    const key = `${feature.id}/${module.id}`
    if (this.featureCleanupPending.has(feature.id))
      throw Error('Provider cleanup must complete before starting a capability')
    if (this.moduleCleanupPending.has(key)) await this.stopModule(feature.id, module.id)
    const enabled = await this.context.settings.moduleEnabled(
      feature.id,
      module.id,
      module.defaultEnabled,
    )
    const base = {
      id: module.id,
      featureId: feature.id,
      title: module.title,
      titleEn: module.titleEn,
      description: module.description,
      descriptionEn: module.descriptionEn,
      settingsCategory: module.settingsCategory,
      enabled,
    }
    const missing = module.requiredCapabilities?.find(
      (capability) => !this.context.capabilities.has(capability),
    )
    if (missing || module.available?.(this.context) === false) {
      if (this.activeModules.has(key)) await this.stopModule(feature.id, module.id)
      this.moduleStatus.set(key, {
        ...base,
        state: 'unsupported',
        reason: missing ? `Requires ${missing}` : 'Unavailable in this context',
      })
      return
    }
    if (!this.active.has(feature.id) || !enabled) {
      if (this.activeModules.has(key)) await this.stopModule(feature.id, module.id)
      this.moduleStatus.set(key, { ...base, state: 'disabled' })
      return
    }
    if (this.activeModules.has(key)) return
    // start() may attach a hook before rejecting. Retain ownership until stop()
    // acknowledges cleanup, even when startup never reached the active state.
    this.activeModules.set(key, module)
    try {
      await module.start(this.context)
      this.moduleStatus.set(key, { ...base, state: 'active' })
    } catch {
      try {
        await this.stopModule(feature.id, module.id)
        this.moduleStatus.set(key, { ...base, state: 'failed', reason: 'Capability failed to start' })
      } catch {
        this.moduleStatus.set(key, {
          ...base,
          state: 'failed',
          reason: 'Capability startup and cleanup failed',
        })
      }
      void this.telemetry?.record('feature.failed', feature.id)
    }
  }
  private async stopModule(featureId: string, moduleId: string) {
    const key = `${featureId}/${moduleId}`
    const module = this.activeModules.get(key)
    try {
      await module?.stop?.()
    } catch (error) {
      this.moduleCleanupPending.add(key)
      const status = this.moduleStatus.get(key)
      if (status)
        this.moduleStatus.set(key, { ...status, state: 'failed', reason: 'Capability cleanup failed' })
      throw Error(`Capability cleanup failed: ${key}`, { cause: error })
    }
    this.activeModules.delete(key)
    this.moduleCleanupPending.delete(key)
    const status = this.moduleStatus.get(key)
    if (status)
      this.moduleStatus.set(key, {
        ...status,
        state: 'disabled',
        reason: undefined,
      })
  }
  private async stopFeature(feature: Feature) {
    const failures: unknown[] = []
    for (const module of [...(feature.modules ?? [])].reverse()) {
      try {
        await this.stopModule(feature.id, module.id)
      } catch (error) {
        failures.push(error)
      }
    }
    // Child resources may depend on the provider. Keep it alive for retry if a
    // child cannot detach; disposing it would make that cleanup irrecoverable.
    if (failures.length === 0 && this.active.has(feature.id)) {
      try {
        await feature.stop?.()
        this.active.delete(feature.id)
        void this.telemetry?.record('feature.stopped', feature.id)
      } catch (error) {
        failures.push(error)
      }
    }
    const base = {
      id: feature.id,
      title: feature.title,
      titleEn: feature.titleEn,
      description: feature.description,
      descriptionEn: feature.descriptionEn,
    }
    if (failures.length) {
      this.featureCleanupPending.add(feature.id)
      this.status.set(feature.id, { ...base, state: 'failed', reason: 'Provider cleanup failed' })
      throw new AggregateError(failures, `Provider cleanup failed: ${feature.id}`)
    }
    this.featureCleanupPending.delete(feature.id)
    this.status.set(feature.id, { ...base, state: 'disabled' })
  }
  private async startFeature(feature: Feature) {
    if (this.featureCleanupPending.has(feature.id)) await this.stopFeature(feature)
    const base = {
      id: feature.id,
      title: feature.title,
      titleEn: feature.titleEn,
      description: feature.description,
      descriptionEn: feature.descriptionEn,
    }
    const enabled = await this.context.settings.enabled(feature.id)
    this.featureEnabled.set(feature.id, enabled)
    for (const module of feature.modules ?? []) {
      if (this.activeModules.has(`${feature.id}/${module.id}`)) continue
      this.moduleStatus.set(`${feature.id}/${module.id}`, {
        id: module.id,
        featureId: feature.id,
        title: module.title,
        titleEn: module.titleEn,
        description: module.description,
        descriptionEn: module.descriptionEn,
        settingsCategory: module.settingsCategory,
        state: 'disabled',
        enabled: await this.context.settings.moduleEnabled(feature.id, module.id, module.defaultEnabled),
      })
    }
    if (!feature.match(this.context.url)) {
      this.status.set(feature.id, { ...base, state: 'unsupported', reason: 'Wrong site' })
      return
    }
    const missing = feature.requiredCapabilities.find((cap) => !this.context.capabilities.has(cap))
    if (!feature.targets.includes(this.context.target) || missing) {
      this.status.set(feature.id, {
        ...base,
        state: 'unsupported',
        reason: missing ? `Requires ${missing}` : 'Unsupported delivery target',
      })
      return
    }
    if (!this.running || !enabled) {
      this.status.set(feature.id, { ...base, state: 'disabled' })
      return
    }
    if (this.active.has(feature.id)) return
    this.active.set(feature.id, feature)
    try {
      const begin = Date.now()
      await feature.start(this.context)
      this.status.set(feature.id, { ...base, state: 'active' })
      for (const module of feature.modules ?? []) await this.startModule(feature, module)
      void this.telemetry?.record('feature.started', feature.id, Date.now() - begin)
    } catch (error) {
      try {
        await this.stopFeature(feature)
        this.status.set(feature.id, {
          ...base,
          state: 'failed',
          reason: error instanceof Error ? error.message : 'Unknown startup error',
        })
      } catch {
        this.status.set(feature.id, {
          ...base,
          state: 'failed',
          reason: 'Provider startup and cleanup failed',
        })
      }
      void this.telemetry?.record('feature.failed', feature.id)
    }
  }
  private async startNow() {
    if (this.started) return
    this.started = true
    this.running = await this.context.settings.installationEnabled()
    let language = await this.context.settings.languagePreference()
    if (language === undefined) {
      for (const feature of this.features.filter((item) => item.match(this.context.url))) {
        let legacy: ApplicationLanguagePreference | undefined
        try {
          legacy = await feature.legacyLanguagePreference?.()
        } catch {
          // A provider's old settings may be unavailable; common settings must still open.
          continue
        }
        if (legacy !== undefined && legacy !== 'auto' && isApplicationLanguage(legacy)) {
          language = await this.context.settings.seedLanguagePreference(legacy)
          break
        }
      }
    }
    this.shell = {
      language: language ?? 'auto',
      launcher: await this.context.settings.launcherEnabled(),
      siteEntry: await this.context.settings.siteEntryEnabled(),
      quickMenu: await this.context.settings.quickMenuEnabled(),
      metrics: await this.context.settings.metricsEnabled(),
    }
    const failures: unknown[] = []
    for (const feature of this.features) {
      try {
        await this.startFeature(feature)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) {
      this.started = false
      throw new AggregateError(failures, 'Installation could not restart before cleanup')
    }
  }
  private async stopNow() {
    const failures: unknown[] = []
    for (const feature of [...this.features].reverse()) {
      try {
        await this.stopFeature(feature)
      } catch (error) {
        failures.push(error)
      }
    }
    this.started = false
    if (failures.length) throw new AggregateError(failures, 'Installation cleanup failed')
    this.moduleStatus.clear()
    this.status.clear()
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
  shellPreferences(): ShellPreferences {
    return { ...this.shell }
  }
  setShellPreferences(patch: Partial<ShellPreferences>): Promise<void> {
    return this.transition(async () => {
      if (patch.language !== undefined) await this.context.settings.setLanguagePreference(patch.language)
      if (typeof patch.launcher === 'boolean')
        await this.context.settings.setLauncherEnabled(patch.launcher)
      if (typeof patch.siteEntry === 'boolean')
        await this.context.settings.setSiteEntryEnabled(patch.siteEntry)
      if (typeof patch.quickMenu === 'boolean')
        await this.context.settings.setQuickMenuEnabled(patch.quickMenu)
      if (typeof patch.metrics === 'boolean')
        await this.context.settings.setMetricsEnabled(patch.metrics)
      this.shell = {
        language: patch.language ?? this.shell.language,
        launcher: typeof patch.launcher === 'boolean' ? patch.launcher : this.shell.launcher,
        siteEntry: typeof patch.siteEntry === 'boolean' ? patch.siteEntry : this.shell.siteEntry,
        quickMenu: typeof patch.quickMenu === 'boolean' ? patch.quickMenu : this.shell.quickMenu,
        metrics: typeof patch.metrics === 'boolean' ? patch.metrics : this.shell.metrics,
      }
    })
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
  moduleList(): FeatureModuleStatus[] {
    return this.features.flatMap((feature) =>
      (feature.modules ?? []).map(
        (module) =>
          this.moduleStatus.get(`${feature.id}/${module.id}`) ?? {
            id: module.id,
            featureId: feature.id,
            title: module.title,
            description: module.description,
            settingsCategory: module.settingsCategory,
            state: 'disabled',
            enabled: module.defaultEnabled !== false,
          },
      ),
    )
  }
  setModuleEnabled(featureId: string, moduleId: string, enabled: boolean): Promise<void> {
    const feature = this.features.find((item) => item.id === featureId)
    const module = feature?.modules?.find((item) => item.id === moduleId)
    if (!feature || !module) return Promise.reject(Error('Unknown provider capability'))
    return this.transition(async () => {
      await this.context.settings.setModuleEnabled(featureId, moduleId, enabled)
      const previous = this.moduleStatus.get(`${featureId}/${moduleId}`)
      if (previous) this.moduleStatus.set(`${featureId}/${moduleId}`, { ...previous, enabled })
      if (enabled && this.active.has(featureId)) await this.startModule(feature, module)
      else await this.stopModule(featureId, moduleId)
      const key = `${featureId}/${moduleId}`
      const status = this.moduleStatus.get(key)
      this.moduleStatus.set(
        key,
        status
          ? { ...status, enabled }
          : {
              id: module.id,
              featureId,
              title: module.title,
              description: module.description,
              settingsCategory: module.settingsCategory,
              state: 'disabled',
              enabled,
            },
      )
    })
  }
  async open(id: string) {
    const feature = this.active.get(id)
    if (!feature || this.status.get(id)?.state !== 'active')
      throw new Error(`Module is not active: ${id}`)
    await feature.open?.()
  }
  /** Completely detach provider hooks, observers and mounts, but retain the
   * shared launcher/control panel so the installation can be re-enabled. */
  setRunning(enabled: boolean): Promise<void> {
    return this.transition(async () => {
      await this.context.settings.setInstallationEnabled(enabled)
      this.running = enabled
      await this.stopNow()
      await this.startNow()
    })
  }
  /** Another tab of this same scoped installation changed durable enablement.
   * Replay the lifecycle without writing storage, so no cross-tab event loop. */
  refreshFromSettings(): Promise<void> {
    return this.transition(async () => {
      const enabled = await this.context.settings.installationEnabled()
      this.shell = {
        language: (await this.context.settings.languagePreference()) ?? 'auto',
        launcher: await this.context.settings.launcherEnabled(),
        siteEntry: await this.context.settings.siteEntryEnabled(),
        quickMenu: await this.context.settings.quickMenuEnabled(),
        metrics: await this.context.settings.metricsEnabled(),
      }
      if (enabled === this.running) {
        for (const feature of this.features) {
          const featureWanted = await this.context.settings.enabled(feature.id)
          if (
            featureWanted !== this.featureEnabled.get(feature.id) ||
            this.featureCleanupPending.has(feature.id)
          ) {
            if (!featureWanted || !this.running) await this.stopFeature(feature)
            await this.startFeature(feature)
          }
          for (const module of feature.modules ?? []) {
            const wanted = await this.context.settings.moduleEnabled(
              feature.id,
              module.id,
              module.defaultEnabled,
            )
            const previous = this.moduleStatus.get(`${feature.id}/${module.id}`)?.enabled
            if (wanted !== previous || this.moduleCleanupPending.has(`${feature.id}/${module.id}`)) {
              if (!wanted) await this.stopModule(feature.id, module.id)
              await this.startModule(feature, module)
            }
          }
        }
        return
      }
      await this.stopNow()
      await this.startNow()
    })
  }
  setEnabled(id: string, value: boolean): Promise<void> {
    const feature = this.features.find((item) => item.id === id)
    if (!feature) return Promise.reject(Error(`Unknown module ${id}`))
    return this.transition(async () => {
      await this.context.settings.setEnabled(id, value)
      if (!value) await this.stopFeature(feature)
      await this.startFeature(feature)
    })
  }
}

export function defaultCapabilities(_target: DeliveryTarget): ReadonlySet<Capability> {
  return new Set<Capability>(['page-dom', 'origin-storage', 'local-files'])
}

export type {
  ApplicationBackupController,
  ApplicationBackupProvider,
  ApplicationBackupSource,
  BackupFileOutput,
  BackupInspection,
  BackupRecoveryInfo,
  BackupRecoveryReference,
  BackupRow,
  BackupRowReader,
  BackupScope,
  BackupSectionInfo,
  BackupSectionKind,
} from './application-backup'
export { APPLICATION_BACKUP } from './application-backup'
export type {
  ApplicationTelemetryConfiguration,
  ApplicationTelemetryController,
  ApplicationTelemetryQuery,
  ApplicationTelemetryRecord,
  ApplicationTelemetryStatus,
} from './application-telemetry'
export {
  APPLICATION_TELEMETRY,
  classifyTelemetryError,
  reportTelemetryError,
} from './application-telemetry'
export type {
  ScopedTelemetryContext,
  ScopedTelemetryEvent,
  ScopedTelemetryName,
  ScopedTelemetrySink,
  TelemetryProviderId,
} from './scoped-telemetry'
export {
  isScopedTelemetryName,
  isTelemetryErrorClass,
  isTelemetryProviderId,
  SCOPED_TELEMETRY_SCHEMA_VERSION,
  ScopedTelemetry,
} from './scoped-telemetry'
