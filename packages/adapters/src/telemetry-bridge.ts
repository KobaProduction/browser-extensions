import {
  type ApplicationTelemetryConfiguration,
  type ApplicationTelemetryController,
  type ApplicationTelemetryQuery,
  type ApplicationTelemetryStatus,
  instanceScope,
  isScopedTelemetryName,
  isTelemetryProviderId,
  type ScopedTelemetryContext,
  type SettingsStore,
} from '@kobaproduction/browser-core'
import {
  type ServiceScope,
  TELEMETRY_HARD_LIMIT,
  type TelemetryEntry,
  type TelemetryJournal,
  telemetryDatabaseName,
  validateTechnicalTelemetryEntry,
} from '@kobaproduction/browser-storage'
import { createApplicationTelemetry, validateTelemetryConfiguration } from './application-telemetry'
import { isDevelopmentContextAllowed } from './development-context'
import { type OtlpSender, resolveOtlpLogsEndpoint, validateOtlpAcknowledgement } from './scoped-otlp'

const MESSAGE = 'koba:application-telemetry'
type Command =
  | 'status'
  | 'configuration'
  | 'configure'
  | 'probe'
  | 'local'
  | 'remote'
  | 'records'
  | 'export'
  | 'clear'
  | 'flush'
  | 'record'
