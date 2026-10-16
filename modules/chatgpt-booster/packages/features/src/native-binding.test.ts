import { afterEach, expect, test } from 'bun:test'
import { normalizeSettings, type SettingsAdapter } from '@chatgpt-booster/core'
import {
  CONVERSATION_ACCOUNT_EVENT,
  CONVERSATION_REQUEST_EVENT,
  CONVERSATION_STOP_EVENT,
  TRANSPORT_CHANNEL,
} from '@chatgpt-booster/observer'
import { Window } from 'happy-dom'
import { ArchiveSourceGate } from './archive-source-contract'
import {
  createChatGptNativeCommandPort,
  createChatGptNativeMethodRegistry,
} from './conversation-command-port'
import { ConversationStateStore } from './conversation-state'
import {
  CHATGPT_NATIVE_BINDING_CONTRACT,
  type ChatGptNativeBindingOptions,
  type ChatGptNativeCachedExports,
  createChatGptNativeApplicationBinding,
} from './native-binding'
import { createBoosterPageRuntime } from './page-runtime'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
function fixture(
  state = new ConversationStateStore({} as globalThis.Window, new ArchiveSourceGate(true)),
) {
  state.ingestAccount({ accountId: 'owner-A', observedAt: 1 })
  const data = {
    account: 'owner-A',
    user: 'user-A',
    server: 'server-chat',
    stream: '',
    pending: '',
    project: null as string | null,
  }
  const tokens = {
    account: Symbol('account'),
    user: Symbol('user'),
    server: Symbol('server'),
    stream: Symbol('stream'),
    pending: Symbol('pending'),
    project: Symbol('project'),
    model: Symbol('model'),
  }
  let submits = 0,
    stops = 0,
    next = 0
  const observed = (messageId: string, runId = `observed-${messageId}`) =>
    state.ingestRequest({
      conversationId: 'server-chat',
      requestId: runId,
      accountId: 'owner-A',
      userMessageId: messageId,
      startedAt: Date.now(),
      observedAt: Date.now(),
      source: 'transport_request',
    })
  const modules: ChatGptNativeCachedExports = {
    Mr: { j: tokens.server, Z: tokens.stream, N: tokens.project },
    Ow: { s: tokens.model },
    g2: { n: tokens.account },
    Cs: { i: tokens.user },
    teM: {
      d: () => ({
        message: { id: `native-message-${++next}`, author: { role: 'user' } },
        extraDeveloperInstructionMessages: [],
      }),
      async submitChatGPTCompletion(_scope, input) {
        submits++
        expect(input.conversationId).toBe('native-chat')
        expect(input.model).toBe('native-model')
        expect(input.expectedIdentity).toEqual({ accountId: 'owner-A', userId: 'user-A' })
        expect(input.isSubmissionCurrent()).toBe(true)
        data.stream = `native-stream-${submits}`
        data.pending = input.userCompletionMessages.message.id
        observed(data.pending)
        return {
          conversationId: 'native-chat',
          serverConversationId: 'server-chat',
          streamRequestId: data.stream,
        }
      },
      async f(_scope, nativeId, _error, options) {
        stops++
        expect(nativeId).toBe('native-chat')
        expect(options.expectedStreamRequestId).toBe(data.stream)
        const runId = state.lifecycle('server-chat')?.requestId ?? undefined
        state.ingestStop({
          conversationId: 'server-chat',
          requestId: runId,
          phase: 'requested',
          timestamp: Date.now(),
          status: null,
        })
        state.ingestStop({
          conversationId: 'server-chat',
          requestId: runId,
          phase: 'confirmed',
          timestamp: Date.now(),
          status: 200,
        })
        options.onStopped()
      },
    },
  }
  const options: ChatGptNativeBindingOptions = {
    contractVersion: CHATGPT_NATIVE_BINDING_CONTRACT,
    modules,
    target: { conversationId: 'server-chat', nativeConversationId: 'native-chat' },
    scope: {
      get(token) {
        if (token === tokens.account) return data.account
        if (token === tokens.user) return data.user
        if (token === tokens.server) return data.server
        if (token === tokens.stream) return data.stream
        if (token === tokens.pending) return { promptMessageId: data.pending }
        if (token === tokens.project) return data.project
        if (token === tokens.model) return { slug: 'native-model', thinkingEffort: 'native-effort' }
        throw Error('Unexpected native token')
      },
    },
  }
  return { state, options, modules, data, tokens, observed, submits: () => submits, stops: () => stops }
}

