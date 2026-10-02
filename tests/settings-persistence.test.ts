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
    expect(boosterOff.telemetry.endpoint).toBe('https://telemetry.koba-nexus.ru')
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
