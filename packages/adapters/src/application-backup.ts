import {
  type ApplicationBackupController,
  type ApplicationBackupProvider,
  type ApplicationBackupSource,
  type ApplicationTelemetryController,
  type DeliveryTarget,
  type FeatureRuntime,
  flattenFeatureSettingsCategories,
  instanceKey,
  instanceScope,
  isApplicationLanguage,
  isTelemetryProviderId,
  reportTelemetryError,
  SHELL_RESTORE_UI_EVENT,
  shellInstanceKey,
} from '@kobaproduction/browser-core'
import {
  discardSectionedBackupRecovery,
  exportSectionedBackup,
  exportSectionedBackupTo,
  inspectSectionedBackup,
  listSectionedBackupRecoveries,
  type PersistentSettingsPort,
  restoreSectionedBackup,
  retrySectionedBackupRollback,
} from '@kobaproduction/browser-storage'
import { chooseBrowserBackupOutput } from './backup-file-output'
import { createSettingsBackupSource } from './backup-sources'
import { createSettingsStore } from './settings-storage'

/** Only registered application keys are portable. Never enumerate a host's storage. */
function shellSettingsSource(target: DeliveryTarget, runtime: FeatureRuntime): ApplicationBackupSource {
  const [productId, channel] = instanceScope().split(':')
  if (!productId || (channel !== 'dev' && channel !== 'prod'))
    throw Error('Invalid application backup scope')
  const keys = [
    'installation.enabled',
    'ui.launcher.enabled',
    'ui.site-entry.enabled',
    'ui.quick-menu.enabled',
    'ui.metrics.enabled',
    'ui.language',
    ...runtime.features.flatMap((feature) => [
      `features.${feature.id}.enabled`,
      ...(feature.modules ?? []).map((module) => `features.${feature.id}.modules.${module.id}.enabled`),
    ]),
  ]
  type ApplicationSettings = Record<string, boolean | string>
  const defaults = new Map<string, boolean | string>(
    keys.map((key) => [key, key !== 'ui.site-entry.enabled']),
  )
  defaults.set('ui.language', 'auto')
  for (const feature of runtime.features)
    for (const module of feature.modules ?? [])
      defaults.set(
        `features.${feature.id}.modules.${module.id}.enabled`,
        module.defaultEnabled !== false,
      )
  const prefix = `${instanceKey('koba-browser')}:`
  const settings = createSettingsStore(target)
  const validate = (value: unknown): ApplicationSettings => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('Invalid application settings')
    const result: ApplicationSettings = {}
    for (const [key, item] of Object.entries(value)) {
      if (
        !keys.includes(key) ||
        (key === 'ui.language' ? !isApplicationLanguage(item) : typeof item !== 'boolean')
      )
        throw Error('Unknown application setting')
      result[key] = item as boolean | string
    }
    return result
  }
  const port: PersistentSettingsPort<ApplicationSettings> = {
    scope: { productId, channel, installationId: `${productId}-${target}` },
    schemaVersion: 1,
    validateSettings: validate,
    async exportSettings() {
      const result: ApplicationSettings = {}
      if (target === 'chromium') {
        const values = await chrome.storage.local.get(keys.map((key) => `${prefix}${key}`))
        for (const key of keys)
          if (
            key === 'ui.language'
              ? isApplicationLanguage(values[`${prefix}${key}`])
              : typeof values[`${prefix}${key}`] === 'boolean'
          )
            result[key] = values[`${prefix}${key}`] as boolean | string
      } else
        for (const key of keys) {
          const value = key === 'ui.language' ? await settings.getText?.(key) : await settings.get(key)
          if (key === 'ui.language' ? isApplicationLanguage(value) : typeof value === 'boolean')
            result[key] = value as boolean | string
        }
      return result
    },
    async restoreSettingsAtomically(input) {
      const value = validate(input),
        before = await port.exportSettings()
      const write = async (next: ApplicationSettings) => {
        if (target === 'chromium') {
          // Storage changes are one area batch; removed defaults remain explicit defaults.
          await chrome.storage.local.set(
            Object.fromEntries(
              keys.map((key) => [`${prefix}${key}`, next[key] ?? defaults.get(key) ?? true]),
            ),
          )
        } else {
          for (const key of keys) {
            const item = next[key] ?? defaults.get(key) ?? true
            if (key === 'ui.language') await settings.setText?.(key, String(item))
            else await settings.set(key, item as boolean)
          }
        }
      }
      try {
        await write(value)
      } catch (error) {
        await write(before)
        throw error
      }
    },
  }
  return createSettingsBackupSource('application.settings', 'Настройки приложения', port)
}

