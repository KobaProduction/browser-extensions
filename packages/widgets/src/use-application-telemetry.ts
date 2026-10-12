import { APPLICATION_TELEMETRY, type ApplicationTelemetryController } from '@kobaproduction/browser-core'
import { inject } from 'vue'

/** Optional, scoped, application-owned telemetry; never mandatory for provider operations. */
export function useApplicationTelemetry(): ApplicationTelemetryController | null {
  return inject<ApplicationTelemetryController | null>(APPLICATION_TELEMETRY, null)
}
