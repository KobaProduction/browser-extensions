import { expect, test } from 'bun:test'
import { ScopedTelemetry, type ScopedTelemetryEvent } from '@kobaproduction/browser-core'
import { asTelemetryPort } from './telemetry-port'

test('one telemetry port is scoped, opt-in and exposes only approved numeric metrics', async () => {
  const events: ScopedTelemetryEvent[] = []
  const source = new ScopedTelemetry('ChatGPT Booster Service', 'chatgpt-booster:dev', {
    async send(event) {
      events.push(event)
    },
  })
  const port = asTelemetryPort({ productId: 'chatgpt-booster', channel: 'dev' }, source)
  expect(port.available).toBe(true)
  await port.emit('archive.capture.completed', 42)
  expect(events).toHaveLength(0)
  source.setEnabled(true)
  await port.emit('private/conversation-id?secret', 1)
  await port.emit('archive.capture.completed', 42, 250)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    serviceId: 'ChatGPT Booster Service',
    productId: 'chatgpt-booster',
    channel: 'dev',
    schemaVersion: 1,
    name: 'archive.capture.completed',
    count: 42,
    durationMs: 250,
  })
  expect(JSON.stringify(events)).not.toContain('secret')
})

test('telemetry cannot be connected across product/channel boundaries', () => {
  const source = new ScopedTelemetry('VK Booster Service', 'vk-booster:dev')
  expect(() => asTelemetryPort({ productId: 'vk-booster', channel: 'prod' }, source)).toThrow('mismatch')
  expect(() => asTelemetryPort({ productId: 'all-in-one', channel: 'dev' }, source)).toThrow('mismatch')
})

test('telemetry sink failure never breaks application operation', async () => {
  const source = new ScopedTelemetry('VK Booster Service', 'vk-booster:prod', {
    send() {
      throw new Error('network unavailable')
    },
  })
  source.setEnabled(true)
  const port = asTelemetryPort({ productId: 'vk-booster', channel: 'prod' }, source)
  await expect(port.emit('archive.backup.completed', 1)).resolves.toBeUndefined()
})