interface TelemetryMessage {
  type: typeof MESSAGE
  scope: string
  command: Command
  value?: unknown
}
interface TelemetryResponse {
  ok: boolean
  value?: unknown
  error?: string
}
const EMPTY_STATUS: ApplicationTelemetryStatus = {
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

/** Content scripts never open host-origin journals for an MV3 installation. */
export function createChromiumTelemetryClient(scope: string): ApplicationTelemetryController {
  const listeners = new Set<() => void>()
  let closed = false
  let poll: ReturnType<typeof setInterval> | undefined
  let lastStatus = ''
  let configuration: ApplicationTelemetryConfiguration | null = null
  async function request<T>(command: Command, value?: unknown): Promise<T> {
    if (closed) throw Error('Telemetry connection closed')
    const result = await chrome.runtime.sendMessage<TelemetryMessage, TelemetryResponse>({
      type: MESSAGE,
      scope,
      command,
      value,
    })
    if (!result?.ok) throw Error(result?.error || 'Сервис телеметрии недоступен.')
    return result.value as T
  }
  async function changed() {
    for (const listener of listeners) {
      try {
        listener()
      } catch {}
    }
  }
  return {
    async status() {
      try {
        return await request<ApplicationTelemetryStatus>('status')
      } catch {
        return { ...EMPTY_STATUS }
      }
    },
    async configuration() {
      configuration = await request<ApplicationTelemetryConfiguration>('configuration')
      return configuration
    },
    async configure(value) {
      await request('configure', value)
      configuration = await request<ApplicationTelemetryConfiguration>('configuration')
      await changed()
    },
    probeEndpoint: (endpoint) => request('probe', endpoint),
    async setLocalEnabled(value) {
      await request('local', value)
      await changed()
    },
    async setRemoteEnabled(value) {
      await request('remote', { enabled: value, endpoint: configuration?.endpoint ?? '' })
      await changed()
    },
    records: (value) => request('records', value),
    exportRecords: (value) => request('export', value),
    async clearRecords() {
      await request('clear')
      await changed()
    },
    flush: () => request('flush'),
    async record(name, count, durationMs, context) {
      try {
        await request('record', { name, count, durationMs, context })
      } catch {
        /* Provider operations remain fail-open. */
      }
      await changed()
    },
    subscribe(listener) {
      listeners.add(listener)
      if (poll === undefined)
        poll = setInterval(() => {
          void request<ApplicationTelemetryStatus>('status')
            .then((status) => {
              const next = JSON.stringify(status)
              if (next !== lastStatus) {
                lastStatus = next
                void changed()
              }
            })
            .catch(() => undefined)
        }, 3000)
      return () => {
        listeners.delete(listener)
        if (!listeners.size && poll !== undefined) {
          clearInterval(poll)
          poll = undefined
        }
      }
    },
    close() {
      closed = true
      listeners.clear()
      if (poll !== undefined) clearInterval(poll)
    },
  }
}

/** One extension-owned controller is shared by VK/ChatGPT tabs of the same application/channel. */
export function installApplicationTelemetryBackground(scope = instanceScope()): () => void {
  if (!isDevelopmentContextAllowed('chromium', scope)) return () => undefined
  const prefix = `koba-browser:${scope}:`
  const store: SettingsStore = {
    async get(key) {
      return (await chrome.storage.local.get(prefix + key))[prefix + key] === true
    },
    async set(key, value) {
      await chrome.storage.local.set({ [prefix + key]: value })
    },
  }
  const controller = createApplicationTelemetry('chromium', store, scope, undefined, {
    local: true,
  })
  const alarmName = `${MESSAGE}:${scope}`
  async function syncAlarm() {
    if ((await controller.status()).localEnabled)
      await chrome.alarms.create(alarmName, { periodInMinutes: 1 })
    else await chrome.alarms.clear(alarmName)
  }
  const listener = (
    message: TelemetryMessage,
    sender: chrome.runtime.MessageSender,
    respond: (response: TelemetryResponse) => void,
  ): boolean | undefined => {
    if (message?.type !== MESSAGE) return
    if (sender.id !== chrome.runtime.id || message.scope !== scope) {
      respond({ ok: false, error: 'Telemetry scope mismatch' })
      return
    }
    // The worker may have just woken and not loaded settings yet. The UI supplies its
    // displayed endpoint so the browser gesture can start the grant synchronously;
    // persisted configuration is compared again before consent is saved or data sent.
    const remote =
      message.command === 'remote' && message.value && typeof message.value === 'object'
        ? (message.value as { enabled?: unknown; endpoint?: unknown })
        : null
    let permissionAction: Promise<boolean> | null = null
    const probeEndpoint =
      message.command === 'probe' && typeof message.value === 'string' ? message.value : null
    const permissionEndpoint =
      probeEndpoint ??
      (remote?.enabled === true && typeof remote.endpoint === 'string' ? remote.endpoint : null)
    if (permissionEndpoint !== null) {
      try {
        const origin = new URL(resolveOtlpLogsEndpoint(permissionEndpoint)).origin
        permissionAction = chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false)
      } catch {
        permissionAction = Promise.resolve(false)
      }
    }
    void (async () => {
      try {
        let value: unknown
        switch (message.command) {
          case 'status':
            value = await controller.status()
            break
          case 'configuration':
            value = await controller.configuration()
            break
          case 'configure':
            await controller.configure(validateTelemetryConfiguration(message.value))
            break
          case 'probe':
            if (!probeEndpoint || !permissionAction || !(await permissionAction))
              value = { ok: false, endpoint: probeEndpoint ?? '', errorCode: 'permission' }
            else value = await controller.probeEndpoint?.(probeEndpoint)
            break
          case 'local':
            if (typeof message.value !== 'boolean') throw Error()
            await controller.setLocalEnabled(message.value)
            break
          case 'remote': {
            if (!remote || typeof remote.enabled !== 'boolean' || typeof remote.endpoint !== 'string')
              throw Error()
            if (remote.enabled) {
              if (
                !permissionAction ||
                !(await permissionAction) ||
                (await controller.configuration()).endpoint !== resolveOtlpLogsEndpoint(remote.endpoint)
              )
                throw Error()
            }
            await controller.setRemoteEnabled(remote.enabled)
            break
          }
          case 'records': {
            const query =
              message.value && typeof message.value === 'object'
                ? (message.value as ApplicationTelemetryQuery)
                : {}
            value = await controller.records(query)
            break
          }
          case 'export':
            if (message.value !== undefined && !isTelemetryProviderId(message.value)) throw Error()
            value = await controller.exportRecords(message.value)
            break
          case 'clear':
            await controller.clearRecords()
            break
          case 'flush':
            value = await controller.flush()
            break
          case 'record': {
            const v = message.value as
              | { name?: string; count?: number; durationMs?: number; context?: ScopedTelemetryContext }
              | undefined
            if (!v?.name || !isScopedTelemetryName(v.name)) throw Error()
            await controller.record(v.name, v.count, v.durationMs, v.context)
            break
          }
          default:
            throw Error()
        }
        if (['local', 'remote', 'configure'].includes(message.command)) await syncAlarm()
        respond({ ok: true, value })
      } catch {
        respond({
          ok: false,
          error: 'Не удалось выполнить действие телеметрии. Проверьте параметры и разрешение endpoint.',
        })
      }
    })()
    return true
  }
  chrome.runtime.onMessage.addListener(listener)
  // MV3 workers are suspended between events; an alarm wakes the same persisted queue.
  void syncAlarm().catch(() => undefined)
  const onAlarm = (alarm: chrome.alarms.Alarm) => {
    if (alarm.name !== alarmName) return
    void controller
      .status()
      .then((status) =>
        status.remoteEnabled && (status.nextAttemptAt === null || status.nextAttemptAt <= Date.now())
          ? controller.flush()
          : undefined,
      )
      .catch(() => undefined)
  }
  chrome.alarms.onAlarm.addListener(onAlarm)
  return () => {
    chrome.runtime.onMessage.removeListener(listener)
    chrome.alarms.onAlarm.removeListener(onAlarm)
    void chrome.alarms.clear(alarmName)
    controller.close()
  }
}

