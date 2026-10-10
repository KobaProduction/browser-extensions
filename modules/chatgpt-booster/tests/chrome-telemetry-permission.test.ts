import { expect, test } from 'bun:test'
import { createChromeTelemetryControl } from '../packages/extension/src/telemetry'

type Client = Parameters<typeof createChromeTelemetryControl>[0]
type Settings = NonNullable<Parameters<typeof createChromeTelemetryControl>[1]>
const settings = (endpoint: string) => ({
  async get() { return { telemetry: { endpoint } } },
}) as Settings

const usingChrome = async (environment: unknown, callback: () => Promise<void>) => {
  const target = globalThis as unknown as Record<string, unknown>
  const original = target.chrome
  target.chrome = environment
  try { await callback() }
  finally {
    if (original === undefined) delete target.chrome
    else target.chrome = original
  }
}

test('MV3 telemetry consent only requests a configured HTTPS origin on explicit test', async () => {
  const requested: string[][] = []
  let calls = 0
  await usingChrome({ permissions: {
    async contains() { return false },
    async request(value: { origins: string[] }) { requested.push(value.origins); return true },
  } }, async () => {
    const control = createChromeTelemetryControl({ async test() { calls++ } } as Client,
      settings('https://metrics.example.test/otel/v1/traces'))
    await control.test()
  })
  expect(requested).toEqual([['https://metrics.example.test/*']])
  expect(calls).toBe(1)
})

test('content script does not bypass permission grants', async () => {
  let sent = 0
  await usingChrome({ runtime: { async sendMessage() { return { granted: false } } } }, async () => {
    const control = createChromeTelemetryControl({ async test() { sent++ } } as Client,
      settings('https://metrics.example.test/v1/traces'))
    await expect(control.test()).rejects.toThrow('extension popup')
  })
  expect(sent).toBe(0)
})

test('telemetry requests never accept insecure HTTP hosts', async () => {
  await usingChrome({ permissions: {
    async contains() { throw new Error('should not request any host') },
  } }, async () => {
    const control = createChromeTelemetryControl({ async test() {} } as Client,
      settings('http://metrics.example.test/v1/traces'))
    await expect(control.test()).rejects.toThrow('HTTPS')
  })
})
