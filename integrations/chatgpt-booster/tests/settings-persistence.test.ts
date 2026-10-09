import { describe, expect, test } from 'bun:test'
import { resolveExportPreferences, scopedExportPreferenceKey } from '../packages/core/src/archive'
import {
  mergeSettings,
  normalizeSettings,
  SETTINGS_SCHEMA_VERSION,
} from '../packages/core/src/settings'

describe('settings patch persistence', () => {
  test('preserves sibling settings across sequential toggles', () => {
    const initial = normalizeSettings()
    const inspectorOff = mergeSettings(initial, {
      features: { toolInspector: false },
    })
    const boosterOff = mergeSettings(inspectorOff, {
      enabled: false,
    })

    expect(boosterOff.enabled).toBe(false)
    expect(boosterOff.features.toolInspector).toBe(false)
    expect(boosterOff.observer.enabled).toBe(false)
    expect(boosterOff.telemetry.endpoint).toBe('')
  })

  test('monitoring and alert settings survive unrelated feature patches', () => {
    const tuned = mergeSettings(normalizeSettings(), {
      monitoring: { intervalMs: 1300 },
      alerts: {
        responseCompleteSound: true,
        longRunningSound: true,
        longRunningThresholdMs: 180000,
      },
    })
    const changed = mergeSettings(tuned, {
      features: { requestTimer: false },
    })

    expect(changed.monitoring.intervalMs).toBe(1300)
    expect(changed.alerts.responseCompleteSound).toBe(true)
    expect(changed.alerts.longRunningSound).toBe(true)
    expect(changed.alerts.longRunningThresholdMs).toBe(180000)
  })

  test('nested patches do not reset unrelated observer fields', () => {
    const initial = mergeSettings(normalizeSettings(), {
      observer: {
        captureBodies: true,
        maxBodyChars: 4096,
      },
    })
    const disabled = mergeSettings(initial, {
      observer: { enabled: false },
    })

    expect(disabled.observer.enabled).toBe(false)
    expect(disabled.observer.captureBodies).toBe(true)
    expect(disabled.observer.maxBodyChars).toBe(4096)
  })
})