test('native adapter uses native message construction and exactly correlates send then guarded native stop', async () => {
  const f = fixture(),
    binding = createChatGptNativeApplicationBinding(f.state, f.options)
  const port = createChatGptNativeCommandPort(f.state, binding, 100)
  expect(await port.send('synthetic', { conversationId: 'server-chat' })).toEqual({
    observed: 'request',
    conversationId: 'server-chat',
    runId: 'observed-native-message-1',
  })
  expect(await port.stop({ conversationId: 'server-chat' })).toEqual({
    observed: 'stop',
    conversationId: 'server-chat',
    runId: 'observed-native-message-1',
  })
  expect(f.submits()).toBe(1)
  expect(f.stops()).toBe(1)
  expect(binding.preflight({ type: 'new-chat' })).toBeNull()
  expect(binding.preflight({ type: 'continue' })).toBeNull()
})

test('native adapter does not acknowledge another observed message or assign the next request to its command', async () => {
  const f = fixture()
  f.modules.teM.submitChatGPTCompletion = async () => {
    f.data.stream = 'native-stream'
    f.observed('unrelated-user-message', 'unrelated-run')
    return {
      conversationId: 'native-chat',
      serverConversationId: 'server-chat',
      streamRequestId: 'native-stream',
    }
  }
  await expect(
    createChatGptNativeCommandPort(
      f.state,
      createChatGptNativeApplicationBinding(f.state, f.options),
      10,
    ).send('synthetic'),
  ).rejects.toThrow('automation.commandUnconfirmed')
})

test('native send confirmation can await its exact delayed source request and ignores an unrelated request', async () => {
  const f = fixture()
  f.modules.teM.submitChatGPTCompletion = async (_scope, input) => {
    f.data.stream = 'native-stream'
    f.observed('other-message', 'other-run')
    setTimeout(() => f.observed(input.userCompletionMessages.message.id, 'exact-run'), 1)
    return {
      conversationId: 'native-chat',
      serverConversationId: 'server-chat',
      streamRequestId: 'native-stream',
    }
  }
  expect(
    await createChatGptNativeCommandPort(
      f.state,
      createChatGptNativeApplicationBinding(f.state, f.options),
      100,
    ).send('synthetic'),
  ).toMatchObject({ runId: 'exact-run' })
})

test('native identity, project and conversation guards reject changes before dispatch and after native awaits', async () => {
  const f = fixture(),
    binding = createChatGptNativeApplicationBinding(f.state, f.options)
  const port = createChatGptNativeCommandPort(f.state, binding, 100)
  f.data.server = 'another-chat'
  await expect(port.send('synthetic')).rejects.toThrow('automation.conversationChanged')
  expect(f.submits()).toBe(0)
  f.data.server = 'server-chat'
  f.modules.teM.submitChatGPTCompletion = async (_scope, input) => {
    await Promise.resolve()
    f.data.account = 'owner-B'
    expect(() => input.isRequestCurrent()).toThrow('automation.ownerChanged')
    return {
      conversationId: 'native-chat',
      serverConversationId: 'server-chat',
      streamRequestId: 'unconfirmed',
    }
  }
  await expect(port.send('synthetic')).rejects.toThrow('automation.ownerChanged')
})

