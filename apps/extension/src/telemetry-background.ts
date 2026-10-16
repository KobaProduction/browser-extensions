import { installApplicationTelemetryBackground } from '@kobaproduction/browser-adapters'

// The extension origin owns one scoped journal for all supported host tabs.
export const installTelemetryBackground = installApplicationTelemetryBackground
