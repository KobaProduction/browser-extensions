import { expect, test } from 'bun:test'
import { TelemetryBus, type TelemetryEvent } from './index'

test('shared telemetry is opt-in and never includes private content', async () => {
  const events: TelemetryEvent[] = []
  const bus = new TelemetryBus({
    send(event) {
      events.push(event)
    },
  })
  await bus.record('feature.started', 'vk-booster', 17)
  expect(events).toHaveLength(0)
  bus.setEnabled(true)
  await bus.record('feature.started', 'vk-booster', 17)
  expect(events).toHaveLength(1)
  expect(Object.keys(events[0] ?? {}).sort()).toEqual(['durationMs', 'event', 'moduleId', 'timestamp'])
  expect(events[0]?.durationMs).toBe(17)
  await bus.record('feature.failed', '../credentials')
  expect(events).toHaveLength(1)
})
test('telemetry sink failure cannot abort application', async () => {
  const bus = new TelemetryBus({
    send() {
      throw Error('network failed')
    },
  })
  bus.setEnabled(true)
  await expect(bus.record('feature.failed', 'vk-booster')).resolves.toBeUndefined()
})
