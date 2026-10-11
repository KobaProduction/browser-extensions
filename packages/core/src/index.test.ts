import { expect, test } from 'bun:test'
import { defaultCapabilities, type Feature, FeatureRuntime, FeatureSettings } from './index'

test('feature runtime isolates exceptions and supports enable/disable', async () => {
  const memory = new Map<string, boolean>()
  const settings = new FeatureSettings({
    async get(k) {
      return memory.get(k)
    },
    async set(k, v) {
      memory.set(k, v)
    },
  })
  let opens = 0,
    starts = 0,
    stops = 0
  const good: Feature = {
    id: 'working',
    title: 'Working',
    description: 'fine',
    match: () => true,
    targets: ['userscript'],
    requiredCapabilities: ['page-dom'],
    start() {
      starts++
    },
    open() {
      opens++
    },
    stop() {
      stops++
    },
  }
  const bad: Feature = {
    id: 'broken',
    title: 'Broken',
    description: 'fails',
    match: () => true,
    targets: ['userscript'],
    requiredCapabilities: [],
    start() {
      throw Error('bad module')
    },
  }
  const runtime = new FeatureRuntime([good, bad], {
    target: 'userscript',
    url: new URL('https://vk.ru/im'),
    capabilities: defaultCapabilities('userscript'),
    settings,
  })
  await runtime.start()
  expect(runtime.list().map((x) => x.state)).toEqual(['active', 'failed'])
  await runtime.open('working')
  expect(opens).toBe(1)
  await runtime.setEnabled('working', false)
  expect(runtime.list()[0]?.state).toBe('disabled')
  expect(stops).toBe(1)
  await runtime.setEnabled('working', true)
  expect(starts).toBe(2)
})
test('unsupported browser capability is not enabled in Tampermonkey', async () => {
  const settings = new FeatureSettings({
    async get() {
      return true
    },
    async set() {},
  })
  const proxy: Feature = {
    id: 'proxy',
    title: 'Proxy',
    description: '',
    match: () => true,
    targets: ['chromium'],
    requiredCapabilities: ['proxy-settings'],
    start() {
      throw Error('should not run')
    },
  }
  const runtime = new FeatureRuntime([proxy], {
    target: 'userscript',
    url: new URL('https://example.org'),
    capabilities: defaultCapabilities('userscript'),
    settings,
  })
  await runtime.start()
  expect(runtime.list()[0]?.state).toBe('unsupported')
})

test('entire installation can stop and reattach without reload and without changing another channel', async () => {
  const devValues = new Map<string, boolean>()
  const prodValues = new Map<string, boolean>()
  const build = (values: Map<string, boolean>) => {
    const settings = new FeatureSettings({
      async get(key) {
        return values.get(key)
      },
      async set(key, enabled) {
        values.set(key, enabled)
      },
    })
    let installed = 0
    let detached = 0
    const feature: Feature = {
      id: 'capture',
      title: 'Capture',
      description: 'Synthetic native observer',
      targets: ['chromium'],
      requiredCapabilities: ['page-dom'],
      match: () => true,
      start() {
        installed++
      },
      stop() {
        detached++
      },
    }
    const runtime = new FeatureRuntime([feature], {
      target: 'chromium',
      url: new URL('https://chatgpt.com'),
      capabilities: defaultCapabilities('chromium'),
      settings,
    })
    return { runtime, counts: () => ({ installed, detached }), values }
  }
  const dev = build(devValues),
    prod = build(prodValues)
  const changes: string[] = []
  const dispose = dev.runtime.subscribe(() => changes.push(dev.runtime.list()[0]?.state ?? 'missing'))
  await Promise.all([dev.runtime.start(), prod.runtime.start()])
  expect(dev.counts()).toEqual({ installed: 1, detached: 0 })
  expect(prod.counts()).toEqual({ installed: 1, detached: 0 })
  await dev.runtime.setRunning(false)
  expect(dev.counts()).toEqual({ installed: 1, detached: 1 })
  expect(dev.runtime.list()[0]?.state).toBe('disabled')
  expect(devValues.get('installation.enabled')).toBe(false)
  expect(prodValues.has('installation.enabled')).toBe(false)
  expect(prod.runtime.list()[0]?.state).toBe('active')
  await dev.runtime.setRunning(true)
  expect(dev.counts()).toEqual({ installed: 2, detached: 1 })
  expect(dev.runtime.list()[0]?.state).toBe('active')
  expect(changes).toContain('disabled')
  dispose()
  await dev.runtime.stop()
  await prod.runtime.stop()
})

test('feature operations are serialized and cannot activate after a later off request', async () => {
  const storage = new Map<string, boolean>()
  const settings = new FeatureSettings({
    async get(key) {
      return storage.get(key)
    },
    async set(key, value) {
      storage.set(key, value)
    },
  })
  let active = false,
    stopCount = 0
  const feature: Feature = {
    id: 'agent',
    title: 'Agent',
    description: 'Synthetic slow start',
    match: () => true,
    targets: ['userscript'],
    requiredCapabilities: [],
    async start() {
      await Promise.resolve()
      active = true
    },
    stop() {
      stopCount++
      active = false
    },
  }
  const runtime = new FeatureRuntime([feature], {
    target: 'userscript',
    url: new URL('https://chatgpt.com'),
    capabilities: defaultCapabilities('userscript'),
    settings,
  })
  const initial = runtime.start()
  const off = runtime.setRunning(false)
  await Promise.all([initial, off])
  expect(active).toBe(false)
  expect(stopCount).toBe(1)
  expect(runtime.list()[0]?.state).toBe('disabled')
})

test('a sibling tab can revoke and restore this installation from scoped storage', async () => {
  const values = new Map<string, boolean>()
  let starts = 0,
    stops = 0
  const runtime = new FeatureRuntime(
    [
      {
        id: 'shared',
        title: 'Shared',
        description: '',
        match: () => true,
        targets: ['chromium'],
        requiredCapabilities: [],
        start() {
          starts++
        },
        stop() {
          stops++
        },
      },
    ],
    {
      target: 'chromium',
      url: new URL('https://chatgpt.com'),
      capabilities: defaultCapabilities('chromium'),
      settings: new FeatureSettings({
        async get(key) {
          return values.get(key)
        },
        async set(key, enabled) {
          values.set(key, enabled)
        },
      }),
    },
  )
  await runtime.start()
  expect(starts).toBe(1)
  values.set('installation.enabled', false)
  await runtime.refreshFromSettings()
  expect(runtime.isRunning()).toBe(false)
  expect(stops).toBe(1)
  expect(values.get('installation.enabled')).toBe(false)
  await runtime.refreshFromSettings()
  expect(stops).toBe(1)
  values.set('installation.enabled', true)
  await runtime.refreshFromSettings()
  expect(runtime.isRunning()).toBe(true)
  expect(starts).toBe(2)
  await runtime.stop()
})
