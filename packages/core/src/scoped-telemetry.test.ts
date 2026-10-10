import { expect, test } from 'bun:test'
import { ScopedTelemetry, type ScopedTelemetryEvent } from './scoped-telemetry'

test('telemetry is opt-in, scoped and excludes all user data', async () => {
  const events: ScopedTelemetryEvent[] = []
  const metric = new ScopedTelemetry('VK Booster Service', 'vk-booster:dev', {
    send(x) {
      events.push(x)
    },
  })
  await metric.record('archive.capture.completed', 3000)
  expect(events.length).toBe(0)
  metric.setEnabled(true)
  await metric.record('archive.capture.completed', 3000, 1234)
  expect(events.length).toBe(1)
  expect(events[0]).toMatchObject({
    service: 'VK Booster Service',
    scope: 'vk-booster:dev',
    serviceId: 'VK Booster Service',
    productId: 'vk-booster',
    channel: 'dev',
    schemaVersion: 1,
    name: 'archive.capture.completed',
    count: 3000,
    durationMs: 1234,
  })
  expect(Object.keys(events[0] ?? {})).toEqual([
    'service',
    'serviceId',
    'scope',
    'productId',
    'channel',
    'schemaVersion',
    'name',
    'timestamp',
    'count',
    'durationMs',
  ])
})
test('telemetry errors never interrupt feature operations', async () => {
  const metric = new ScopedTelemetry('VK Booster Service', 'all-in-one:dev', {
    send() {
      throw Error('offline')
    },
  })
  metric.setEnabled(true)
  await expect(metric.record('archive.export.failed', 1)).resolves.toBeUndefined()
})
