import { isScopedTelemetryName, type ScopedTelemetry } from '@kobaproduction/browser-core'
import {
  assertServiceScope,
  type ServiceScope,
  type TelemetryPort,
} from '@kobaproduction/browser-storage'

/** Reuse the same privacy-preserving emitter for every product; a provider
 * may opt out or have no transport. No network SDK is introduced here. */
export function asTelemetryPort(scope: ServiceScope, emitter: ScopedTelemetry): TelemetryPort {
  assertServiceScope(scope)
  if (emitter.scope !== `${scope.productId}:${scope.channel}`)
    throw new Error('Telemetry emitter product/channel mismatch')
  return {
    scope,
    get available() {
      return emitter.available()
    },
    get enabled() {
      return emitter.isEnabled()
    },
    async emit(name, count, durationMs) {
      if (!isScopedTelemetryName(name)) return
      await emitter.record(name, count, durationMs)
    },
  }
}
