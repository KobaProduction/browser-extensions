import {
  type ApplicationTelemetryController,
  type ApplicationTelemetryStatus,
  type DeliveryTarget,
  instanceScope,
  type ScopedTelemetryName,
  type SettingsStore,
} from '@kobaproduction/browser-core'
import type { DexieTelemetryJournal, ServiceScope } from '@kobaproduction/browser-storage'
import { ScopedOtlpService } from './scoped-otlp'

declare const __BOOSTER_BUILD_VERSION__: string | undefined

const OPT_IN_KEY = 'telemetry.local.enabled'
/** One owner per product/channel/target. No URLs, raw records or accounts are emitted. */
export function createApplicationTelemetry(
  target: DeliveryTarget,
  store: SettingsStore,
  scopeId = instanceScope(),
  journal?: DexieTelemetryJournal,
): ApplicationTelemetryController {
  const match = /^(vk-booster|chatgpt-booster|all-in-one):(dev|prod)$/.exec(scopeId)
  if (!match) throw Error('Telemetry requires compiled product/channel identity')
  const productId = match[1] ?? ''
  const scope: ServiceScope = {
    productId,
    channel: match[2] as 'dev' | 'prod',
    installationId: `${productId}-${target}`,
  }
  const version =
    typeof __BOOSTER_BUILD_VERSION__ === 'string' && /^\d+\.\d+\.\d+$/.test(__BOOSTER_BUILD_VERSION__)
      ? __BOOSTER_BUILD_VERSION__
      : '0.0.0'
  const service = new ScopedOtlpService({
    scope,
    serviceId:
      productId === 'vk-booster'
        ? 'VK Booster Service'
        : productId === 'chatgpt-booster'
          ? 'ChatGPT Booster Service'
          : 'Koba Browser Tools',
    version,
    ...(journal ? { journal } : {}),
  })
  const listeners = new Set<() => void>()
  let enabled = false
  let closed = false
  const notify = () => {
    for (const listener of listeners) listener()
  }
  let loading: Promise<void> | undefined
  function initialize(): Promise<void> {
    if (!loading)
      loading = (async () => {
        try {
          const pref = (await store.get(OPT_IN_KEY)) === true
          if (closed) return
          enabled = pref
          service.setLocalEnabled(pref)
        } catch {
          enabled = false
          service.setLocalEnabled(false)
        }
        notify()
      })()
    return loading
  }
  void initialize()
  return {
    async status(): Promise<ApplicationTelemetryStatus> {
      await initialize()
      if (closed)
        return {
          available: false,
          localEnabled: false,
          remoteAvailable: false,
          remoteEnabled: false,
          pending: null,
          discarded: null,
        }
      if (!enabled)
        return {
          available: true,
          localEnabled: false,
          remoteAvailable: false,
          remoteEnabled: false,
          pending: null,
          discarded: null,
        }
      try {
        const summary = await service.journal.summary()
        return {
          available: true,
          localEnabled: enabled,
          remoteAvailable: false,
          remoteEnabled: false,
          pending: summary.pending + summary.sending,
          discarded: summary.discarded,
        }
      } catch {
        return {
          available: true,
          localEnabled: enabled,
          remoteAvailable: false,
          remoteEnabled: false,
          pending: null,
          discarded: null,
        }
      }
    },
    async setLocalEnabled(next) {
      await initialize()
      if (closed) throw Error('Telemetry controller closed')
      await store.set(OPT_IN_KEY, next)
      service.setLocalEnabled(next)
      enabled = next
      notify()
    },
    async record(name: ScopedTelemetryName, count?: number, durationMs?: number) {
      await initialize()
      if (!closed && enabled) await service.emitter.record(name, count, durationMs)
      notify()
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
      service.close()
      listeners.clear()
    },
  }
}
