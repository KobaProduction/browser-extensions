import { expect, test } from 'bun:test'
import { DexieTelemetryJournal } from '@kobaproduction/browser-storage'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import {
  resolveOtlpLogsEndpoint,
  ScopedOtlpService,
  scopedOtlpPayload,
  sendOtlpRequest,
  TelemetryCollectorRejected,
  validateOtlpAcknowledgement,
} from './scoped-otlp'

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
  ).toThrow('Unsafe technical telemetry')
})

test('shared default HTTP sender never attaches cookies or accepts collector rejection', async () => {
  const prior = globalThis.fetch
  let observed: RequestInit | undefined
  globalThis.fetch = async (_url, options) => {
    observed = options
    return { ok: false, status: 503 } as Response
  }
  try {
    await expect(
      sendOtlpRequest({
        url: 'https://otel.test/v1/logs',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ).rejects.toThrow('did not acknowledge')
    expect(observed?.credentials).toBe('omit')
    expect(observed?.redirect).toBe('error')
    expect(observed?.signal).toBeTruthy()
  } finally {
    globalThis.fetch = prior
  }
})

test('partial OTLP rejection retains the entire batch and persists a manual-recovery block', async () => {
  const ownScope = { ...scope, installationId: 'synthetic-partial-rejection' }
  const journal = new DexieTelemetryJournal(ownScope, drivers)
  let requests = 0
  const service = new ScopedOtlpService({
    scope: ownScope,
    serviceId,
    version: '1.0.0',
    journal,
    changed: (status) => journal.writeDeliveryStatus(status),
    sender: async () => {
      requests++
      validateOtlpAcknowledgement(
        200,
        JSON.stringify({
          partialSuccess: {
            rejectedLogRecords: '1',
            errorMessage: 'synthetic-private-collector-detail',
          },
        }),
      )
    },
  })
  service.setLocalEnabled(true)
  await service.port.emit('application.error', 1)
  expect(await service.flush({ enabled: true, endpoint: 'https://collector.test' })).toBe(0)
  expect(service.deliveryStatus()).toMatchObject({
    state: 'collector-rejected',
    collectorRejected: true,
    nextAttemptAt: null,
  })
  expect(await journal.summary()).toMatchObject({ pending: 1, sending: 0, delivered: 0 })
  const checkpoint = await journal.readDeliveryStatus()
  expect(JSON.stringify(checkpoint)).not.toContain('synthetic-private-collector-detail')
  expect(await service.flush({ enabled: true, endpoint: 'https://collector.test' })).toBe(0)
  expect(requests).toBe(1)
  service.close()
  const reopened = new DexieTelemetryJournal(ownScope, drivers)
  const resumed = new ScopedOtlpService({
    scope: ownScope,
    serviceId,
    version: '1.0.0',
    journal: reopened,
    sender: async () => {
      requests++
    },
  })
  resumed.restoreDeliveryStatus(checkpoint)
  resumed.setLocalEnabled(true)
  expect(await resumed.flush({ enabled: true, endpoint: 'https://collector.test' })).toBe(0)
  expect(requests).toBe(1)
  resumed.resetDeliveryStatus()
  expect(await resumed.flush({ enabled: true, endpoint: 'https://collector.test' })).toBe(1)
  expect(requests).toBe(2)
  await reopened.clear()
  resumed.close()
})

test('late success after local opt-out cannot acknowledge or overwrite the delivery checkpoint', async () => {
  const ownScope = { ...scope, installationId: 'synthetic-revoked-request' }
  const journal = new DexieTelemetryJournal(ownScope, drivers)
  let release!: () => void, entered!: () => void
  const sent = new Promise<void>((resolve) => {
    entered = resolve
  })
  let signal: AbortSignal | undefined
  const service = new ScopedOtlpService({
    scope: ownScope,
    serviceId,
    version: '1.0.0',
    journal,
    sender: (request) => {
      signal = request.signal
      entered()
      return new Promise<void>((resolve) => {
        release = resolve
      })
    },
  })
  service.setLocalEnabled(true)
  await service.port.emit('application.notification', 1)
  const delivery = service.flush({ enabled: true, endpoint: 'https://collector.test' })
  await sent
  service.setLocalEnabled(false)
  expect(signal?.aborted).toBe(true)
  release()
  expect(await delivery).toBe(0)
  expect(await journal.summary()).toMatchObject({ pending: 1, sending: 0, delivered: 0 })
  expect(service.deliveryStatus()).toMatchObject({ state: 'off', nextAttemptAt: null, lastSentAt: null })
  await journal.clear()
  service.close()
})

test('a recreated worker preserves the future retry checkpoint instead of sending immediately', async () => {
  const ownScope = { ...scope, installationId: 'synthetic-retry-checkpoint' }
  const journal = new DexieTelemetryJournal(ownScope, drivers)
  const service = new ScopedOtlpService({
    scope: ownScope,
    serviceId,
    version: '1.0.0',
    journal,
    changed: (status) => journal.writeDeliveryStatus(status),
    sender: async () => {
      throw new TypeError('synthetic-private-network-detail')
    },
  })
  service.setLocalEnabled(true)
  await service.port.emit('application.notification', 1)
  await service.flush({ enabled: true, endpoint: 'https://collector.test' })
  const checkpoint = service.deliveryStatus()
  expect(checkpoint.state).toBe('retrying')
  expect(checkpoint.nextAttemptAt).toBeGreaterThan(Date.now())
  expect(checkpoint.retryDelayMs).toBeGreaterThanOrEqual(30000)
  expect(await journal.readDeliveryStatus()).toEqual(checkpoint)
  expect(JSON.stringify(checkpoint)).not.toContain('synthetic-private-network-detail')
  service.close()
  const reopened = new DexieTelemetryJournal(ownScope, drivers)
  let requests = 0
  const resumed = new ScopedOtlpService({
    scope: ownScope,
    serviceId,
    version: '1.0.0',
    journal: reopened,
    sender: async () => {
      requests++
    },
  })
  resumed.restoreDeliveryStatus(checkpoint)
  resumed.setLocalEnabled(true)
  resumed.startDelivery(async () => ({ enabled: true, endpoint: 'https://collector.test' }))
  expect(resumed.deliveryStatus().nextAttemptAt).toBe(checkpoint.nextAttemptAt)
  await Bun.sleep(5)
  expect(requests).toBe(0)
  resumed.stopDelivery()
  await reopened.clear()
  resumed.close()
})

test('OTLP acknowledgement validates bounded acceptance without exposing collector text', () => {
  for (const body of [
    '{}',
    '{"futureCollectorField":true}',
    '{"partialSuccess":{"rejectedLogRecords":"0","errorMessage":"ignored"}}',
  ])
    expect(() => validateOtlpAcknowledgement(200, body)).not.toThrow()
  for (const body of [
    '',
    '[]',
    '{"partialSuccess":{"rejectedLogRecords":-1}}',
    '{"partialSuccess":{"rejectedLogRecords":"1","errorMessage":"synthetic-private"}}',
    'x'.repeat(65537),
  ]) {
    try {
      validateOtlpAcknowledgement(200, body)
      throw Error('Expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(TelemetryCollectorRejected)
      expect((error as Error).message).not.toContain('synthetic-private')
    }
  }
  expect(() => validateOtlpAcknowledgement(401, 'private')).toThrow(TelemetryCollectorRejected)
  expect(() => validateOtlpAcknowledgement(503, 'private')).not.toThrow(TelemetryCollectorRejected)
})
