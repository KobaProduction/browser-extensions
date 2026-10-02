import { describe, expect, test } from 'bun:test'
import { mergeSettings, normalizeSettings } from '../packages/core/src/settings'

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
    expect(boosterOff.observer.enabled).toBe(true)
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
  expect(migrated.schemaVersion).toBe(2)
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