test('schema 4 passive transport observer migrates to opt-in', () => {
  const migrated = normalizeSettings({
    schemaVersion: 4,
    observer: { enabled: true, captureBodies: false, maxBodyChars: 2048 },
    telemetry: { enabled: false, endpoint: '' },
  } as Partial<import('../packages/core/src/settings').BoosterSettings>)

  expect(migrated.observer.enabled).toBe(false)
  expect(migrated.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
})

test('schema 4 advanced transport diagnostics stay enabled', () => {
  const migrated = normalizeSettings({
    schemaVersion: 4,
    observer: { enabled: true, captureBodies: true, maxBodyChars: 4096 },
    telemetry: { enabled: false, endpoint: '' },
  } as Partial<import('../packages/core/src/settings').BoosterSettings>)

  expect(migrated.observer.enabled).toBe(true)
  expect(migrated.observer.captureBodies).toBe(true)
})

test('snapshotSettings converts proxy-backed settings into plain serializable data', () => {
  const source = normalizeSettings()
  source.enabled = false
  source.features.toolInspector = false

  const proxy = new Proxy(source, {})
  const { snapshotSettings } =
    require('../packages/core/src/settings') as typeof import('../packages/core/src/settings')
  const snapshot = snapshotSettings(proxy)

  expect(snapshot).not.toBe(proxy)
  expect(snapshot.enabled).toBe(false)
  expect(snapshot.features.toolInspector).toBe(false)
  expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
})

test('legacy telemetry endpoint is cleared during schema migration', () => {
  const migrated = normalizeSettings({
    telemetry: {
      enabled: true,
      endpoint: 'https://legacy-collector.example.test',
    },
  } as Partial<import('../packages/core/src/settings').BoosterSettings>)

  expect(migrated.telemetry.endpoint).toBe('')
  expect(migrated.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
})

test('settings section state survives unrelated patches', () => {
  const analytics = mergeSettings(normalizeSettings(), {
    ui: { activeSection: 'analytics', telemetryExpanded: false },
  })
  const changed = mergeSettings(analytics, {
    features: { toolInspector: false },
  })

  expect(changed.ui.activeSection).toBe('analytics')
  expect(changed.ui.telemetryExpanded).toBe(false)
})

test('aborted transport events do not increment the error counter', async () => {
  const { applyTransportCounterEvent, EMPTY_TRANSPORT_COUNTERS } = await import(
    '../packages/core/src/diagnostics'
  )
  const next = applyTransportCounterEvent(EMPTY_TRANSPORT_COUNTERS, {
    direction: 'inbound',
    phase: 'error',
    timestamp: 1,
    errorClass: 'aborted',
  })

  expect(next.errors).toBe(0)
})

test('cached settings adapter coalesces reads and shares one upstream subscription', async () => {
  const { createCachedSettingsAdapter, snapshotSettings } = await import(
    '../packages/core/src/settings'
  )
  const base = normalizeSettings()
  let reads = 0
  let subscriptions = 0
  let sourceListener: ((settings: typeof base) => void) | undefined
  const source: import('../packages/core/src/settings').SettingsAdapter = {
    async get() {
      reads += 1
      await Promise.resolve()
      return snapshotSettings(base)
    },
    async set() {},
    async update(patch) {
      const next = mergeSettings(base, patch)
      sourceListener?.(next)
      return next
    },
    subscribe(listener) {
      subscriptions += 1
      sourceListener = listener
      return () => {
        sourceListener = undefined
      }
    },
  }

  const cached = createCachedSettingsAdapter(source)
  const [first, second] = await Promise.all([cached.get(), cached.get()])
  expect(reads).toBe(1)
  expect(first).toEqual(second)

  const seen: boolean[] = []
  const stopA = cached.subscribe((settings) => seen.push(settings.enabled))
  const stopB = cached.subscribe(() => undefined)
  expect(subscriptions).toBe(1)

  await cached.update({ enabled: false })
  expect((await cached.get()).enabled).toBe(false)
  expect(reads).toBe(1)
  expect(seen).toEqual([false])
  stopA()
  stopB()
})

describe('account-scoped archive export preference inheritance', () => {
  test('applies global, project and conversation overrides without sharing account keys', () => {
    const scopedProject = scopedExportPreferenceKey('account-one', 'project-one')
    const scopedChat = scopedExportPreferenceKey('account-one', 'chat-one')
    const settings = mergeSettings(normalizeSettings(), {
      export: { format: 'markdown', reasoning: false },
      exportOverrides: {
        projects: { [scopedProject]: { format: 'json-compact', packaging: 'zip', tools: false } },
        conversations: { [scopedChat]: { reasoning: true } },
      },
    })
    const own = resolveExportPreferences(
      settings.export,
      settings.exportOverrides,
      'account-one',
      'project-one',
      'chat-one',
    )
    expect(own.source).toBe('conversation')
    expect(own.options.format).toBe('json-compact')
    expect(own.options.reasoning).toBe(true)
    expect(own.options.tools).toBe(false)
    expect(own.options.packaging).toBe('zip')
    const other = resolveExportPreferences(
      settings.export,
      settings.exportOverrides,
      'account-two',
      'project-one',
      'chat-one',
    )
    expect(other.source).toBe('global')
    expect(other.options.format).toBe('markdown')
    expect(other.options.reasoning).toBe(false)
    expect(other.options.packaging).toBe('none')
  })

  test('deleting a conversation or project override restores inherited preferences', () => {
    const project = scopedExportPreferenceKey('account-one', 'project-one')
    const conversation = scopedExportPreferenceKey('account-one', 'chat-one')
    const configured = mergeSettings(normalizeSettings(), {
      exportOverrides: {
        projects: { [project]: { format: 'json' } },
        conversations: { [conversation]: { format: 'json-compact' } },
      },
    })
    const resetChat = mergeSettings(configured, {
      exportOverrides: { conversations: { [conversation]: null } },
    })
    const inheritedProject = resolveExportPreferences(
      resetChat.export,
      resetChat.exportOverrides,
      'account-one',
      'project-one',
      'chat-one',
    )
    expect(inheritedProject.source).toBe('project')
    expect(inheritedProject.options.format).toBe('json')
    const resetProject = mergeSettings(resetChat, {
      exportOverrides: { projects: { [project]: null } },
    })
    const inheritedGlobal = resolveExportPreferences(
      resetProject.export,
      resetProject.exportOverrides,
      'account-one',
      'project-one',
      'chat-one',
    )
    expect(inheritedGlobal.source).toBe('global')
    expect(inheritedGlobal.options.format).toBe(resetProject.export.format)
  })

  test('snapshots preserve owner scopes and reject malformed/unexpected override fields', () => {
    const key = scopedExportPreferenceKey('account-one', 'chat-one')
    const source = normalizeSettings({
      exportOverrides: {
        projects: {},
        conversations: {
          [key]: { format: 'json-compact', invalidRecord: 'secret' },
          'chat-only-without-owner': { format: 'markdown' },
        },
      },
    } as unknown as Partial<import('../packages/core/src/settings').BoosterSettings>)
    const { snapshotSettings } =
      require('../packages/core/src/settings') as typeof import('../packages/core/src/settings')
    const snapshot = snapshotSettings(source)
    expect(Object.keys(snapshot.exportOverrides.conversations)).toEqual([key])
    expect(snapshot.exportOverrides.conversations[key]).toEqual({ format: 'json-compact' })
    const patched = mergeSettings(snapshot, { features: { requestTimer: false } })
    expect(patched.exportOverrides).toEqual(snapshot.exportOverrides)
    expect(patched.features.requestTimer).toBe(false)
    expect(() => scopedExportPreferenceKey('', 'chat-one')).toThrow()
  })
})
