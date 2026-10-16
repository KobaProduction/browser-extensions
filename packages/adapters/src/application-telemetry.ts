import {
  type ApplicationTelemetryConfiguration,
  type ApplicationTelemetryController,
  type ApplicationTelemetryQuery,
  type ApplicationTelemetryRecord,
  type ApplicationTelemetryStatus,
  type DeliveryTarget,
  instanceScope,
  isScopedTelemetryName,
  isTelemetryErrorClass,
  isTelemetryProviderId,
  type SettingsStore,
  type TelemetryProviderId,
} from '@kobaproduction/browser-core'
import type { ServiceScope, TelemetryEntry, TelemetryJournal } from '@kobaproduction/browser-storage'
import {
  type OtlpSender,
  resolveOtlpLogsEndpoint,
  ScopedOtlpService,
  sendOtlpRequest,
  TelemetryCollectorRejected,
  TelemetryPermissionRequired,
} from './scoped-otlp'
import {
  createChromiumTelemetryClient,
  createUserscriptTelemetryPersistence,
  userscriptTelemetrySender,
} from './telemetry-bridge'

declare const __BOOSTER_BUILD_VERSION__: string | undefined
declare const __BOOSTER_APPLICATION_VERSION__: string | undefined

const OPT_IN_KEY = 'telemetry.local.enabled'
export const DEFAULT_TELEMETRY_CONFIGURATION: ApplicationTelemetryConfiguration = {
  schemaVersion: 1,
  remoteEnabled: false,
  endpoint: '',
  maxEvents: 5000,
  maxAgeDays: 7,
  rotationMinutes: 5,
}
export function validateTelemetryConfiguration(value: unknown): ApplicationTelemetryConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Некорректные параметры телеметрии.')
  const v = value as Record<string, unknown>
  if (
    Object.keys(v).some(
      (key) =>
        ![
          'schemaVersion',
          'remoteEnabled',
          'endpoint',
          'maxEvents',
          'maxAgeDays',
          'rotationMinutes',
        ].includes(key),
    ) ||
    v.schemaVersion !== 1 ||
    typeof v.remoteEnabled !== 'boolean' ||
    typeof v.endpoint !== 'string' ||
    typeof v.maxEvents !== 'number' ||
    !Number.isSafeInteger(v.maxEvents) ||
    v.maxEvents < 100 ||
    v.maxEvents > 5000 ||
    typeof v.maxAgeDays !== 'number' ||
    !Number.isSafeInteger(v.maxAgeDays) ||
    v.maxAgeDays < 1 ||
    v.maxAgeDays > 90 ||
    typeof v.rotationMinutes !== 'number' ||
    !Number.isSafeInteger(v.rotationMinutes) ||
    v.rotationMinutes < 1 ||
    v.rotationMinutes > 60
  )
    throw Error('Проверьте лимит (100–5000), срок (1–90 дней) и интервал (1–60 минут).')
  const endpoint = v.endpoint.trim() ? resolveOtlpLogsEndpoint(v.endpoint) : ''
  if (v.remoteEnabled && !endpoint) throw Error('Для внешней телеметрии нужен HTTPS endpoint.')
  return {
    schemaVersion: 1,
    remoteEnabled: v.remoteEnabled,
    endpoint,
    maxEvents: v.maxEvents,
    maxAgeDays: v.maxAgeDays,
    rotationMinutes: v.rotationMinutes,
  }
}
function safeRecord(row: TelemetryEntry): ApplicationTelemetryRecord | null {
  if (row.id === undefined || !isScopedTelemetryName(row.name)) return null
  return {
    id: row.id,
    name: row.name,
    timestamp: row.timestamp,
    providerId: isTelemetryProviderId(row.providerId) ? row.providerId : 'application',
    state: row.state,
    attempts: row.attempts,
    ...(row.count === undefined ? {} : { count: row.count }),
    ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }),
    ...(isTelemetryErrorClass(row.errorClass) ? { errorClass: row.errorClass } : {}),
  }
}
export interface ApplicationTelemetryOptions {
  sender?: OtlpSender
  requestPermission?: (endpoint: string) => Promise<boolean>
  remoteAvailable?: boolean
  /** MV3 worker owns the service; content scripts use the bridge. */
  local?: boolean
}
function unavailableTelemetry(): ApplicationTelemetryController {
  const unavailable = async (): Promise<never> => {
    throw Error('Сервис телеметрии недоступен: проверьте разрешения установки.')
  }
  return {
    async status() {
      return {
        available: false,
        localEnabled: false,
        remoteAvailable: false,
        remoteEnabled: false,
        pending: null,
        discarded: null,
        retained: null,
        delivered: null,
        deliveryState: 'unavailable',
        lastSentAt: null,
        nextAttemptAt: null,
        lastRotationAt: null,
        providers: [],
      }
    },
    async configuration() {
      return { ...DEFAULT_TELEMETRY_CONFIGURATION }
    },
    async probeEndpoint(endpoint) {
      return { ok: false, endpoint, errorCode: 'unavailable' }
    },
    configure: unavailable,
    setLocalEnabled: unavailable,
    setRemoteEnabled: unavailable,
    async records() {
      return []
    },
    exportRecords: unavailable,
    clearRecords: unavailable,
    async flush() {
      return 0
    },
    async record() {},
    subscribe() {
      return () => undefined
    },
    close() {},
  }
}

