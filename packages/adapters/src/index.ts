export { createArchiveFiles } from './folder-archive'

import type { DeliveryTarget } from '@kobaproduction/browser-core'

export { isDevelopmentContextAllowed } from './development-context'
export {
  createInstallationLocale,
  createSettingsStore,
  onInstallationStateChange,
} from './settings-storage'
export interface ProxyProfile {
  id: string
  name: string
  scheme: 'http' | 'https' | 'socks4' | 'socks5'
  host: string
  port: number
  bypass?: string[]
}
export function validateProxyProfile(v: ProxyProfile): ProxyProfile {
  if (
    !v ||
    !['http', 'https', 'socks4', 'socks5'].includes(v.scheme) ||
    !/^[a-z\d.-]+$/i.test(v.host) ||
    !Number.isInteger(v.port) ||
    v.port < 1 ||
    v.port > 65535
  )
    throw new Error('Invalid proxy profile')
  return v
}
// The userscript target cannot access browser-wide proxy settings. Chromium
// requires the manifest permission and a background-only adapter.
export function proxyAvailable(target: DeliveryTarget, granted: ReadonlySet<string>) {
  return target === 'chromium' && granted.has('proxy')
}

export { createApplicationBackup } from './application-backup'
export { getApplicationIdentity } from './application-identity'
export { createApplicationTelemetry } from './application-telemetry'
export { chooseBrowserBackupOutput } from './backup-file-output'
export { createIndexedBackupSource, createSettingsBackupSource } from './backup-sources'
export type { BrowserToolsPopupCommands, BrowserToolsPopupRenderer } from './browser-tools'
export {
  attachBrowserToolsPopup,
  bindBrowserToolsMessages,
  createBrowserToolsPopupCommands,
} from './browser-tools'
export { attachChromeInstallationToggle } from './installation-popup'
export type {
  RemoteArchiveSyncErrorCode,
  RemoteArchiveSyncOptions,
  RemoteArchiveSyncPhase,
  RemoteArchiveSyncProgress,
  RemoteArchiveSyncResult,
} from './remote-archive-sync'
export { RemoteArchiveSyncError, syncRemoteArchive } from './remote-archive-sync'
export type {
  RemoteCommandContext,
  RemoteCommandHandlers,
  RemotePublishOptions,
  RemotePublishReceipt,
  RemoteSession,
  RemoteSessionOptions,
  RemoteSessionStatus,
} from './remote-session'
export { createRemoteSession } from './remote-session'
export type { RemoteSessionProbeOptions, RemoteSessionProbeResult } from './remote-session-probe'
export { probeRemoteSession } from './remote-session-probe'
export { createRuntimeTelemetry } from './runtime-telemetry'
export type { OtlpDeliveryConfiguration, OtlpRequest, OtlpSender } from './scoped-otlp'
export {
  resolveOtlpLogsEndpoint,
  ScopedOtlpService,
  scopedOtlpPayload,
  sendOtlpRequest,
} from './scoped-otlp'
export { createTelemetryBackupSource } from './telemetry-backup'
export { installApplicationTelemetryBackground } from './telemetry-bridge'
export { asTelemetryPort } from './telemetry-port'