test('native stop cannot stop a newer native retry that lacks exact observed prompt correlation', async () => {
  const f = fixture()
  f.observed('observed-A', 'observed-run-A')
  f.data.stream = 'newer-native-run-B'
  f.data.pending = 'native-user-B'
  const port = createChatGptNativeCommandPort(
    f.state,
    createChatGptNativeApplicationBinding(f.state, f.options),
    100,
  )
  await expect(port.stop()).rejects.toThrow('automation.stopUnavailable')
  expect(f.stops()).toBe(0)
})

test('native use-case early return and native stream replacement cannot manufacture confirmation', async () => {
  const f = fixture()
  f.modules.teM.submitChatGPTCompletion = async () => null
  const port = createChatGptNativeCommandPort(
    f.state,
    createChatGptNativeApplicationBinding(f.state, f.options),
    100,
  )
  await expect(port.send('synthetic')).rejects.toThrow('automation.commandUnconfirmed')
  f.modules.teM.submitChatGPTCompletion = async (_scope, input) => {
    f.data.stream = 'native-stream'
    f.data.pending = input.userCompletionMessages.message.id
    f.observed(f.data.pending)
    return {
      conversationId: 'native-chat',
      serverConversationId: 'server-chat',
      streamRequestId: f.data.stream,
    }
  }
  await port.send('synthetic')
  f.modules.teM.f = async () => undefined
  await expect(port.stop()).rejects.toThrow('automation.commandUnconfirmed')
})

test('native stop rejects a same-prompt retry and any run not established by this binding', async () => {
  const f = fixture(),
    port = createChatGptNativeCommandPort(
      f.state,
      createChatGptNativeApplicationBinding(f.state, f.options),
      100,
    )
  f.observed('same-prompt', 'observed-A')
  f.data.pending = 'same-prompt'
  f.data.stream = 'native-B'
  await expect(port.stop()).rejects.toThrow('automation.stopUnavailable')
  expect(f.stops()).toBe(0)
  await port.send('synthetic')
  // Native retry starts before its network request reaches our observer. Both native attempts
  // reuse the same user message; only the exact acknowledged stream may be stopped.
  f.data.stream = 'native-retry-B'
  await expect(port.stop()).rejects.toThrow('automation.stopUnavailable')
  expect(f.stops()).toBe(0)
})

test('binding registration replacement aborts pending commands and old cleanup cannot revoke a newer binding', async () => {
  const f = fixture(),
    registry = createChatGptNativeMethodRegistry()
  f.modules.teM.submitChatGPTCompletion = async () => {
    f.data.stream = 'native-stream'
    return {
      conversationId: 'native-chat',
      serverConversationId: 'server-chat',
      streamRequestId: 'native-stream',
    }
  }
  const revokeOld = registry.register(createChatGptNativeApplicationBinding(f.state, f.options))
  const port = createChatGptNativeCommandPort(f.state, registry.adapter, 100)
  const pending = port.send('synthetic')
  await Promise.resolve()
  const revokeNew = registry.register({
    preflight: () => ({ source: 'native-method', conversationId: 'server-chat' }),
    async invoke(_action, { operationId }) {
      f.observed('new-message', 'new-run')
      return { operationId, source: 'native-method', conversationId: 'server-chat', runId: 'new-run' }
    },
  })
  await expect(pending).rejects.toThrow('automation.commandCancelled')
  revokeOld()
  expect(await port.send('synthetic')).toMatchObject({ runId: 'new-run' })
  revokeNew()
  await expect(port.send('synthetic')).rejects.toThrow('automation.nativeMethodUnavailable')
})

