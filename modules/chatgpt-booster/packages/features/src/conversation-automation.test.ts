import { afterEach, expect, test } from 'bun:test'
import {
  type BoosterSettings,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import type {
  ApplicationTelemetryController,
  AutomationRule,
  RemoteSessionConfig,
} from '@kobaproduction/browser-core'
import { Window } from 'happy-dom'
import {
  createWsFixtureServer,
  SYNTHETIC_WS_TOKEN,
} from '../../../../../apps/ui-lab/scripts/ws-fixture-server.mjs'
import { installSyntheticAudio } from '../../../tests/fixtures/synthetic-audio'
import type { ChatGptRejectedSource, FixedChatGptCapture } from './archive-fixed-runtime'
import { ChatGptConversationAutomation } from './conversation-automation'
import type {
  ConversationLifecycleSnapshot,
  ConversationStateChange,
  ConversationStateStore,
} from './conversation-state'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const rule = (id: string): AutomationRule => ({
  id,
  label: id,
  enabled: true,
  trigger: { type: 'completion', outcome: 'complete' },
  actions: [{ type: 'stop' }],
  cooldownMs: 0,
})
async function setup(remote?: RemoteSessionConfig) {
  const dom = new Window({ url: 'https://chatgpt.com/c/synthetic-conversation' })
  const previous = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: dom, document: dom.document })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  let stored = normalizeSettings({
    enabled: true,
    features: { requestTimer: false } as BoosterSettings['features'],
    automation: {
      enabled: true,
      domEvents: false,
      rules: [],
      remote: {
        enabled: false,
        mode: 'local-only',
        endpoint: '',
        rawEvents: false,
        allowedCommands: [],
        queueLimit: 10000,
        inFlightLimit: 8,
        maxAttempts: 8,
        commandTtlMs: 60000,
      },
    },
  })
  let writes = 0
  if (remote) stored = mergeSettings(stored, { automation: { remote } })
  const listeners = new Set<(value: BoosterSettings) => void>()
  const settings: SettingsAdapter = {
    get: async () => structuredClone(stored),
    async set(value) {
      stored = normalizeSettings(value)
      writes++
      for (const listener of listeners) listener(structuredClone(stored))
      return structuredClone(stored)
    },
    async update(patch) {
      stored = mergeSettings(stored, patch)
      writes++
      for (const listener of listeners) listener(structuredClone(stored))
      return structuredClone(stored)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const noop = () => () => undefined
  const stateListeners = new Set<(change: ConversationStateChange) => void>()
  const accountListeners = new Set<() => void>()
  const lifecycleValues = new Map<string, ConversationLifecycleSnapshot>()
  const state = {
    verifiedAccountId: () => 'synthetic-owner',
    accountEpoch: () => 1,
    header: () => undefined,
    subscribeAccount(listener: () => void) {
      accountListeners.add(listener)
      return () => accountListeners.delete(listener)
    },
    subscribe(listener: (change: ConversationStateChange) => void) {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    subscribeStreamMessages: noop,
    lifecycle: (id: string) => lifecycleValues.get(id),
    listSnapshots: () => [...lifecycleValues.keys()].map((conversationId) => ({ conversationId })),
  } as unknown as ConversationStateStore
  const rejected = new Set<(source: ChatGptRejectedSource) => Promise<{ accepted: boolean }>>()
  const scope = {
    productId: 'chatgpt-booster' as const,
    channel: 'dev' as const,
    installationId: 'synthetic-provider',
    ownerId: 'synthetic-owner',
  }
  const archive = {
    currentScope: () => scope,
    subscribeCommitted: noop,
    subscribeRemoteSource: noop,
    subscribeRejectedSource(
      listener: (source: ChatGptRejectedSource) => Promise<{ accepted: boolean }>,
    ) {
      rejected.add(listener)
      return () => rejected.delete(listener)
    },
  } as unknown as FixedChatGptCapture
  const native = {
    send: async () => ({ observed: 'request' as const }),
    stop: async () => ({ observed: 'stop' as const }),
    continue: async () => ({ observed: 'request' as const }),
    newChat: async () => ({ observed: 'route' as const }),
  }
  const telemetryCalls: unknown[][] = []
  const telemetry = {
    record: async (...args: unknown[]) => {
      telemetryCalls.push(args)
    },
  } as unknown as ApplicationTelemetryController
  const automation = new ChatGptConversationAutomation(
    state,
    settings,
    archive,
    { getRemoteToken: async () => SYNTHETIC_WS_TOKEN } as never,
    native as never,
    telemetry,
  )
  cleanup.push(() => automation.stop())
  await automation.start()
  return {
    automation,
    settings,
    stored: () => stored,
    writes: () => writes,
    telemetryCalls,
    source(lifecycle: ConversationLifecycleSnapshot) {
      const conversationId = 'synthetic-conversation'
      lifecycleValues.set(conversationId, lifecycle)
      for (const listener of stateListeners)
        listener({ conversationId, revision: 1, reason: 'transport' })
    },
    accountChanged() {
      for (const listener of accountListeners) listener()
    },
    reject: async () => {
      for (const listener of rejected)
        await listener({
          scope,
          source: {
            accountId: scope.ownerId,
            conversationId: 'synthetic-conversation',
            observedAt: Date.now(),
            sourceKind: 'stream',
            raw: { future: 'synthetic-private-packet' },
          },
          reason: 'validation',
        })
    },
  }
}

const soundRun = (requestId: string, complete = false): ConversationLifecycleSnapshot => ({
  requestId,
  userMessageId: `user-${requestId}`,
  source: 'transport',
  state: complete ? 'complete' : 'in_progress',
  startedAt: Date.now() - 1000,
  completedAt: complete ? Date.now() : null,
  stopRequestedAt: null,
  terminalCause: null,
  transportHealth: 'healthy',
  updatedAt: Date.now(),
})
const flushCommands = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

test('sound trigger uses source completion and respects immediate global mute, master disable and stop', async () => {
  const audio = installSyntheticAudio()
  cleanup.push(async () => audio.restore())
  const { automation, settings, source } = await setup()
  await settings.update({
    features: { requestTimer: true },
    automation: {
      rules: [{ ...rule('sound'), actions: [{ type: 'play-sound', tone: 'chime' }] }],
    },
  })
  source(soundRun('first'))
  expect(automation.timing.current('synthetic-conversation')?.active).toBe(true)
  expect(audio.contexts).toHaveLength(0)
  source(soundRun('first', true))
  await flushCommands()
  expect(audio.contexts).toHaveLength(1)
  expect(audio.contexts[0]?.frequencies).toEqual([660, 880])
  source(soundRun('first', true))
  await flushCommands()
  expect(audio.contexts).toHaveLength(1)
  await settings.update({ alerts: { enabled: false } })
  expect(audio.contexts[0]?.closeCalls).toBe(1)
  source(soundRun('muted', true))
  await flushCommands()
  expect(audio.contexts).toHaveLength(1)
  await settings.update({ alerts: { enabled: true } })
  source(soundRun('second', true))
  await flushCommands()
  expect(audio.contexts).toHaveLength(2)
  await settings.update({ enabled: false })
  expect(audio.contexts[1]?.closeCalls).toBe(1)
  expect(automation.timing.current('synthetic-conversation')).toBeNull()
  source(soundRun('disabled'))
  expect(automation.timing.current('synthetic-conversation')).toBeNull()
  source(soundRun('disabled', true))
  await flushCommands()
  expect(audio.contexts).toHaveLength(2)
  await settings.update({ enabled: true })
  source(soundRun('third', true))
  await flushCommands()
  expect(audio.contexts).toHaveLength(3)
  await automation.stop()
  expect(audio.contexts[2]?.closeCalls).toBe(1)
  expect(automation.timing.current('synthetic-conversation')).toBeNull()
})

test('owner change cancels trigger audio and clears source timing', async () => {
  const audio = installSyntheticAudio()
  cleanup.push(async () => audio.restore())
  const { automation, settings, source, accountChanged } = await setup()
  await settings.update({
    features: { requestTimer: true },
    automation: {
      rules: [{ ...rule('sound-owner'), actions: [{ type: 'play-sound', tone: 'pulse' }] }],
    },
  })
  source(soundRun('owner-run', true))
  await flushCommands()
  expect(audio.contexts).toHaveLength(1)
  accountChanged()
  expect(audio.contexts[0]?.closeCalls).toBe(1)
  expect(automation.timing.current('synthetic-conversation')).toBeNull()
})
test('provider full trigger API changes live draft without writes and persists only explicit save', async () => {
  const { automation, settings, stored, writes } = await setup()
  await automation.dispatch('triggers-draft-upsert', { rule: rule('one') })
  expect(writes()).toBe(0)
  expect(automation.status().triggers.unsaved).toBe(true)
  await settings.update({ features: { completionSound: true } })
  expect(automation.triggerState().draftRules.map((rule) => rule.id)).toEqual(['one'])
  expect(await automation.dispatch('triggers-get', { id: 'one' })).toMatchObject({
    saved: null,
    draft: rule('one'),
    unsaved: true,
  })
  await automation.dispatch('triggers-draft-save', {})
  expect(writes()).toBe(2)
  expect(stored().automation.rules).toEqual([rule('one')])
  expect(automation.triggerState().unsaved).toBe(false)
  await automation.dispatch('triggers-draft-reset', {})
  expect(stored().automation.rules).toEqual([rule('one')])
  await automation.dispatch('triggers-draft-discard', {})
  expect(automation.triggerState().draftRules).toEqual([rule('one')])
  expect(await automation.dispatch('triggers-list', {})).toMatchObject({
    saved: [{ id: 'one', label: 'one', enabled: true }],
    unsaved: false,
  })
  expect(await automation.dispatch('triggers-get-config', {})).toHaveProperty('saved.remote')
  await automation.dispatch('triggers-draft-remove', { id: 'one' })
  expect(((await automation.dispatch('triggers-get-unsaved', {})) as { unsaved: boolean }).unsaved).toBe(
    true,
  )
  await automation.stop()
  await automation.start()
  expect(automation.triggerState().draftRules).toEqual([rule('one')])
  expect(automation.triggerState().unsaved).toBe(false)
  await automation.dispatch('triggers-set', { rules: [rule('compat')] })
  expect(stored().automation.rules).toEqual([rule('compat')])
  await automation.dispatch('triggers-reset', {})
  expect(stored().automation.rules).toEqual([])
})
test('validation failures are redacted telemetry and raw upload requires local consent plus server request', async () => {
  const server = createWsFixtureServer({ port: 0 })
  cleanup.push(() => server.stop())
  const remote: RemoteSessionConfig = {
    enabled: true,
    mode: 'remote-only',
    endpoint: server.endpoint,
    rawEvents: false,
    allowedCommands: [],
    queueLimit: 10000,
    inFlightLimit: 8,
    maxAttempts: 8,
    commandTtlMs: 60000,
  }
  const { automation, settings, reject, telemetryCalls } = await setup(remote)
  const until = async (condition: () => boolean) => {
    const end = Date.now() + 5000
    while (!condition()) {
      if (Date.now() > end)
        throw Error(
          `Provider synthetic wait timed out ${JSON.stringify({ remote: automation.status().remote, modes: server.modes })}`,
        )
      await Bun.sleep(10)
    }
  }
  await until(() => automation.status().remote?.state === 'online')
  await reject()
  expect(server.events).toHaveLength(0)
  const before = server.status().connections
  await settings.update({ automation: { remote: { rawEvents: true } } })
  await until(
    () => server.status().connections > before && automation.status().remote?.state === 'online',
  )
  await reject()
  expect(server.events).toHaveLength(0)
  server.requestMode('raw')
  await until(() => automation.status().remote?.eventMode === 'raw')
  await reject()
  await until(() => server.events.length === 1)
  expect(server.events[0].kind).toBe('archive.source-raw')
  expect(telemetryCalls).toHaveLength(3)
  expect(JSON.stringify(telemetryCalls)).not.toContain('synthetic-private-packet')
  expect(telemetryCalls[0]).toEqual([
    'application.error',
    1,
    undefined,
    { providerId: 'chatgpt-booster', errorClass: 'validation' },
  ])
}, 15000)
