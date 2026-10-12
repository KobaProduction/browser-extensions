import { expect, test } from 'bun:test'
import { DexieTelemetryJournal } from '@kobaproduction/browser-storage'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { createApplicationTelemetry } from './application-telemetry'

test('application telemetry is off by default, locally opt-in, and scoped per app/channel', async () => {
  const values = new Map<string, boolean>()
  const store = {
    get: async (key: string) => values.get(key),
    set: async (key: string, enabled: boolean) => {
      values.set(key, enabled)
    },
  }
  const journal = new DexieTelemetryJournal(
    { productId: 'vk-booster', channel: 'dev', installationId: 'vk-booster-userscript' },
    { indexedDB, IDBKeyRange },
  )
  const app = createApplicationTelemetry('userscript', store, 'vk-booster:dev', journal)
  try {
    const off = await app.status()
    expect(off).toMatchObject({ available: true, localEnabled: false, remoteEnabled: false })
    await app.record('archive.capture.started')
    expect((await app.status()).pending).toBeNull()
    await app.setLocalEnabled(true)
    await app.record('archive.capture.completed', 3)
    const on = await app.status()
    expect(on.localEnabled).toBe(true)
    expect(on.remoteEnabled).toBe(false)
    expect(on.pending).toBe(1)
    await app.setLocalEnabled(false)
    expect((await app.status()).localEnabled).toBe(false)
  } finally {
    app.close()
  }
  expect(values.get('telemetry.local.enabled')).toBe(false)
})

test('unsupported application identity is rejected before telemetry DB access', () => {
  const store = { get: async () => undefined, set: async () => {} }
  expect(() => createApplicationTelemetry('userscript', store, 'unknown:dev')).toThrow(
    'compiled product',
  )
})
