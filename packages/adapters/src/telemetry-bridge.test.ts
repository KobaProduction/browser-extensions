import { expect, test } from 'bun:test'
import { TelemetryCollectorRejected } from './scoped-otlp'
import { createUserscriptTelemetryPersistence, userscriptTelemetrySender } from './telemetry-bridge'

function installGlobals(values: Record<string, unknown>) {
  const prior = new Map(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  return () => {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test('GM journal shares only one installed scope, persists delivery metadata, and rejects private extras', async () => {
  const values = new Map<string, unknown>()
  const restore = installGlobals({
    GM_getValue: async (key: string, fallback?: unknown) => values.get(key) ?? fallback,
    GM_setValue: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
    GM_deleteValue: async (key: string) => {
      values.delete(key)
    },
    GM_listValues: async () => [...values.keys()],
  })
  const scope = { productId: 'all-in-one', channel: 'dev' as const, installationId: 'synthetic-gm' }
  const first = createUserscriptTelemetryPersistence(scope),
    second = createUserscriptTelemetryPersistence(scope)
  const other = createUserscriptTelemetryPersistence({ ...scope, channel: 'prod' })
  try {
    if (!first || !second || !other) throw Error('Expected scoped GM persistence')
    const event = {
      serviceId: 'Koba Browser Tools',
      name: 'application.error',
      providerId: 'chatgpt-booster',
      errorClass: 'validation',
      timestamp: Date.now(),
    }
    await expect(
      first.journal.append({ ...event, raw: 'synthetic-private' } as typeof event),
    ).rejects.toThrow('Unsafe technical telemetry')
    await first.journal.append(event)
    expect(await second.journal.summary()).toMatchObject({ pending: 1, retained: 1 })
    expect(await other.journal.summary()).toMatchObject({ pending: 0, retained: 0 })
    const delivery = {
      state: 'retrying',
      collectorRejected: false,
      lastSentAt: null,
      nextAttemptAt: Date.now() + 60000,
      retryDelayMs: 60000,
    }
    await first.journal.writeDeliveryStatus(delivery)
    expect(await second.journal.readDeliveryStatus()).toEqual(delivery)
    await first.journal.prune(100, 86400000)
    expect((await second.journal.summary()).lastRotationAt).not.toBeNull()
    await second.journal.clear()
    expect(await first.journal.summary()).toMatchObject({
      pending: 0,
      retained: 0,
      lastRotationAt: null,
    })
    expect(JSON.stringify([...values.values()])).not.toContain('synthetic-private')
    expect(await first.journal.readDeliveryStatus()).toEqual(delivery)
  } finally {
    first?.journal.close()
    second?.journal.close()
    other?.journal.close()
    restore()
  }
})

test('GM sender is anonymous and rejects partial OTLP acceptance without leaking collector content', async () => {
  let observed: Record<string, unknown> | undefined
  const restore = installGlobals({
    GM_xmlhttpRequest: (details: Record<string, unknown>) => {
      observed = details
      queueMicrotask(() =>
        (details.onload as (response: unknown) => void)({
          status: 200,
          responseText:
            '{"partialSuccess":{"rejectedLogRecords":"1","errorMessage":"synthetic-private"}}',
        }),
      )
      return { abort() {} }
    },
  })
  try {
    const sender = userscriptTelemetrySender()
    if (!sender) throw Error('Expected a userscript telemetry sender')
    await expect(
      sender({
        url: 'https://collector.test/v1/logs',
        headers: { 'content-type': 'application/json' },
        body: '{"resourceLogs":[]}',
      }),
    ).rejects.toThrow(TelemetryCollectorRejected)
    expect(observed).toMatchObject({ anonymous: true, redirect: 'error', timeout: 15000 })
  } finally {
    restore()
  }
})