async function browserUiSource(
  target: DeliveryTarget,
  session: boolean,
  runtime: FeatureRuntime,
): Promise<ApplicationBackupSource> {
  const [productId, channel] = instanceScope().split(':')
  if (!productId || (channel !== 'dev' && channel !== 'prod'))
    throw Error('Invalid application backup scope')
  const storage = session ? sessionStorage : localStorage
  const keys = session
    ? ['koba-browser:session-ui']
    : ['koba-browser:edge-launcher', 'koba-browser:floating-workspace']
  const matching = runtime.features.filter((feature) => feature.match(runtime.context.url))
  const categories = new Set([
    'interface',
    'modules',
    'telemetry',
    'backup',
    'about',
    ...matching.flatMap((feature) =>
      flattenFeatureSettingsCategories(
        feature.settings?.categories ?? [{ id: 'settings', title: 'Настройки' }],
      ).map((category) => `provider:${feature.id}:${category.id}`),
    ),
  ])
  const sections = new Set(['shell-settings', ...matching.map((feature) => feature.id)])
  const originDigest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.origin)),
  )
  const originId = Array.from(originDigest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const validate = (input: unknown): Record<string, string> => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw Error('Invalid UI preferences backup')
    const value: Record<string, string> = {}
    for (const [key, raw] of Object.entries(input)) {
      if (!keys.includes(key) || typeof raw !== 'string' || raw.length > 8192)
        throw Error('Unknown UI preference')
      const data: unknown = JSON.parse(raw)
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw Error('Invalid UI preference value')
      const allowed = session
        ? ['section', 'category', 'surface']
        : key.endsWith('edge-launcher')
          ? ['side', 'ratio', 'xRatio', 'yRatio', 'attached']
          : ['xRatio', 'yRatio', 'widthRatio', 'heightRatio']
      for (const [field, item] of Object.entries(data)) {
        if (!allowed.includes(field)) throw Error('Unknown UI preference field')
        const valid =
          field === 'category' || field === 'settingsCategory'
            ? typeof item === 'string' && categories.has(item)
            : field === 'section'
              ? typeof item === 'string' && sections.has(item)
              : field === 'surface'
                ? typeof item === 'string' && ['closed', 'quick', 'panel'].includes(item)
                : field === 'view'
                  ? typeof item === 'string' &&
                    ['settings', 'archive', 'capture', 'shell-settings'].includes(item)
                  : field === 'side'
                    ? item === null || item === 'left' || item === 'right'
                    : ['open', 'quickOpen', 'attached'].includes(field)
                      ? typeof item === 'boolean'
                      : typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1
        if (!valid) throw Error('Invalid UI preference field')
      }
      value[key] = raw
    }
    return value
  }
  const port: PersistentSettingsPort<Record<string, string>> = {
    scope: { productId, channel, installationId: `${productId}-${target}-${originId}` },
    schemaVersion: 1,
    validateSettings: validate,
    async exportSettings() {
      return validate(
        Object.fromEntries(
          keys.flatMap((key) => {
            const value = storage.getItem(shellInstanceKey(key))
            return value === null ? [] : [[key, value]]
          }),
        ),
      )
    },
    async restoreSettingsAtomically(input) {
      const value = validate(input),
        before = await port.exportSettings()
      const write = (next: Record<string, string>) => {
        for (const key of keys) {
          if (key in next) storage.setItem(shellInstanceKey(key), next[key] as string)
          else storage.removeItem(shellInstanceKey(key))
        }
      }
      try {
        write(value)
      } catch (error) {
        write(before)
        throw error
      }
    },
  }
  return createSettingsBackupSource(
    session ? 'application.session' : 'application.layout',
    session ? 'Состояние интерфейса этой сессии' : 'Расположение интерфейса',
    port,
    session ? 'session' : 'settings',
  )
}