declare function GM_getValue<T>(key: string, fallback?: T): T | Promise<T>
declare function GM_setValue(key: string, value: unknown): void | Promise<void>
declare function GM_deleteValue(key: string): void | Promise<void>
declare function GM_listValues(): string[] | Promise<string[]>
declare function GM_xmlhttpRequest(details: {
  method: string
  url: string
  headers: Record<string, string>
  data: string
  timeout: number
  anonymous: boolean
  redirect: 'error'
  onload(response: { status: number; responseText?: string }): void
  onerror(): void
  ontimeout(): void
  onabort(): void
}): { abort(): void }

export function userscriptTelemetrySender(): OtlpSender | null {
  if (typeof GM_xmlhttpRequest !== 'function') return null
  return (request) =>
    new Promise<void>((resolve, reject) => {
      if (request.signal?.aborted) {
        reject(Error('Telemetry request aborted'))
        return
      }
      const endpoint = resolveOtlpLogsEndpoint(request.url)
      const abort = () => operation.abort()
      const finish = (ok: boolean, error?: unknown) => {
        request.signal?.removeEventListener('abort', abort)
        if (ok) resolve()
        else reject(error ?? Error('Telemetry delivery unavailable'))
      }
      const operation = GM_xmlhttpRequest({
        method: 'POST',
        url: endpoint,
        headers: request.headers,
        data: request.body,
        timeout: 15000,
        anonymous: true,
        redirect: 'error',
        onload: (response) => {
          try {
            validateOtlpAcknowledgement(response.status, response.responseText ?? '')
            finish(true)
          } catch (error) {
            finish(false, error)
          }
        },
        onerror: () => finish(false),
        ontimeout: () => finish(false),
        onabort: () => finish(false),
      })
      request.signal?.addEventListener('abort', abort, { once: true })
      if (request.signal?.aborted) abort()
    })
}

/** Per-event GM keys avoid overwriting an entire queue when two host origins append concurrently.
 * GM does not offer cross-origin transactions: leases provide at-least-once delivery, never exactly-once. */
