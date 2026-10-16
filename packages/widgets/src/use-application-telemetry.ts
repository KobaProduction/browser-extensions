import {
  APPLICATION_TELEMETRY,
  type ApplicationTelemetryController,
  type TelemetryProviderId,
} from '@kobaproduction/browser-core'
import { inject } from 'vue'

/** Optional, scoped, application-owned telemetry; never mandatory for provider operations. */
export function useApplicationTelemetry(
  providerId?: TelemetryProviderId,
): ApplicationTelemetryController | null {
  const controller = inject<ApplicationTelemetryController | null>(APPLICATION_TELEMETRY, null)
  if (!controller || !providerId) return controller
  return {
    ...controller,
    record: (name, count, durationMs, context) =>
      controller.record(name, count, durationMs, { ...context, providerId }),
  }
}
