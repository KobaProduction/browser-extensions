import { type DeliveryTarget, instanceScope } from '@kobaproduction/browser-core'
import { type VkCapturePreferences, validateVkCapturePreferences } from './settings-backup'

/** Durable capture defaults. Archive records, peer IDs and folder handles never enter this store. */
export interface VkPreferencesPersistence {
  readonly scopeId: string
  readonly target: DeliveryTarget
  read(): Promise<VkCapturePreferences | null>
  write(value: VkCapturePreferences): Promise<void>
}

export interface VkPreferencesBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

const PREFIX = 'koba:vk-capture-preferences:v1'
const MAX_BYTES = 4096
function assertVkScope(scopeId: string): void {
  if (!/^(vk-booster|all-in-one):(dev|prod)$/.test(scopeId))
    throw Error('Invalid VK application preferences scope')
}
export function vkPreferencesKey(scopeId: string, target: DeliveryTarget): string {
  assertVkScope(scopeId)
  if (target !== 'userscript' && target !== 'chromium') throw Error('Invalid VK settings target')
  return `${PREFIX}:${scopeId}:${target}`
}

export function browserPreferencesBackend(target: DeliveryTarget): VkPreferencesBackend {
  if (target === 'chromium') {
    if (typeof chrome === 'undefined' || !chrome.storage?.local)
      throw Error('Chromium storage permission is unavailable')
    return {
      async get(key) {
        const value = (await chrome.storage.local.get(key))[key]
        return typeof value === 'string' ? value : value === undefined ? null : 'invalid'
      },
      async set(key, value) {
        await chrome.storage.local.set({ [key]: value })
      },
    }
  }
  if (typeof localStorage === 'undefined') throw Error('Userscript local storage is unavailable')
  return {
    async get(key) {
      return localStorage.getItem(key)
    },
    async set(key, value) {
      localStorage.setItem(key, value)
    },
  }
}

export function createVkPreferencesPersistence(
  target: DeliveryTarget,
  scopeId: string,
  backend: VkPreferencesBackend = browserPreferencesBackend(target),
): VkPreferencesPersistence {
  const key = vkPreferencesKey(scopeId, target)
  return {
    scopeId,
    target,
    async read() {
      const raw = await backend.get(key)
      if (raw === null) return null
      if (new TextEncoder().encode(raw).byteLength > MAX_BYTES)
        throw Error('Invalid stored VK settings size')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        throw Error('Invalid stored VK settings JSON')
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.keys(parsed).sort().join(',') !== 'schemaVersion,scopeId,settings,target'
      )
        throw Error('Invalid stored VK settings envelope')
      const envelope = parsed as Record<string, unknown>
      if (envelope.schemaVersion !== 1 || envelope.scopeId !== scopeId || envelope.target !== target)
        throw Error('Stored VK settings scope/version mismatch')
      return validateVkCapturePreferences(envelope.settings)
    },
    async write(value) {
      const settings = validateVkCapturePreferences(value)
      const raw = JSON.stringify({ schemaVersion: 1, scopeId, target, settings })
      if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw Error('VK settings size exceeded')
      await backend.set(key, raw)
    },
  }
}

let activePreferences: VkPreferencesPersistence | null = null
let startupError = ''
export function setVkPreferencesPersistence(port: VkPreferencesPersistence | null): void {
  activePreferences = port
  startupError = ''
}
export function vkPreferencesPersistence(): VkPreferencesPersistence | null {
  return activePreferences
}
export function vkPreferencesLoadError(): string {
  return startupError
}
/** Apply already scoped provider defaults when a child archive module starts. */
export async function applyVkCaptureDefaults(
  configure: (value: VkCapturePreferences) => void,
): Promise<void> {
  try {
    const saved = await activePreferences?.read()
    if (saved) configure(saved)
  } catch {
    startupError = 'Не удалось загрузить постоянные параметры VK; используются параметры сессии.'
  }
}
/** Runs before mounting the VK view, without opening or mutating an archive folder. */
export async function loadVkCaptureDefaults(
  configure: (value: VkCapturePreferences) => void,
  target: DeliveryTarget,
  scopeId = instanceScope(),
  backend?: VkPreferencesBackend,
): Promise<void> {
  setVkPreferencesPersistence(null)
  try {
    const port = createVkPreferencesPersistence(
      target,
      scopeId,
      backend ?? browserPreferencesBackend(target),
    )
    setVkPreferencesPersistence(port)
    await applyVkCaptureDefaults(configure)
  } catch {
    // Invalid or inaccessible storage never starts an archive or falls back to another scope.
    // Keep the product usable with default in-memory preferences and report the failure in UI.
    startupError = 'Не удалось загрузить постоянные параметры VK; используются параметры сессии.'
  }
}
