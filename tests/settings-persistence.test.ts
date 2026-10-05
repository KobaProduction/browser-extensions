import { describe, expect, test } from 'bun:test'
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
