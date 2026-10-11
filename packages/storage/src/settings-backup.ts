import {
  assertMatchingScope,
  assertServiceScope,
  type PersistentSettingsPort,
  type ServiceScope,
} from './service-contract'

const FORMAT = 'koba-settings-backup-v1'
const MAX_BYTES = 512 * 1024

export interface SettingsBackup<T> {
  readonly format: typeof FORMAT
  readonly schemaVersion: number
  readonly scope: ServiceScope
  readonly createdAt: string
  readonly includes: { readonly settings: true; readonly archive: false; readonly attachments: false }
  readonly checksum: string
  readonly settings: T
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

async function checksum(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function settingsJson(value: unknown): string {
  const valueJson = JSON.stringify(value)
  if (typeof valueJson !== 'string' || valueJson.length === 0 || valueJson.length > MAX_BYTES)
    throw new Error('Settings backup payload is invalid or oversized')
  return valueJson
}

export async function exportSettingsBackup<T>(port: PersistentSettingsPort<T>): Promise<Blob> {
  assertServiceScope(port.scope)
  if (!Number.isSafeInteger(port.schemaVersion) || port.schemaVersion < 1)
    throw new Error('Invalid settings schema version')
  const value = port.validateSettings(await port.exportSettings())
  settingsJson(value)
  const body = {
    format: FORMAT as typeof FORMAT,
    schemaVersion: port.schemaVersion,
    scope: { ...port.scope },
    createdAt: new Date().toISOString(),
    includes: { settings: true as const, archive: false as const, attachments: false as const },
    settings: value,
  }
  const backup: SettingsBackup<T> = {
    ...body,
    checksum: await checksum(JSON.stringify(body)),
  }
  const raw = JSON.stringify(backup)
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES)
    throw new Error('Settings backup exceeds maximum size')
  return new Blob([raw], { type: 'application/json' })
}

/** Whole-file preflight; no destination write or secret logging occurs. */
export async function validateSettingsBackup<T>(
  port: PersistentSettingsPort<T>,
  blob: Blob,
): Promise<SettingsBackup<T>> {
  if (blob.size === 0 || blob.size > MAX_BYTES) throw new Error('Settings backup size rejected')
  const raw = JSON.parse(await blob.text()) as unknown
  if (
    !isRecord(raw) ||
    raw.format !== FORMAT ||
    raw.schemaVersion !== port.schemaVersion ||
    !isRecord(raw.scope) ||
    !isRecord(raw.includes) ||
    Object.keys(raw).sort().join(',') !==
      'checksum,createdAt,format,includes,schemaVersion,scope,settings' ||
    Object.keys(raw.scope).some(
      (key) => !['productId', 'channel', 'ownerId', 'installationId'].includes(key),
    ) ||
    Object.keys(raw.includes).sort().join(',') !== 'archive,attachments,settings' ||
    raw.includes.settings !== true ||
    raw.includes.archive !== false ||
    raw.includes.attachments !== false ||
    typeof raw.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.createdAt)) ||
    typeof raw.checksum !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.checksum)
  ) {
    throw new Error('Settings backup format or schema is unsupported')
  }
  const scope: ServiceScope = {
    productId: raw.scope.productId as string,
    channel: raw.scope.channel as ServiceScope['channel'],
    ...(raw.scope.ownerId === undefined ? {} : { ownerId: raw.scope.ownerId as string }),
    ...(raw.scope.installationId === undefined
      ? {}
      : { installationId: raw.scope.installationId as string }),
  }
  assertMatchingScope(port.scope, scope)
  settingsJson(raw.settings)
  const { checksum: expectedDigest, ...fields } = raw
  if ((await checksum(JSON.stringify(fields))) !== expectedDigest)
    throw new Error('Settings backup integrity check failed')
  const settings = port.validateSettings(raw.settings)
  if (settingsJson(settings) !== settingsJson(raw.settings))
    throw new Error('Settings backup contains unsupported or unnormalized values')
  return {
    format: FORMAT,
    schemaVersion: port.schemaVersion,
    scope,
    createdAt: raw.createdAt,
    includes: { settings: true, archive: false, attachments: false },
    checksum: raw.checksum,
    settings,
  }
}

/** Does not reinterpret a cross-channel backup as an in-place restore. */
export async function restoreSettingsBackup<T>(
  port: PersistentSettingsPort<T>,
  blob: Blob,
): Promise<void> {
  const validated = await validateSettingsBackup(port, blob)
  await port.restoreSettingsAtomically(validated.settings)
}
