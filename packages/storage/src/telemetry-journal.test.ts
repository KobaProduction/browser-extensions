import { expect, test } from 'bun:test'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { DexieTelemetryJournal, telemetryDatabaseName } from './telemetry-journal'

const drivers = { indexedDB, IDBKeyRange }
const scope = (productId: string, channel: 'dev' | 'prod', installationId: string) => ({
  productId,
  channel,
  installationId,
})

test('Dexie journal isolates product/channel/target and rejects owner-bound or missing scope', async () => {
  const dev = new DexieTelemetryJournal(scope('chatgpt-booster', 'dev', 'tm'), drivers)
  const prod = new DexieTelemetryJournal(scope('chatgpt-booster', 'prod', 'tm'), drivers)
  const aggregate = new DexieTelemetryJournal(scope('all-in-one', 'dev', 'tm'), drivers)
  const chromium = new DexieTelemetryJournal(scope('chatgpt-booster', 'dev', 'chromium'), drivers)
  expect(
    new Set([dev.databaseName, prod.databaseName, aggregate.databaseName, chromium.databaseName]).size,
  ).toBe(4)
  await dev.append({
    serviceId: 'ChatGPT Booster Service',
    name: 'archive.export.completed',
    timestamp: 100,
  })
  expect(await prod.summary()).toMatchObject({ pending: 0, sending: 0 })
  expect(await aggregate.summary()).toMatchObject({ pending: 0 })
  expect(await chromium.summary()).toMatchObject({ pending: 0 })
  expect(() => telemetryDatabaseName({ productId: 'vk-booster', channel: 'dev' })).toThrow(
    'installation',
  )
  expect(() =>
    telemetryDatabaseName({ ...scope('vk-booster', 'dev', 'tm'), ownerId: 'private' }),
  ).toThrow('Account-linked')
  dev.close()
  prod.close()
  aggregate.close()
  chromium.close()
})

test('journal allowlist, bounded rotation, lease owner and acknowledgment survive reopening', async () => {
  const id = scope('vk-booster', 'prod', 'tm-retention')
  const journal = new DexieTelemetryJournal(id, drivers, 2)
  const event = { serviceId: 'VK Booster Service', name: 'archive.capture.completed', timestamp: 100 }
  await expect(
    journal.append({ ...event, name: 'user-private-content', secret: 'NO' } as typeof event),
  ).rejects.toThrow()
  await journal.append({ ...event, timestamp: 101 })
  await journal.append({ ...event, timestamp: 102 })
  await journal.append({ ...event, timestamp: 103 })
  expect(await journal.summary()).toEqual({ pending: 2, sending: 0, discarded: 1 })
  const claimed = await journal.claim('first_worker_42', 200)
  expect(claimed.map((x) => x.timestamp)).toEqual([102, 103])
  expect(await journal.claim('second_worker_42', 201)).toHaveLength(0)
  expect(
    await journal.acknowledge(
      'second_worker_42',
      claimed.map((x) => x.id ?? -1),
    ),
  ).toBe(0)
  journal.close()
  const reopened = new DexieTelemetryJournal(id, drivers, 2)
  expect(await reopened.summary()).toEqual({ pending: 0, sending: 2, discarded: 1 })
  const reclaimed = await reopened.claim('second_worker_42', 46_000)
  expect(reclaimed).toHaveLength(2)
  expect(
    await reopened.acknowledge(
      'first_worker_42',
      reclaimed.map((x) => x.id ?? -1),
    ),
  ).toBe(0)
  await reopened.release(
    'second_worker_42',
    reclaimed.map((x) => x.id ?? -1),
  )
  expect(await reopened.summary()).toEqual({ pending: 2, sending: 0, discarded: 1 })
  const next = await reopened.claim('second_worker_42', 46_001)
  expect(
    await reopened.acknowledge(
      'second_worker_42',
      next.map((x) => x.id ?? -1),
    ),
  ).toBe(2)
  expect(await reopened.summary()).toEqual({ pending: 0, sending: 0, discarded: 1 })
  await reopened.clear()
  expect(await reopened.summary()).toEqual({ pending: 0, sending: 0, discarded: 0 })
  reopened.close()
})
