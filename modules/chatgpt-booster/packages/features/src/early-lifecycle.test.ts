import { afterEach, expect, test } from 'bun:test'
import { normalizeSettings, type SettingsAdapter } from '@chatgpt-booster/core'
import { CONVERSATION_ACCOUNT_EVENT, TRANSPORT_CHANNEL } from '@chatgpt-booster/observer'
import { Window } from 'happy-dom'
import { createChatGptBoosterFeature } from '../../../src'
import { createBoosterPageRuntime } from './page-runtime'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop()
})
function setup() {
  const dom = new Window({ url: 'https://chatgpt.com/c/synthetic-early' })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    CustomEvent: globalThis.CustomEvent,
    __BOOSTER_INSTANCE_SCOPE__: (globalThis as unknown as Record<string, unknown>)
      .__BOOSTER_INSTANCE_SCOPE__,
  }
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    location: dom.location,
    CustomEvent: dom.CustomEvent,
    __BOOSTER_INSTANCE_SCOPE__: 'chatgpt-booster:dev',
  })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  let saved = normalizeSettings()
  const settings: SettingsAdapter = {
    get: async () => saved,
    set: async (next) => {
      saved = next
    },
    update: async () => saved,
    subscribe: () => () => {},
  }
  return {
    target: {
      label: 'Tampermonkey',
      settings,
      diagnostics: { recordTransportBatch() {} } as never,
      pageBridgeWindow: dom as unknown as globalThis.Window,
    },
    owner(accountId: string) {
      dom.dispatchEvent(
        new dom.MessageEvent('message', {
          source: dom as never,
          origin: dom.location.origin,
          data: {
            channel: TRANSPORT_CHANNEL,
            type: CONVERSATION_ACCOUNT_EVENT,
            detail: { accountId, observedAt: Date.now() },
          },
        }),
      )
    },
  }
}
test('feature startEarly then stop without full runtime activation revokes owner and requires fresh proof on re-enable', async () => {
  const f = setup()
  let installed = 0,
    detached = 0
  const { feature, startEarly } = createChatGptBoosterFeature(f.target, {
    install() {
      installed++
      return () => {
        detached++
      }
    },
  })
  cleanup.push(() => feature.stop?.())
  await startEarly()
  f.owner('synthetic-owner-A')
  expect((await feature.backup?.())?.map((source) => source.id)).toContain('chatgpt-booster.indexeddb')
  await feature.stop?.()
  expect(detached).toBe(1)
  await startEarly()
  expect(installed).toBe(2)
  expect((await feature.backup?.())?.map((source) => source.id)).not.toContain(
    'chatgpt-booster.indexeddb',
  )
  f.owner('synthetic-owner-B')
  expect((await feature.backup?.())?.map((source) => source.id)).toContain('chatgpt-booster.indexeddb')
  await feature.stop?.()
  await feature.stop?.()
  expect(detached).toBe(2)
})

test('received metrics render independently of the asynchronous saved-count capability', async () => {
  const f = setup()
  const { feature, startEarly } = createChatGptBoosterFeature(f.target)
  cleanup.push(() => feature.stop?.())
  await startEarly()
  f.owner('synthetic-count-owner')
  const metrics = await feature.quickMetrics?.()
  expect(metrics?.map((metric) => [metric.label, metric.value])).toEqual([
    ['Получено сообщений', 0],
    ['Сохранено сообщений', '…'],
  ])
})
test('early teardown fences owner synchronously and still stops automation when archive teardown rejects', async () => {
  const f = setup(),
    page = createBoosterPageRuntime({ target: f.target, mountUi: false, externalSounds: true })
  await page.startEarly()
  f.owner('synthetic-owner-A')
  expect(page.automation.status().verifiedOwner).toBe(true)
  const original = page.fixedArchive.stop.bind(page.fixedArchive)
  page.fixedArchive.stop = async () => {
    throw Error('Synthetic archive close failure')
  }
  const stopping = page.stopEarly()
  expect(page.automation.status().verifiedOwner).toBe(false)
  await expect(stopping).rejects.toThrow('Synthetic archive close failure')
  await expect(page.automation.dispatch('send-message', { text: 'synthetic' })).rejects.toThrow()
  page.fixedArchive.stop = original
  await page.stopEarly()
})

test('pending early settings initialization cannot reactivate archive after teardown', async () => {
  const f = setup()
  let resolve!: (value: ReturnType<typeof normalizeSettings>) => void
  f.target.settings.get = () =>
    new Promise((done) => {
      resolve = done
    })
  const page = createBoosterPageRuntime({ target: f.target, mountUi: false, externalSounds: true })
  let archiveStarts = 0
  page.fixedArchive.start = () => {
    archiveStarts++
  }
  const starting = page.startEarly()
  await Promise.resolve()
  await page.stopEarly()
  resolve(normalizeSettings())
  await starting
  expect(archiveStarts).toBe(0)
  expect(page.automation.status().verifiedOwner).toBe(false)
})

test('early reactivation waits for the previous archive teardown before opening new resources', async () => {
  const f = setup(),
    page = createBoosterPageRuntime({ target: f.target, mountUi: false, externalSounds: true })
  await page.startEarly()
  const original = page.fixedArchive.stop.bind(page.fixedArchive)
  let release!: () => void
  page.fixedArchive.stop = async () => {
    await new Promise<void>((done) => {
      release = done
    })
    await original()
  }
  let starts = 0
  const startArchive = page.fixedArchive.start.bind(page.fixedArchive)
  page.fixedArchive.start = () => {
    starts++
    startArchive()
  }
  const stopping = page.stopEarly()
  await Promise.resolve()
  const starting = page.startEarly()
  await Promise.resolve()
  expect(starts).toBe(0)
  release()
  await stopping
  await starting
  expect(starts).toBe(1)
  page.fixedArchive.stop = original
  await page.stopEarly()
})
