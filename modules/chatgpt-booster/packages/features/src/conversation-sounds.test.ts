import { afterEach, expect, test } from 'bun:test'
import {
  type BoosterSettings,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { Window } from 'happy-dom'
import { installSyntheticAudio } from '../../../tests/fixtures/synthetic-audio'
import { ConversationSoundsModule, playConversationTone } from './conversation-sounds'
import type {
  ConversationLifecycleSnapshot,
  ConversationStateChange,
  ConversationStateStore,
} from './conversation-state'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop()
})
async function setup() {
  const dom = new Window({ url: 'https://chatgpt.com/c/synthetic-sounds' })
  const previous = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: dom, document: dom.document })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  const audio = installSyntheticAudio()
  cleanup.push(() => audio.restore())
  let stored = normalizeSettings()
  const settingsListeners = new Set<(settings: BoosterSettings) => void>()
  const sourceListeners = new Set<(change: ConversationStateChange) => void>()
  const accountListeners = new Set<() => void>()
  let lifecycle: ConversationLifecycleSnapshot | undefined
  let owner = 'synthetic-audio-owner'
  const settings: SettingsAdapter = {
    get: async () => structuredClone(stored),
    async set(next) {
      stored = normalizeSettings(next)
      for (const listener of settingsListeners) listener(stored)
    },
    async update(patch) {
      stored = mergeSettings(stored, patch)
      for (const listener of settingsListeners) listener(stored)
      return stored
    },
    subscribe(listener) {
      settingsListeners.add(listener)
      return () => settingsListeners.delete(listener)
    },
  }
  const state = {
    lifecycle: () => lifecycle,
    verifiedAccountId: () => owner,
    subscribe(listener: (change: ConversationStateChange) => void) {
      sourceListeners.add(listener)
      return () => sourceListeners.delete(listener)
    },
    subscribeAccount(listener: () => void) {
      accountListeners.add(listener)
      return () => accountListeners.delete(listener)
    },
  } as unknown as ConversationStateStore
  const sounds = new ConversationSoundsModule(settings, state)
  cleanup.push(() => sounds.stop())
  await sounds.start()
  return {
    audio,
    settings,
    sounds,
    source(next: ConversationLifecycleSnapshot, reason: ConversationStateChange['reason']) {
      lifecycle = next
      for (const listener of sourceListeners)
        listener({ conversationId: 'synthetic-sounds', revision: 1, reason })
    },
    accountChanged() {
      owner = 'synthetic-audio-next-owner'
      for (const listener of accountListeners) listener()
    },
  }
}
const lifecycle = (requestId: string): ConversationLifecycleSnapshot => ({
  requestId,
  userMessageId: `user-${requestId}`,
  state: 'in_progress',
  source: 'request',
  startedAt: Date.now(),
  completedAt: null,
  stopRequestedAt: null,
  terminalCause: null,
  updatedAt: Date.now(),
})

test('default send/complete sounds use source facts once, and sound/master disable closes audio immediately', async () => {
  const { audio, source, settings, sounds } = await setup()
  const first = lifecycle('synthetic-first')
  source(first, 'request')
  source(first, 'request')
  expect(audio.contexts).toHaveLength(1)
  expect(audio.contexts[0]?.frequencies).toEqual([520])
  source({ ...first, source: 'transport', state: 'complete', completedAt: Date.now() }, 'transport')
  expect(audio.contexts).toHaveLength(2)
  expect(audio.contexts[1]?.frequencies).toEqual([660, 880])
  await settings.update({ alerts: { enabled: false } })
  expect(audio.contexts.map((context) => context.closeCalls)).toEqual([1, 1])
  source(lifecycle('synthetic-muted'), 'request')
  expect(audio.contexts).toHaveLength(2)
  await settings.update({ alerts: { enabled: true } })
  source(lifecycle('synthetic-second'), 'request')
  expect(audio.contexts).toHaveLength(3)
  await settings.update({ enabled: false })
  expect(audio.contexts[2]?.closeCalls).toBe(1)
  source(lifecycle('synthetic-disabled'), 'request')
  expect(audio.contexts).toHaveLength(3)
  sounds.stop()
  expect(audio.contexts.map((context) => context.closeCalls)).toEqual([1, 1, 1])
})

test('owner changes and stop close owned audio without suppressing the next owner same-ID request', async () => {
  const { audio, source, accountChanged, sounds } = await setup()
  const run = lifecycle('synthetic-shared-id')
  source(run, 'request')
  accountChanged()
  expect(audio.contexts[0]?.closeCalls).toBe(1)
  source(run, 'request')
  expect(audio.contexts).toHaveLength(2)
  sounds.stop()
  expect(audio.contexts[1]?.closeCalls).toBe(1)
  source(lifecycle('synthetic-after-stop'), 'request')
  expect(audio.contexts).toHaveLength(2)
})

test('audio permission failure stays optional and stopped pending initialization cannot install subscriptions', async () => {
  const { settings } = await setup()
  const unavailable = installSyntheticAudio(true)
  cleanup.push(() => unavailable.restore())
  expect(playConversationTone('chime')).toBeUndefined()
  let resolveRead: (settings: BoosterSettings) => void = () => undefined
  const pending = new Promise<BoosterSettings>((resolve) => {
    resolveRead = resolve
  })
  let subscriptions = 0
  const sounds = new ConversationSoundsModule({ ...settings, get: () => pending }, {
    subscribe() {
      subscriptions++
    },
    subscribeAccount() {
      subscriptions++
    },
  } as unknown as ConversationStateStore)
  cleanup.push(() => sounds.stop())
  const starting = sounds.start()
  sounds.stop()
  resolveRead(normalizeSettings())
  await starting
  expect(subscriptions).toBe(0)
})

test('failed initial settings read releases initialization so a later start can retry', async () => {
  const { settings } = await setup()
  let reads = 0
  let subscriptions = 0
  const sounds = new ConversationSoundsModule(
    {
      ...settings,
      async get() {
        if (++reads === 1) throw Error('Synthetic settings unavailable')
        return normalizeSettings()
      },
    },
    {
      subscribe() {
        subscriptions++
        return () => subscriptions--
      },
      subscribeAccount() {
        subscriptions++
        return () => subscriptions--
      },
    } as unknown as ConversationStateStore,
  )
  cleanup.push(() => sounds.stop())
  await expect(sounds.start()).rejects.toThrow('Synthetic settings unavailable')
  expect(subscriptions).toBe(0)
  await sounds.start()
  expect(reads).toBe(2)
  expect(subscriptions).toBe(2)
  sounds.stop()
  expect(subscriptions).toBe(0)
})