/** Registry resolves live verified provider ports when the user opens recovery. */
export function createApplicationBackup(
  target: DeliveryTarget,
  runtime: FeatureRuntime,
  extra: readonly ApplicationBackupProvider[] = [],
  telemetry?: ApplicationTelemetryController,
): ApplicationBackupController {
  const listeners = new Set<() => void>()
  let current: AbortController | undefined
  const operation = async <T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (current) throw Error('A backup operation is already active')
    const controller = new AbortController()
    current = controller
    try {
      return await action(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) reportTelemetryError(telemetry, error)
      throw error
    } finally {
      if (current === controller) current = undefined
    }
  }
  const notify = () => {
    for (const listener of [...listeners])
      try {
        listener()
      } catch {
        /* Presentation cannot invalidate a completed operation. */
      }
  }
  const refreshRestored = async (selected: readonly string[]) => {
    await runtime.refreshFromSettings()
    window.dispatchEvent(
      new CustomEvent(SHELL_RESTORE_UI_EVENT, {
        detail: {
          layout: selected.includes('application.layout'),
          session: selected.includes('application.session'),
        },
      }),
    )
    notify()
  }
  const sources = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const applicationSource = shellSettingsSource(target, runtime)
    const result: ApplicationBackupSource[] = [
      applicationSource,
      ...(await Promise.all([
        browserUiSource(target, false, runtime),
        browserUiSource(target, true, runtime),
      ])),
    ]
    signal?.throwIfAborted()
    for (const feature of runtime.features.filter((feature) => feature.match(new URL(location.href)))) {
      if (!feature.backup) continue
      signal?.throwIfAborted()
      try {
        const contribution = await feature.backup()
        signal?.throwIfAborted()
        result.push(...contribution)
      } catch (error) {
        signal?.throwIfAborted()
        reportTelemetryError(
          telemetry,
          error,
          isTelemetryProviderId(feature.id) ? feature.id : 'application',
        )
        result.push({
          id: `${feature.id}.indexeddb`,
          label: `База данных ${feature.title}`,
          kind: 'indexeddb',
          available: false,
          reason: 'Проверьте авторизацию и доступность провайдера',
          scope: applicationSource.scope,
          schema: null,
          readRows() {
            throw Error('Provider is unavailable')
          },
          validateRows() {
            throw Error('Provider is unavailable')
          },
          async restoreRows() {
            throw Error('Provider is unavailable')
          },
        })
      }
    }
    for (const provider of extra) {
      signal?.throwIfAborted()
      const contribution = await provider()
      signal?.throwIfAborted()
      result.push(...contribution)
    }
    return result
  }
  return {
    async status() {
      return (await sources()).map(({ id, label, kind, available, reason }) => ({
        id,
        label,
        kind,
        available,
        reason,
      }))
    },
    export(selected) {
      return operation(async (signal) =>
        exportSectionedBackup(await sources(signal), selected, { signal }),
      )
    },
    exportTo(selected, output) {
      return operation(async (signal) => {
        try {
          await exportSectionedBackupTo(await sources(signal), selected, output, { signal })
        } catch (error) {
          await output.abort(error).catch(() => undefined)
          throw error
        }
      })
    },
    save(selected) {
      return operation(async (signal) => {
        // Picker opens before source discovery/awaits, while the click still owns
        // user activation. Native file close happens only after final validation.
        const output = await chooseBrowserBackupOutput(
          `browser-tools-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`,
        )
        try {
          signal.throwIfAborted()
          const active = await sources(signal)
          if (!output) return await exportSectionedBackup(active, selected, { signal })
          await exportSectionedBackupTo(active, selected, output, { signal })
          return null
        } catch (error) {
          await output?.abort(error).catch(() => undefined)
          throw error
        }
      })
    },
    inspect(file) {
      return operation(async (signal) => inspectSectionedBackup(file, await sources(signal), { signal }))
    },
    restore(file, selected) {
      return operation(async (signal) => {
        // Resolve ports inside the serialized task so waiting lifecycle changes
        // cannot leave restore holding an obsolete owner/runtime port.
        try {
          await runtime.runMaintenance(async () =>
            restoreSectionedBackup(file, await sources(signal), selected, { signal }),
          )
        } catch (error) {
          // Failed compensation can still change durable flags. Reconcile the
          // actual state while retaining the original recovery failure.
          await refreshRestored(selected).catch(() => undefined)
          throw error
        }
        await refreshRestored(selected)
      })
    },
    recoveries() {
      return operation(async (signal) =>
        listSectionedBackupRecoveries(await sources(signal), { signal }),
      )
    },
    retryRollback(id) {
      return operation(async (signal) => {
        let restored: readonly string[] = []
        try {
          await runtime.runMaintenance(async () => {
            const active = await sources(signal)
            const job = (await listSectionedBackupRecoveries(active, { signal })).find(
              (job) => job.id === id,
            )
            if (!job?.canRollback) throw Error('No interrupted restore is available')
            restored = job.sections.map((section) => section.id)
            await retrySectionedBackupRollback(active, id, { signal })
          })
        } catch (error) {
          await refreshRestored(restored).catch(() => undefined)
          throw error
        }
        await refreshRestored(restored)
      })
    },
    discardRecovery(id) {
      return operation(async (signal) => {
        await discardSectionedBackupRecovery(await sources(signal), id, { signal })
        notify()
      })
    },
    cancel() {
      current?.abort(new DOMException('Backup cancelled', 'AbortError'))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
