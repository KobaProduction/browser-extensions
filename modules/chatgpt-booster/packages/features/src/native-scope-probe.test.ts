import { expect, test } from 'bun:test'
import type { ConversationStateStore } from './conversation-state'
import { NativeHistoryBinding } from './native-history-binding'
import type { NativeModules } from './native-history-reader'
import { probeNativeScope } from './native-scope-probe'

test('scope probe expires, captures once and ignores already queued work after disposal', async () => {
  const token = {},
    candidate = { scope: token, node: { token }, get: () => undefined }
  let captures = 0
  const original = () => ({ current: candidate }),
    react = { useRef: original }
  const dispose = probeNativeScope(
    react,
    token,
    () => {
      captures++
    },
    100,
  )
  react.useRef()
  react.useRef()
  await Promise.resolve()
  expect(captures).toBe(1)
  expect(react.useRef).toBe(original)
  dispose()
  const cancel = probeNativeScope(
    react,
    token,
    () => {
      captures++
    },
    100,
  )
  react.useRef()
  cancel()
  await Promise.resolve()
  expect(captures).toBe(1)
  let expired = false
  probeNativeScope(
    react,
    token,
    () => {
      captures++
    },
    1,
    () => {
      expired = true
    },
  )
  await Bun.sleep(5)
  expect(expired).toBe(true)
  expect(react.useRef).toBe(original)
})

test('binding disposes an uncaptured probe on timeout, abort and stop; restart can capture again', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  try {
    for (const action of ['timeout', 'abort', 'stop']) {
      const appToken = {},
        accountToken = {},
        userToken = {}
      let captured = false,
        reads = 0
      const candidate = {
        scope: appToken,
        node: { token: appToken },
        get: (token: unknown) => (token === accountToken ? 'owner' : 'user'),
      }
      const original = () => ({ current: captured ? candidate : null })
      const modules: NativeModules = {
        react: { useRef: original },
        appToken,
        accountToken,
        userToken,
        history: async () => {
          reads++
        },
      }
      const state = { verifiedAccountId: () => 'owner', accountEpoch: () => 1 } as ConversationStateStore
      const binding = new NativeHistoryBinding(
        state,
        async () => modules,
        action === 'timeout' ? 0 : 200,
      )
      const controller = new AbortController()
      const context = { conversationId: 'synthetic', sourceReadId: 'read', signal: controller.signal }
      binding.start()
      await Promise.resolve()
      expect(modules.react.useRef).not.toBe(original)
      const pending = binding.readOlder(context)
      if (action === 'abort') controller.abort()
      if (action === 'stop') binding.stop()
      await expect(pending).rejects.toThrow()
      expect(modules.react.useRef).toBe(original)
      expect(reads).toBe(0)
      binding.stop()
      captured = true
      binding.start()
      await Promise.resolve()
      modules.react.useRef()
      await Promise.resolve()
      await binding.readOlder({ ...context, signal: new AbortController().signal })
      expect(reads).toBe(1)
      expect(modules.react.useRef).toBe(original)
      binding.stop()
    }
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
