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

function lifecycleRuntime(features: Feature[]) {
  const values = new Map<string, boolean>()
  const runtime = new FeatureRuntime(features, {
    target: 'userscript',
    url: new URL('https://example.invalid'),
    capabilities: defaultCapabilities('userscript'),
    settings: new FeatureSettings({
      async get(key) {
        return values.get(key)
      },
      async set(key, value) {
        values.set(key, value)
      },
    }),
  })
  return { runtime, values }
}

function lifecycleFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'provider',
    title: 'Provider',
    description: 'Synthetic lifecycle fixture',
    targets: ['userscript'],
    requiredCapabilities: [],
    match: () => true,
    start() {},
    ...overrides,
  }
}

test('failed provider teardown stays owned, is reported and blocks duplicate hooks until retry succeeds', async () => {
  let starts = 0,
    hooks = 0,
    failCleanup = true
  const { runtime } = lifecycleRuntime([
    lifecycleFeature({
      start() {
        starts++
        hooks++
      },
      stop() {
        if (failCleanup) throw Error('synthetic teardown failure')
        hooks--
      },
    }),
  ])
  await runtime.start()
  const observed: string[] = []
  runtime.subscribe(() => observed.push(runtime.list()[0]?.state ?? 'missing'))
  await expect(runtime.setEnabled('provider', false)).rejects.toThrow('Provider cleanup failed')
  expect(observed.at(-1)).toBe('failed')
  expect(runtime.list()[0]?.reason).toBe('Provider cleanup failed')
  await expect(runtime.open('provider')).rejects.toThrow('Module is not active')
  await expect(runtime.setEnabled('provider', true)).rejects.toThrow('Provider cleanup failed')
  expect({ starts, hooks }).toEqual({ starts: 1, hooks: 1 })
  failCleanup = false
  await runtime.setEnabled('provider', true)
  expect({ starts, hooks }).toEqual({ starts: 2, hooks: 1 })
  expect(runtime.list()[0]?.state).toBe('active')
  await runtime.stop()
  expect(hooks).toBe(0)
})

test('failed capability teardown retains its resource and retries before restart', async () => {
  let starts = 0,
    hooks = 0,
    failCleanup = true
  const { runtime } = lifecycleRuntime([
    lifecycleFeature({
      modules: [
        {
          id: 'capture',
          title: 'Capture',
          description: '',
          start() {
            starts++
            hooks++
          },
          stop() {
            if (failCleanup) throw Error('synthetic teardown failure')
            hooks--
          },
        },
      ],
    }),
  ])
  await runtime.start()
  await expect(runtime.setModuleEnabled('provider', 'capture', false)).rejects.toThrow(
    'Capability cleanup failed',
  )
  expect(runtime.moduleList()[0]).toMatchObject({ state: 'failed', enabled: false })
  await expect(runtime.setModuleEnabled('provider', 'capture', true)).rejects.toThrow(
    'Capability cleanup failed',
  )
  expect({ starts, hooks }).toEqual({ starts: 1, hooks: 1 })
  failCleanup = false
  await runtime.setModuleEnabled('provider', 'capture', true)
  expect({ starts, hooks }).toEqual({ starts: 2, hooks: 1 })
  await runtime.stop()
  expect(hooks).toBe(0)
})

test('partial startup hooks remain owned when initial cleanup fails', async () => {
  let starts = 0,
    hooks = 0,
    failStartup = true,
    failCleanup = true
  const { runtime } = lifecycleRuntime([
    lifecycleFeature({
      start() {
        starts++
        hooks++
        if (failStartup) throw Error('synthetic startup failure')
      },
      stop() {
        if (failCleanup) throw Error('synthetic teardown failure')
        hooks--
      },
    }),
  ])
  await runtime.start()
  expect(runtime.list()[0]?.reason).toBe('Provider startup and cleanup failed')
  await expect(runtime.setEnabled('provider', true)).rejects.toThrow('Provider cleanup failed')
  expect({ starts, hooks }).toEqual({ starts: 1, hooks: 1 })
  failCleanup = false
  failStartup = false
  await runtime.setEnabled('provider', true)
  expect({ starts, hooks }).toEqual({ starts: 2, hooks: 1 })
  await runtime.stop()
  expect(hooks).toBe(0)
})

test('installation teardown continues independent cleanup and keeps parent alive for failed children', async () => {
  let parentStops = 0,
    siblingStops = 0,
    failCleanup = true
  const { runtime } = lifecycleRuntime([
    lifecycleFeature({
      id: 'sibling',
      stop() {
        siblingStops++
      },
    }),
    lifecycleFeature({
      stop() {
        parentStops++
      },
      modules: [
        {
          id: 'capture',
          title: 'Capture',
          description: '',
          start() {},
          stop() {
            if (failCleanup) throw Error('synthetic teardown failure')
          },
        },
      ],
    }),
  ])
  await runtime.start()
  await expect(runtime.setRunning(false)).rejects.toThrow('Installation cleanup failed')
  expect(runtime.isRunning()).toBe(false)
  expect({ parentStops, siblingStops }).toEqual({ parentStops: 0, siblingStops: 1 })
  expect(runtime.list().map((item) => item.state)).toEqual(['disabled', 'failed'])
  failCleanup = false
  await runtime.refreshFromSettings()
  expect({ parentStops, siblingStops }).toEqual({ parentStops: 1, siblingStops: 1 })
  expect(runtime.list().map((item) => item.state)).toEqual(['disabled', 'disabled'])
  await runtime.stop()
})

test('partial capability startup is retried through cleanup, never through a second concurrent hook', async () => {
  let starts = 0,
    hooks = 0,
    failCleanup = true
  const { runtime } = lifecycleRuntime([
    lifecycleFeature({
      modules: [
        {
          id: 'capture',
          title: 'Capture',
          description: '',
          start() {
            starts++
            hooks++
            if (starts === 1) throw Error('synthetic startup failure')
          },
          stop() {
            if (failCleanup) throw Error('synthetic teardown failure')
            hooks--
          },
        },
      ],
    }),
  ])
  await runtime.start()
  expect(runtime.moduleList()[0]?.reason).toBe('Capability startup and cleanup failed')
  await expect(runtime.setModuleEnabled('provider', 'capture', true)).rejects.toThrow(
    'Capability cleanup failed',
  )
  expect({ starts, hooks }).toEqual({ starts: 1, hooks: 1 })
  failCleanup = false
  await runtime.setModuleEnabled('provider', 'capture', true)
  expect({ starts, hooks }).toEqual({ starts: 2, hooks: 1 })
  await runtime.stop()
  expect(hooks).toBe(0)
})