export function createUserscriptTelemetryPersistence(
  scope: ServiceScope,
): { settings: SettingsStore; journal: TelemetryJournal } | null {
  if (
    typeof GM_getValue !== 'function' ||
    typeof GM_setValue !== 'function' ||
    typeof GM_deleteValue !== 'function' ||
    typeof GM_listValues !== 'function'
  )
    return null
  const prefix = `${telemetryDatabaseName(scope)}:gm:`
  const eventPrefix = `${prefix}event:`
  let closed = false
  let sequence: Promise<unknown> = Promise.resolve()
  function queue<T>(work: () => Promise<T>): Promise<T> {
    const next = sequence.then(() => {
      if (closed) throw Error('Telemetry journal closed')
      return work()
    })
    sequence = next.catch(() => undefined)
    return next
  }
  async function entries(): Promise<{ key: string; row: TelemetryEntry }[]> {
    const keys = (await GM_listValues()).filter((key) => key.startsWith(eventPrefix))
    const rows: { key: string; row: TelemetryEntry }[] = []
    for (const key of keys) {
      const value = await GM_getValue<unknown>(key)
      if (!value || typeof value !== 'object') continue
      const row = value as TelemetryEntry
      try {
        validateTechnicalTelemetryEntry(row)
        if (
          !Number.isSafeInteger(row.id) ||
          (row.id ?? -1) < 0 ||
          !['pending', 'sending', 'sent'].includes(row.state) ||
          !Number.isSafeInteger(row.attempts) ||
          row.attempts < 0 ||
          !Number.isSafeInteger(row.leaseUntil) ||
          row.leaseUntil < 0 ||
          (row.leaseOwner !== null &&
            (typeof row.leaseOwner !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(row.leaseOwner)))
        )
          continue
        rows.push({ key, row })
      } catch {
        /* Do not expose/erase malformed foreign records. */
      }
    }
    return rows.sort((a, b) => (a.row.id ?? 0) - (b.row.id ?? 0))
  }
  const journal: TelemetryJournal = {
    append(input) {
      return queue(async () => {
        validateTechnicalTelemetryEntry(input)
        if (
          (await GM_listValues()).filter((key) => key.startsWith(eventPrefix)).length >=
          TELEMETRY_HARD_LIMIT
        ) {
          const discarded = await GM_getValue<number>(`${prefix}discarded`, 0)
          await GM_setValue(`${prefix}discarded`, discarded + 1)
          return
        }
        const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
        const id = Date.now() * 2048 + (random % 2048)
        await GM_setValue(`${eventPrefix}${crypto.randomUUID()}`, {
          ...input,
          id,
          state: 'pending',
          leaseOwner: null,
          leaseUntil: 0,
          attempts: 0,
        })
      })
    },
    claim(owner, now = Date.now(), limit = 50) {
      return queue(async () => {
        if (
          !/^[a-zA-Z0-9_-]{8,128}$/.test(owner) ||
          !Number.isSafeInteger(now) ||
          now < 0 ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 50
        )
          throw Error('Invalid telemetry lease')
        const selected = (await entries())
          .filter(
            ({ row }) => row.state === 'pending' || (row.state === 'sending' && row.leaseUntil <= now),
          )
          .slice(0, limit)
        for (const { key, row } of selected) {
          row.state = 'sending'
          row.leaseOwner = owner
          row.leaseUntil = now + 45000
          row.attempts++
          await GM_setValue(key, row)
        }
        // A second origin may claim concurrently. Only deliver leases still owned by this instance.
        const confirmed: TelemetryEntry[] = []
        for (const { key } of selected) {
          const row = await GM_getValue<TelemetryEntry>(key)
          if (row?.leaseOwner === owner) confirmed.push(row)
        }
        return confirmed
      })
    },
    acknowledge(owner, ids) {
      return queue(async () => {
        let count = 0
        for (const { key, row } of await entries())
          if (
            row.id !== undefined &&
            ids.includes(row.id) &&
            row.state === 'sending' &&
            row.leaseOwner === owner
          ) {
            await GM_setValue(key, { ...row, state: 'sent', leaseOwner: null, leaseUntil: 0 })
            count++
          }
        return count
      })
    },
    release(owner, ids) {
      return queue(async () => {
        for (const { key, row } of await entries())
          if (
            row.id !== undefined &&
            ids.includes(row.id) &&
            row.state === 'sending' &&
            row.leaseOwner === owner
          )
            await GM_setValue(key, { ...row, state: 'pending', leaseOwner: null, leaseUntil: 0 })
      })
    },
    async summary() {
      const rows = (await entries()).map(({ row }) => row)
      return {
        retained: rows.length,
        pending: rows.filter((row) => row.state === 'pending').length,
        sending: rows.filter((row) => row.state === 'sending').length,
        delivered: rows.filter((row) => row.state === 'sent').length,
        discarded: await GM_getValue<number>(`${prefix}discarded`, 0),
        lastRotationAt: await GM_getValue<number | null>(`${prefix}rotation`, null),
      }
    },
    async list(options = {}) {
      return (await entries())
        .map(({ row }) => row)
        .reverse()
        .filter(
          (row) =>
            (!options.providerId || (row.providerId ?? 'application') === options.providerId) &&
            (options.beforeId === undefined || (row.id ?? 0) < options.beforeId),
        )
        .slice(0, Math.max(1, Math.min(TELEMETRY_HARD_LIMIT, options.limit ?? 50)))
    },
    prune(maxEvents, maxAgeMs, now = Date.now()) {
      return queue(async () => {
        if (
          !Number.isSafeInteger(maxEvents) ||
          maxEvents < 1 ||
          maxEvents > 5000 ||
          !Number.isSafeInteger(maxAgeMs) ||
          maxAgeMs < 86400000 ||
          !Number.isSafeInteger(now) ||
          now < 0
        )
          throw Error('Invalid telemetry rotation policy')
        const rows = await entries()
        const candidates = rows.filter(({ row }) => row.state !== 'sending' || row.leaseUntil <= now)
        const remove = new Set(
          candidates.filter(({ row }) => row.timestamp < now - maxAgeMs).map(({ key }) => key),
        )
        let excess = Math.max(0, rows.length - remove.size - maxEvents)
        for (const { key } of candidates)
          if (excess && !remove.has(key)) {
            remove.add(key)
            excess--
          }
        for (const key of remove) await GM_deleteValue(key)
        await GM_setValue(
          `${prefix}discarded`,
          (await GM_getValue<number>(`${prefix}discarded`, 0)) + remove.size,
        )
        await GM_setValue(`${prefix}rotation`, now)
        return remove.size
      })
    },
    readConfiguration: () => Promise.resolve(GM_getValue<unknown>(`${prefix}configuration`)),
    writeConfiguration: (value) => Promise.resolve(GM_setValue(`${prefix}configuration`, value)),
    readDeliveryStatus: () => Promise.resolve(GM_getValue<unknown>(`${prefix}delivery`)),
    writeDeliveryStatus: (value) => Promise.resolve(GM_setValue(`${prefix}delivery`, value)),
    clear() {
      return queue(async () => {
        for (const key of (await GM_listValues()).filter((key) => key.startsWith(eventPrefix)))
          await GM_deleteValue(key)
        await GM_setValue(`${prefix}discarded`, 0)
        await GM_deleteValue(`${prefix}rotation`)
      })
    },
    close() {
      closed = true
    },
  }
  return {
    settings: {
      async get(key) {
        return (await GM_getValue<boolean>(`${prefix}settings:${key}`, false)) === true
      },
      async set(key, value) {
        await GM_setValue(`${prefix}settings:${key}`, value)
      },
    },
    journal,
  }
}
