import { expect, test } from 'bun:test'
import { DexieTelemetryJournal } from '@kobaproduction/browser-storage'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { resolveOtlpLogsEndpoint, ScopedOtlpService, scopedOtlpPayload } from './scoped-otlp'

const scope = { productId: 'chatgpt-booster', channel: 'dev' as const, installationId: 'tm-test-otel' }
const drivers = { indexedDB, IDBKeyRange }
const serviceId = 'ChatGPT Booster Service'

test('one shared OTLP service keeps events local until explicit independent consents', async () => {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = []
  const journal = new DexieTelemetryJournal(scope, drivers)
  const service = new ScopedOtlpService({
    scope,
    serviceId,
    version: '2.0.8',
    journal,
    sender: async (request) => {
      calls.push(request)
    },
  })
  expect(service.port.available).toBe(true)
  expect(service.port.enabled).toBe(false)
  await service.port.emit('archive.capture.completed', 2, 34)
  expect(await journal.summary()).toMatchObject({ pending: 0 })
  service.setLocalEnabled(true)
  await service.port.emit('private/chat-content?token=bad', 123)
  await service.port.emit('archive.capture.completed', 2, 34)
  expect(await journal.summary()).toMatchObject({ pending: 1 })
  expect(await service.flush({ enabled: false, endpoint: 'https://otel.test' })).toBe(0)
  expect(calls).toHaveLength(0)
  expect(await service.flush({ enabled: true, endpoint: 'https://otel.test/base' })).toBe(1)
  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toBe('https://otel.test/base/v1/logs')
  expect(calls[0]?.body).not.toContain('private')
  expect(calls[0]?.body).toContain('chatgpt-booster')
  expect(calls[0]?.body).toContain('deployment.environment')
  expect(calls[0]?.body).not.toContain('tm-test-otel')
  expect(await journal.summary()).toMatchObject({ pending: 0, sending: 0 })
  service.close()
})

test('failed collector preserves journal and avoids unsafe transport endpoints', async () => {
  const scope2 = { ...scope, installationId: 'chromium-failure' }
  const journal = new DexieTelemetryJournal(scope2, drivers)
  let requests = 0
  const service = new ScopedOtlpService({
    scope: scope2,
    serviceId,
    version: '2.0.8',
    journal,
    sender: async () => {
      requests++
      throw Error('offline')
    },
  })
  service.setLocalEnabled(true)
  await service.port.emit('archive.export.failed', 1)
  expect(await service.flush({ enabled: true, endpoint: 'https://otel.test' })).toBe(0)
  expect(requests).toBe(1)
  expect(await journal.summary()).toMatchObject({ pending: 1, sending: 0 })
  for (const url of ['http://otel.test', 'https://user:pass@otel.test', 'https://otel.test?key=x'])
    expect(() => resolveOtlpLogsEndpoint(url)).toThrow('HTTPS')
  expect(requests).toBe(1)
  service.setLocalEnabled(false)
  expect(await service.flush({ enabled: true, endpoint: 'https://otel.test' })).toBe(0)
  service.close()
})

test('one collector can distinguish sources by OTLP resource, environment and instrumentation scope', async () => {
  const journal = new DexieTelemetryJournal(
    { productId: 'vk-booster', channel: 'prod', installationId: 'chromium-otel' },
    drivers,
  )
  const payloads: string[] = []
  const service = new ScopedOtlpService({
    scope: { productId: 'vk-booster', channel: 'prod', installationId: 'chromium-otel' },
    serviceId: 'VK Booster Service',
    version: '2.3.10',
    journal,
    sender: async (req) => {
      payloads.push(req.body)
    },
  })
  service.setLocalEnabled(true)
  await service.port.emit('archive.backup.completed', 7, 450)
  expect(await service.flush({ enabled: true, endpoint: 'https://otel.test' })).toBe(1)
  const json = JSON.parse(payloads[0] ?? '') as { resourceLogs: unknown[] }
  expect(json.resourceLogs).toHaveLength(1)
  expect(payloads[0]).toContain('vk-booster')
  expect(payloads[0]).toContain('prod')
  expect(payloads[0]).not.toContain('installationId')
  service.close()
})

test('shared OTLP payload keeps two services separately attributed in one collector', () => {
  const scope = { productId: 'all-in-one', channel: 'dev' as const, installationId: 'tm-multi' }
  const entry = {
    timestamp: 12345,
    name: 'archive.export.completed',
    state: 'pending' as const,
    leaseOwner: null,
    leaseUntil: 0,
    attempts: 0,
  }
  const rows = [
    { ...entry, serviceId: 'VK Booster Service' },
    { ...entry, serviceId: 'ChatGPT Booster Service' },
  ]
  const payload = JSON.parse(scopedOtlpPayload(rows, scope, '0.5.9')) as {
    resourceLogs: { resource: { attributes: { key: string; value: { stringValue: string } }[] } }[]
  }
  expect(payload.resourceLogs).toHaveLength(2)
  expect(
    payload.resourceLogs.map(
      (x) => x.resource.attributes.find((a) => a.key === 'service.name')?.value.stringValue,
    ),
  ).toEqual(['VK Booster Service', 'ChatGPT Booster Service'])
  expect(() =>
    scopedOtlpPayload(
      [{ ...entry, serviceId: 'VK Booster Service', name: 'private.email' }],
      scope,
      '0.5.9',
    ),
  ).toThrow('private OTLP')
})
