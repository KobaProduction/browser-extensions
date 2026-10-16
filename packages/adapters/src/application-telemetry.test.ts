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
    expect((await app.status()).pending).toBe(0)
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

test('candidate probe sends only an empty envelope and never enables collection or delivery', async () => {
  const values = new Map<string, boolean>()
  const store = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: boolean) => {
      values.set(key, value)
    },
  }
  const journal = new DexieTelemetryJournal(
    { productId: 'chatgpt-booster', channel: 'dev', installationId: 'synthetic-probe' },
    { indexedDB, IDBKeyRange },
  )
  const requests: { url: string; body: string }[] = []
  const app = createApplicationTelemetry('userscript', store, 'chatgpt-booster:dev', journal, {
    local: true,
    remoteAvailable: true,
    sender: async (request) => {
      requests.push(request)
    },
  })
  try {
    if (!app.probeEndpoint) throw Error('Expected a telemetry candidate probe')
    expect(await app.probeEndpoint('https://collector.test/base')).toEqual({
      ok: true,
      endpoint: 'https://collector.test/base/v1/logs',
    })
    expect(requests).toEqual([
      {
        url: 'https://collector.test/base/v1/logs',
        body: '{"resourceLogs":[]}',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
      },
    ])
    expect(await app.status()).toMatchObject({ localEnabled: false, remoteEnabled: false, pending: 0 })
    expect((await app.configuration()).endpoint).toBe('')
    expect(await app.probeEndpoint('https://user:secret@collector.test')).toMatchObject({
      ok: false,
      errorCode: 'configuration',
    })
    expect(requests).toHaveLength(1)
    await app.setLocalEnabled(true)
    await app.configure({ ...(await app.configuration()), endpoint: 'https://collector.test/base' })
    await app.setRemoteEnabled(true)
    expect((await app.status()).remoteEnabled).toBe(true)
    await app.configure({ ...(await app.configuration()), endpoint: 'https://another-collector.test' })
    expect(await app.status()).toMatchObject({
      localEnabled: true,
      remoteEnabled: false,
      deliveryState: 'off',
    })
  } finally {
    await journal.clear()
    app.close()
  }
})
