import {
  type ApplicationBackupSource,
  type ApplicationTelemetryController,
  type BackupRow,
  type DeliveryTarget,
  instanceScope,
} from '@kobaproduction/browser-core'
import { validateTelemetryConfiguration } from './application-telemetry'

/** Selected settings only. Logs, credentials and external consent are never restored. */
export async function createTelemetryBackupSource(
  controller: ApplicationTelemetryController,
  target: DeliveryTarget,
  scopeId = instanceScope(),
): Promise<ApplicationBackupSource> {
  const match = /^(vk-booster|chatgpt-booster|all-in-one):(dev|prod)$/.exec(scopeId)
  if (!match) throw Error('Invalid telemetry backup scope')
  const productId = match[1] ?? ''
  const channel = match[2] as 'dev' | 'prod'
  const status = await controller.status()
  const validate = (rows: readonly BackupRow[]) => {
    if (rows.length !== 1 || rows[0]?.key !== 'preferences')
      throw Error('Invalid telemetry settings backup')
    const raw = rows[0].value
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw Error('Invalid telemetry preferences')
    const value = raw as Record<string, unknown>
    if (
      Object.keys(value).some((key) => !['localEnabled', 'configuration'].includes(key)) ||
      typeof value.localEnabled !== 'boolean'
    )
      throw Error('Invalid telemetry preferences')
    const configuration = validateTelemetryConfiguration(value.configuration)
    if (configuration.remoteEnabled) throw Error('External telemetry consent is not portable')
    return { localEnabled: value.localEnabled, configuration }
  }
  return {
    id: 'application.telemetry',
    label: 'Настройки телеметрии',
    kind: 'settings',
    available: status.available,
    ...(status.available ? {} : { reason: 'Сервис телеметрии недоступен' }),
    scope: { productId, channel, installationId: `${productId}-${target}` },
    schema: {
      version: 1,
      fields: ['localEnabled', 'endpoint', 'maxEvents', 'maxAgeDays', 'rotationMinutes'],
      remoteConsent: 'not-portable',
    },
    async *readRows() {
      const current = await controller.status()
      if (!current.available) throw Error('Telemetry unavailable')
      yield {
        key: 'preferences',
        value: {
          localEnabled: current.localEnabled,
          configuration: { ...(await controller.configuration()), remoteEnabled: false },
        },
      }
    },
    validateRows(rows) {
      validate(rows)
    },
    async restoreRows(rows) {
      const next = validate(rows)
      const before = {
        localEnabled: (await controller.status()).localEnabled,
        configuration: { ...(await controller.configuration()), remoteEnabled: false },
      }
      // Consent belongs to this installation. A restore always revokes external delivery first.
      await controller.setRemoteEnabled(false)
      try {
        await controller.configure(next.configuration)
        await controller.setLocalEnabled(next.localEnabled)
      } catch (error) {
        await controller.configure(before.configuration)
        await controller.setLocalEnabled(before.localEnabled)
        throw error
      }
    },
  }
}