/** One owner per product/channel/target. No records, account identities or raw errors. */
export function createApplicationTelemetry(
  target: DeliveryTarget,
  store: SettingsStore,
  scopeId = instanceScope(),
  journal?: TelemetryJournal,
  options: ApplicationTelemetryOptions = {},
): ApplicationTelemetryController {
  if (target === 'chromium' && !journal && !options.local && typeof document !== 'undefined')
    return createChromiumTelemetryClient(scopeId)
  const match = /^(vk-booster|chatgpt-booster|all-in-one):(dev|prod)$/.exec(scopeId)
  if (!match) throw Error('Telemetry requires compiled product/channel identity')
  const productId = match[1] ?? ''
  const scope: ServiceScope = {
    productId,
    channel: match[2] as 'dev' | 'prod',
    installationId: `${productId}-${target}`,
  }
  const gm = target === 'userscript' && !journal ? createUserscriptTelemetryPersistence(scope) : null
  // An origin-local fallback would silently split an aggregate's journal across its sites.
  if (target === 'userscript' && !journal && !gm) return unavailableTelemetry()
  const settings = gm?.settings ?? store
  const suppliedVersion =
    typeof __BOOSTER_APPLICATION_VERSION__ === 'string'
      ? __BOOSTER_APPLICATION_VERSION__
      : typeof __BOOSTER_BUILD_VERSION__ === 'string'
        ? __BOOSTER_BUILD_VERSION__
        : '0.0.0'
  const version = /^\d+\.\d+\.\d+$/.test(suppliedVersion) ? suppliedVersion : '0.0.0'
  const listeners = new Set<() => void>()
  let enabled = false
  let closed = false
  let configuration = { ...DEFAULT_TELEMETRY_CONFIGURATION }
  let rotation: ReturnType<typeof setTimeout> | undefined
  let loading: Promise<void> | undefined
  let writes: Promise<void> = Promise.resolve()
  const remoteAvailable =
    options.remoteAvailable ?? (target === 'chromium' || Boolean(userscriptTelemetrySender()))
  const notify = () => {
    if (!closed)
      for (const listener of listeners) {
        try {
          listener()
        } catch {}
      }
  }
  const sender =
    options.sender ??
    (target === 'userscript' ? userscriptTelemetrySender() : undefined) ??
    sendOtlpRequest
  const service: ScopedOtlpService = new ScopedOtlpService({
    scope,
    version,
    serviceId:
      productId === 'vk-booster'
        ? 'VK Booster Service'
        : productId === 'chatgpt-booster'
          ? 'ChatGPT Booster Service'
          : 'Koba Browser Tools',
    ...((journal ?? gm?.journal) ? { journal: journal ?? gm?.journal } : {}),
    changed: (delivery) => {
      notify()
      if (!closed) return service.journal.writeDeliveryStatus(delivery).catch(() => undefined)
    },
    sender: async (request) => {
      const current = await readConfiguration()
      if (
        closed ||
        !(await settings.get(OPT_IN_KEY)) ||
        !current.remoteEnabled ||
        current.endpoint !== request.url
      )
        throw Error('Telemetry consent revoked')
      if (target === 'chromium') {
        const origin = new URL(request.url).origin
        if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] })))
          throw new TelemetryPermissionRequired()
      }
      await sender(request)
    },
  })
  async function readConfiguration(): Promise<ApplicationTelemetryConfiguration> {
    const saved = await service.journal.readConfiguration()
    return saved === undefined
      ? { ...DEFAULT_TELEMETRY_CONFIGURATION }
      : validateTelemetryConfiguration(saved)
  }
  function scheduleRotation(): void {
    if (rotation !== undefined) clearTimeout(rotation)
    rotation = undefined
    if (!enabled || closed) return
    rotation = setTimeout(() => {
      rotation = undefined
      void (async () => {
        try {
          configuration = await readConfiguration()
          if ((await settings.get(OPT_IN_KEY)) === true)
            await service.journal.prune(configuration.maxEvents, configuration.maxAgeDays * 86400000)
        } catch {
          /* Storage failures never erase/reset the journal. */
        }
        notify()
        scheduleRotation()
      })()
    }, configuration.rotationMinutes * 60_000)
  }
  function syncDelivery(): void {
    if (enabled && configuration.remoteEnabled && remoteAvailable)
      service.startDelivery(async () => {
        configuration = await readConfiguration()
        const consent = (await settings.get(OPT_IN_KEY)) === true
        if (!consent || !configuration.remoteEnabled) service.stopDelivery()
        return { enabled: consent && configuration.remoteEnabled, endpoint: configuration.endpoint }
      })
    else service.stopDelivery()
  }
  function initialize(): Promise<void> {
    if (!loading)
      loading = (async () => {
        try {
          enabled = (await settings.get(OPT_IN_KEY)) === true
          configuration = await readConfiguration()
          service.restoreDeliveryStatus(await service.journal.readDeliveryStatus())
        } catch {
          enabled = false
          configuration = { ...DEFAULT_TELEMETRY_CONFIGURATION }
        }
        if (closed) return
        service.setLocalEnabled(enabled)
        if (enabled) {
          try {
            const summary = await service.journal.summary()
            if (
              !summary.lastRotationAt ||
              Date.now() - summary.lastRotationAt >= configuration.rotationMinutes * 60_000
            )
              await service.journal.prune(configuration.maxEvents, configuration.maxAgeDays * 86400000)
          } catch {
            /* Never reset a failed store. */
          }
        }
        scheduleRotation()
        syncDelivery()
        await service.persistDeliveryStatus()
        notify()
      })()
    return loading
  }
  function mutate(work: () => Promise<void>): Promise<void> {
    const next = writes.then(async () => {
      await initialize()
      if (closed) throw Error('Telemetry controller closed')
      await work()
      await service.persistDeliveryStatus()
      notify()
    })
    writes = next.catch(() => undefined)
    return next
  }
  void initialize()
  return {
    async status(): Promise<ApplicationTelemetryStatus> {
      await initialize()
      if (!closed) {
        try {
          const currentEnabled = (await settings.get(OPT_IN_KEY)) === true
          const currentConfiguration = await readConfiguration()
          const changed =
            currentEnabled !== enabled ||
            JSON.stringify(configuration) !== JSON.stringify(currentConfiguration)
          enabled = currentEnabled
          configuration = currentConfiguration
          if (changed) {
            service.setLocalEnabled(enabled)
            scheduleRotation()
            syncDelivery()
          }
        } catch {
          /* Preserve readable local diagnostics if settings are temporarily unavailable. */
        }
      }
      let summary: Awaited<ReturnType<TelemetryJournal['summary']>> | null = null
      if (!closed)
        try {
          summary = await service.journal.summary()
        } catch {}
      const delivery = service.deliveryStatus()
      await service.persistDeliveryStatus()
      return {
        available: !closed,
        localEnabled: !closed && enabled,
        remoteAvailable: !closed && remoteAvailable,
        remoteEnabled: !closed && enabled && configuration.remoteEnabled,
        pending: summary ? summary.pending + summary.sending : null,
        discarded: summary?.discarded ?? null,
        retained: summary?.retained ?? null,
        delivered: summary?.delivered ?? null,
        deliveryState: closed ? 'unavailable' : delivery.state,
        lastSentAt: delivery.lastSentAt,
        nextAttemptAt: delivery.nextAttemptAt,
        lastRotationAt: summary?.lastRotationAt ?? null,
        providers:
          productId === 'all-in-one'
            ? ['application', 'vk-booster', 'chatgpt-booster']
            : ['application', productId as TelemetryProviderId],
      }
    },
    async configuration() {
      await initialize()
      return { ...configuration }
    },
    async probeEndpoint(candidate) {
      let endpoint: string
      try {
        endpoint = resolveOtlpLogsEndpoint(candidate)
      } catch {
        return { ok: false, endpoint: candidate, errorCode: 'configuration' }
      }
      if (closed || !remoteAvailable) return { ok: false, endpoint, errorCode: 'unavailable' }
      try {
        if (options.requestPermission && !(await options.requestPermission(endpoint)))
          return { ok: false, endpoint, errorCode: 'permission' }
        if (
          target === 'chromium' &&
          !(await chrome.permissions.contains({ origins: [`${new URL(endpoint).origin}/*`] }))
        )
          return { ok: false, endpoint, errorCode: 'permission' }
        // An explicit candidate check contains no service identity or journal rows.
        await sender({
          url: endpoint,
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: '{"resourceLogs":[]}',
        })
        return { ok: true, endpoint }
      } catch (error) {
        return {
          ok: false,
          endpoint,
          errorCode: error instanceof TelemetryCollectorRejected ? 'rejected' : 'network',
        }
      }
    },
    configure(next) {
      return mutate(async () => {
        const validated = validateTelemetryConfiguration(next)
        validated.remoteEnabled =
          configuration.remoteEnabled && validated.endpoint === configuration.endpoint
        const endpointChanged = validated.endpoint !== configuration.endpoint
        service.stopDelivery()
        await service.journal.writeConfiguration(validated)
        configuration = validated
        if (endpointChanged) service.resetDeliveryStatus()
        scheduleRotation()
        syncDelivery()
      })
    },
    setLocalEnabled(next) {
      return mutate(async () => {
        if (!next) service.stopDelivery()
        await settings.set(OPT_IN_KEY, next)
        enabled = next
        if (!next) {
          configuration = { ...configuration, remoteEnabled: false }
          await service.journal.writeConfiguration(configuration)
        }
        service.setLocalEnabled(next)
        scheduleRotation()
        syncDelivery()
      })
    },
    async setRemoteEnabled(next) {
      const permission =
        next && options.requestPermission
          ? options.requestPermission(configuration.endpoint).catch(() => false)
          : Promise.resolve(true)
      return mutate(async () => {
        if (next && (!enabled || !remoteAvailable || !configuration.endpoint))
          throw Error('Включите локальный сбор и задайте доступный HTTPS endpoint.')
        if (!(await permission)) throw Error('Разрешение браузера для endpoint не предоставлено.')
        service.stopDelivery()
        if (next) service.resetDeliveryStatus()
        configuration = { ...configuration, remoteEnabled: next }
        await service.journal.writeConfiguration(configuration)
        syncDelivery()
      })
    },
    async records(query: ApplicationTelemetryQuery = {}) {
      await initialize()
      if (closed) return []
      if (query.providerId !== undefined && !isTelemetryProviderId(query.providerId))
        throw Error('Invalid telemetry provider')
      const rows = await service.journal.list({
        ...query,
        limit: Math.min(100, Math.max(1, query.limit ?? 50)),
      })
      return rows.map(safeRecord).filter((row): row is ApplicationTelemetryRecord => row !== null)
    },
    async exportRecords(providerId) {
      await initialize()
      if (closed || (providerId !== undefined && !isTelemetryProviderId(providerId)))
        throw Error('Telemetry export unavailable')
      const rows = await service.journal.list({ providerId, limit: 10000 })
      return JSON.stringify(
        {
          schemaVersion: 1,
          productId,
          channel: scope.channel,
          exportedAt: Date.now(),
          events: rows.map(safeRecord).filter(Boolean),
        },
        null,
        2,
      )
    },
    clearRecords() {
      return mutate(async () => {
        await service.journal.clear()
      })
    },
    async flush() {
      await initialize()
      if (!enabled || !configuration.remoteEnabled || !remoteAvailable || closed) return 0
      syncDelivery()
      return service.flush({ enabled: true, endpoint: configuration.endpoint })
    },
    async record(name, count, durationMs, context) {
      try {
        await initialize()
        if (closed) return
        const currentEnabled = (await settings.get(OPT_IN_KEY)) === true
        if (currentEnabled !== enabled) {
          enabled = currentEnabled
          service.setLocalEnabled(enabled)
          scheduleRotation()
          syncDelivery()
        }
        if (!enabled) return
        const providerId =
          context?.providerId ??
          (productId === 'all-in-one' ? 'application' : (productId as TelemetryProviderId))
        if (providerId !== 'application' && productId !== 'all-in-one' && providerId !== productId)
          return
        await service.emitter.record(name, count, durationMs, { ...context, providerId })
        notify()
      } catch {
        /* Telemetry cannot reject or delay a product operation. */
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      closed = true
      enabled = false
      if (rotation !== undefined) clearTimeout(rotation)
      service.close()
      listeners.clear()
    },
  }
}
