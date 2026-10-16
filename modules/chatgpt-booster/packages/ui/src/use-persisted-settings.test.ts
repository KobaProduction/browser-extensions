import { expect, test } from 'bun:test'
import {
  type BoosterSettingsPatch,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { createRenderer } from 'vue'
import { usePersistedSettings } from './use-persisted-settings'

function mount(adapter: SettingsAdapter) {
  let state!: ReturnType<typeof usePersistedSettings>
  const renderer = createRenderer({
    insert() {},
    remove() {},
    patchProp() {},
    setText() {},
    setElementText() {},
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      state = usePersistedSettings(adapter)
      return () => null
    },
  })
  app.mount({})
  return { state, dispose: () => app.unmount() }
}
function fixture() {
  let stored = normalizeSettings()
  let failRead = false,
    failWrite = false
  const adapter: SettingsAdapter = {
    async get() {
      if (failRead) throw Error('unavailable')
      return stored
    },
    async set(next) {
      stored = next
    },
    async update(patch) {
      if (failWrite) throw Error('unavailable')
      stored = mergeSettings(stored, patch)
      return stored
    },
    subscribe: () => () => {},
  }
  return {
    adapter,
    failRead: (value: boolean) => {
      failRead = value
    },
    failWrite: (value: boolean) => {
      failWrite = value
    },
  }
}
test('failed settings load leaves an actionable error and retries to ready', async () => {
  const source = fixture(),
    { state, dispose } = mount(source.adapter)
  try {
    source.failRead(true)
    await state.load()
    expect(state.loading.value).toBe(false)
    expect(state.loadFailed.value).toBe(true)
    source.failRead(false)
    await state.load()
    expect(state.loadFailed.value).toBe(false)
    expect(state.settings.value).toBeDefined()
  } finally {
    dispose()
  }
})
test('a rejected write never reports saved, restores acknowledged state and can retry', async () => {
  const source = fixture(),
    { state, dispose } = mount(source.adapter)
  try {
    await state.load()
    const previous = state.settings.value?.observer.captureBodies
    source.failWrite(true)
    expect(await state.applyPatch({ observer: { captureBodies: !previous } })).toBe(false)
    expect(state.saved.value).toBe(false)
    expect(state.saveFailed.value).toBe(true)
    expect(state.saving.value).toBe(false)
    expect(state.settings.value?.observer.captureBodies).toBe(previous)
    source.failWrite(false)
    expect(await state.retrySave()).toBe(true)
    expect(state.settings.value?.observer.captureBodies).toBe(!previous)
    expect(state.saveFailed.value).toBe(false)
  } finally {
    dispose()
  }
})
test('connection writes are acknowledged only after persistence and queued writes retain siblings', async () => {
  const source = fixture()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = source.adapter.update
  const calls: BoosterSettingsPatch[] = []
  source.adapter.update = async (patch) => {
    calls.push(patch)
    await gate
    return original(patch)
  }
  const { state, dispose } = mount(source.adapter)
  try {
    await state.load()
    let acknowledged = false
    const first = state
      .applyPatch({ automation: { remote: { endpoint: 'wss://synthetic.example/socket' } } })
      .then((result) => {
        acknowledged = result
      })
    const second = state.applyPatch({ monitoring: { intervalMs: 1200 } })
    await Promise.resolve()
    expect(acknowledged).toBe(false)
    expect(state.saved.value).toBe(false)
    expect(calls).toHaveLength(1)
    release()
    await Promise.all([first, second])
    expect(acknowledged).toBe(true)
    expect(state.settings.value?.automation.remote.endpoint).toBe('wss://synthetic.example/socket')
    expect(state.settings.value?.monitoring.intervalMs).toBe(1200)
    expect(calls).toHaveLength(2)
  } finally {
    dispose()
  }
})
test('a later successful control write does not hide an earlier queued failure', async () => {
  const source = fixture()
  const update = source.adapter.update
  let first = true
  source.adapter.update = async (patch) => {
    if (first) {
      first = false
      throw Error('unavailable')
    }
    return update(patch)
  }
  const { state, dispose } = mount(source.adapter)
  try {
    await state.load()
    const previous = state.settings.value?.observer.captureBodies
    await Promise.all([
      state.applyPatch({ observer: { captureBodies: !previous } }),
      state.applyPatch({ monitoring: { intervalMs: 1400 } }),
    ])
    expect(state.saved.value).toBe(false)
    expect(state.saveFailed.value).toBe(true)
    expect(state.settings.value?.monitoring.intervalMs).toBe(1400)
    expect(await state.retrySave()).toBe(true)
    expect(state.saveFailed.value).toBe(false)
    expect(state.settings.value?.observer.captureBodies).toBe(!previous)
    expect(state.settings.value?.monitoring.intervalMs).toBe(1400)
  } finally {
    dispose()
  }
})
