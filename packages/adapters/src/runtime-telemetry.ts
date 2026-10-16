import {
  type ApplicationTelemetryController,
  isTelemetryProviderId,
  TelemetryBus,
} from '@kobaproduction/browser-core'
/** One consent owner: the application controller gates both lifecycle and provider signals. */
export function createRuntimeTelemetry(controller: ApplicationTelemetryController): TelemetryBus {
  const bus = new TelemetryBus({
    send(event) {
      return controller.record(event.event, undefined, event.durationMs, {
        providerId: isTelemetryProviderId(event.moduleId) ? event.moduleId : 'application',
        ...(event.event === 'feature.failed' ? { errorClass: 'internal' as const } : {}),
      })
    },
  })
  bus.setEnabled(true)
  return bus
}