test('actual page runtime late binding drives its existing automation port through source bridge events', async () => {
  const dom = new Window({ url: 'https://chatgpt.com/c/server-chat' })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    CustomEvent: globalThis.CustomEvent,
    MutationObserver: globalThis.MutationObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  }
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    location: dom.location,
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  let saved = normalizeSettings({ enabled: true, features: { requestTimer: false } as never })
  const settings: SettingsAdapter = {
    get: async () => saved,
    set: async (value) => {
      saved = value
      return value
    },
    update: async () => saved,
    subscribe: () => () => undefined,
  }
  const page = createBoosterPageRuntime({
    mountUi: false,
    externalSounds: true,
    target: {
      label: 'Tampermonkey',
      settings,
      diagnostics: { recordTransportBatch() {} } as never,
      pageBridgeWindow: dom as unknown as globalThis.Window,
      nativeMethods: {
        preflight: () => ({ source: 'native-method', conversationId: 'server-chat' }),
        async invoke(_action, { operationId }) {
          packet(CONVERSATION_REQUEST_EVENT, {
            accountId: 'owner-A',
            conversationId: 'server-chat',
            requestId: 'configured-run',
            userMessageId: 'configured-message',
            startedAt: Date.now(),
            observedAt: Date.now(),
            source: 'transport_request',
          })
          return {
            operationId,
            source: 'native-method',
            conversationId: 'server-chat',
            runId: 'configured-run',
          }
        },
      },
    },
  })
  cleanup.push(async () => {
    await page.automation.stop()
    await page.fixedArchive.stop()
    await page.runtime.stop()
  })
  await page.startEarly()
  const packet = (type: string, detail: unknown) =>
    dom.dispatchEvent(
      new dom.MessageEvent('message', {
        source: dom as never,
        origin: dom.location.origin,
        data: { channel: TRANSPORT_CHANNEL, type, detail },
      }),
    )
  packet(CONVERSATION_ACCOUNT_EVENT, { accountId: 'owner-A', observedAt: 1 })
  expect(page.automation.status().verifiedOwner).toBe(true)
  const f = fixture()
  let nativeCalls = 0
  f.modules.teM.submitChatGPTCompletion = async (_scope, input) => {
    nativeCalls++
    f.data.stream = 'native-runtime-stream'
    f.data.pending = input.userCompletionMessages.message.id
    packet(CONVERSATION_REQUEST_EVENT, {
      accountId: 'owner-A',
      conversationId: 'server-chat',
      requestId: 'actual-runtime-observed-run',
      userMessageId: input.userCompletionMessages.message.id,
      startedAt: Date.now(),
      observedAt: Date.now(),
      source: 'transport_request',
    })
    return {
      conversationId: 'native-chat',
      serverConversationId: 'server-chat',
      streamRequestId: f.data.stream,
    }
  }
  f.modules.teM.f = async (_scope, _id, _error, options) => {
    nativeCalls++
    packet(CONVERSATION_STOP_EVENT, {
      conversationId: 'server-chat',
      requestId: 'actual-runtime-observed-run',
      phase: 'requested',
      timestamp: Date.now(),
      status: null,
    })
    packet(CONVERSATION_STOP_EVENT, {
      conversationId: 'server-chat',
      requestId: 'actual-runtime-observed-run',
      phase: 'confirmed',
      timestamp: Date.now(),
      status: 200,
    })
    options.onStopped()
  }
  const revoke = page.bindNativeApplication(f.options)
  cleanup.push(revoke)
  expect(
    await page.automation.dispatch('send-message', { text: 'synthetic-runtime-marker' }),
  ).toMatchObject({ status: 'executed' })
  expect(await page.automation.dispatch('stop', {})).toMatchObject({ status: 'executed' })
  expect(nativeCalls).toBe(2)
  await page.runtime.start()
  await page.runtime.stop()
  await page.runtime.start()
  packet(CONVERSATION_ACCOUNT_EVENT, { accountId: 'owner-A', observedAt: Date.now() })
  expect(await page.automation.dispatch('send-message', { text: 'configured-restart' })).toMatchObject({
    status: 'executed',
  })
  expect(nativeCalls).toBe(2)
})
