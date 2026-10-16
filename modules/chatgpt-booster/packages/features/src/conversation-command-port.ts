import type { ConversationStateStore } from './conversation-state'

export interface ChatGptCommandContext {
  signal?: AbortSignal
  conversationId?: string
  beforeAction?(): void
  correlateRun?(runId: string): void
}
export interface ChatGptNativeCommandPort {
  send(
    text: string,
    context?: ChatGptCommandContext,
  ): Promise<{ observed: 'request'; conversationId: string; runId: string }>
  stop(
    context?: ChatGptCommandContext,
  ): Promise<{ observed: 'stop'; conversationId: string; runId: string }>
  continue(text?: string, context?: ChatGptCommandContext): Promise<unknown>
  newChat(
    options?: { text?: string; projectId?: string },
    context?: ChatGptCommandContext,
  ): Promise<unknown>
}
export type ChatGptNativeAction =
  | { type: 'send-message'; text: string }
  | { type: 'stop' }
  | { type: 'continue'; text?: string }
  | { type: 'new-chat'; text?: string; projectId?: string }
export interface ChatGptNativeMethodReceipt {
  /** The bound method adapter correlates its real native result to this invocation. */
  operationId: string
  source: 'native-method'
  conversationId: string | null
  runId?: string
  /** Only a verified native method result can confirm a new empty conversation. */
  newChat?: boolean
}
export interface ChatGptNativeMethodAdapter {
  /** Synchronous, side-effect-free native state/method verification; null means no verified target. */
  preflight(action: ChatGptNativeAction): ChatGptNativeMethodTarget | null
  /**
   * Address the pinned expected target directly, or reverify it atomically before any effect.
   * An adapter that awaits preparation must reverify after that await. Never silently use a
   * different active conversation. No selectors, renderer state or guessed protocol.
   */
  invoke(
    action: ChatGptNativeAction,
    context: {
      operationId: string
      signal: AbortSignal
      expectedConversationId: string | null
      expectedProjectId: string | null
    },
  ): Promise<ChatGptNativeMethodReceipt>
}
export interface ChatGptNativeMethodTarget {
  source: 'native-method'
  conversationId: string | null
  projectId?: string | null
  /** Registration lifetime, supplied by the composition registry rather than page state. */
  bindingSignal?: AbortSignal
}

/** Late explicit composition registration. Replacing or revoking a binding cancels its work. */
export function createChatGptNativeMethodRegistry() {
  let current: { methods: ChatGptNativeMethodAdapter; controller: AbortController } | undefined
  const adapter: ChatGptNativeMethodAdapter = {
    preflight(action) {
      const registration = current,
        target = registration?.methods.preflight(action)
      return target && registration ? { ...target, bindingSignal: registration.controller.signal } : null
    },
    async invoke(action, context) {
      const registration = current
      if (!registration) throw Error('automation.nativeMethodUnavailable')
      const signal = AbortSignal.any([context.signal, registration.controller.signal])
      const result = await registration.methods.invoke(action, {
        ...context,
        signal,
      })
      if (signal.aborted || current !== registration) throw Error('automation.commandCancelled')
      return result
    },
  }
  const clear = () => {
    current?.controller.abort()
    current = undefined
  }
  return {
    adapter,
    hasBinding: () => current !== undefined,
    register(methods: ChatGptNativeMethodAdapter) {
      clear()
      const registration = { methods, controller: new AbortController() }
      current = registration
      return () => {
        if (current === registration) clear()
      }
    },
    clear,
  }
}

/**
 * Decorate an explicitly supplied native method. Receiver, exact result/promise and thrown error
 * remain native. Cleanup restores only our own wrapper, so other installations can coexist.
 */
export function decorateChatGptNativeMethod<T extends object, K extends keyof T>(
  receiver: T,
  key: K,
  observe: (value: { args: readonly unknown[]; result: unknown; receiver: unknown }) => void,
): () => void {
  const original = receiver[key]
  if (typeof original !== 'function') throw Error('automation.nativeMethodUnavailable')
  const originalDescriptor = Object.getOwnPropertyDescriptor(receiver, key)
  if (originalDescriptor && !Object.hasOwn(originalDescriptor, 'value'))
    throw Error('automation.nativeMethodUnavailable')
  let active = true
  const publish = (args: readonly unknown[], result: unknown, boundReceiver: unknown) => {
    if (!active) return
    try {
      observe({ args, result, receiver: boundReceiver })
    } catch {
      /* Native code is isolated. */
    }
  }
  const wrapper = function (this: unknown, ...args: unknown[]) {
    const result: unknown = Reflect.apply(original, this, args)
    try {
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof (result as { then?: unknown }).then === 'function'
      ) {
        void Promise.resolve(result).then(
          (value) => publish(args, value, this),
          () => undefined,
        )
      } else publish(args, result, this)
    } catch {
      /* A hostile then accessor must not change the native return. */
    }
    return result
  }
  if (!Reflect.set(receiver, key, wrapper)) throw Error('automation.nativeMethodUnavailable')
  return () => {
    active = false
    if (receiver[key] === wrapper) {
      if (originalDescriptor) Object.defineProperty(receiver, key, originalDescriptor)
      else Reflect.deleteProperty(receiver, key)
    }
  }
}

/** Commands fail closed until composition supplies a verified native application binding. */
export function createChatGptNativeCommandPort(
  state: ConversationStateStore,
  methods?: ChatGptNativeMethodAdapter,
  confirmationTimeoutMs = 30_000,
): ChatGptNativeCommandPort {
  const execute = async (action: ChatGptNativeAction, context: ChatGptCommandContext = {}) => {
    if (!methods || typeof methods.preflight !== 'function')
      throw Error('automation.nativeMethodUnavailable')
    const owner = state.verifiedAccountId(),
      epoch = state.accountEpoch()
    if (!owner || context.signal?.aborted) throw Error('automation.commandUnavailable')
    // Resolve and pin a target from actual native state, never from the visible route.
    // A receipt is too late to authorize an already side-effectful call.
    const target = methods.preflight(action)
    if (target?.source !== 'native-method') throw Error('automation.nativeMethodUnavailable')
    const expectedConversationId =
      action.type === 'new-chat' ? null : (context.conversationId ?? target.conversationId)
    const expectedProjectId =
      action.type === 'new-chat' ? (action.projectId ?? null) : (target.projectId ?? null)
    const assertTarget = (current: ChatGptNativeMethodTarget | null) => {
      if (current?.source !== 'native-method') throw Error('automation.nativeMethodUnavailable')
      if (target.bindingSignal?.aborted || current.bindingSignal !== target.bindingSignal)
        throw Error('automation.commandCancelled')
      if (
        current.conversationId !== expectedConversationId ||
        (current.projectId ?? null) !== expectedProjectId
      )
        throw Error('automation.conversationChanged')
      if ((action.type === 'stop' || action.type === 'continue') && !expectedConversationId)
        throw Error('automation.nativeMethodUnavailable')
    }
    assertTarget(target)
    if (
      action.type === 'stop' &&
      expectedConversationId &&
      !['in_progress', 'stop_requested'].includes(state.lifecycle(expectedConversationId)?.state ?? '')
    )
      throw Error('automation.stopUnavailable')
    const controller = new AbortController(),
      operationId = crypto.randomUUID()
    const assertOwner = () => {
      if (controller.signal.aborted || context.signal?.aborted)
        throw Error('automation.commandCancelled')
      if (state.verifiedAccountId() !== owner || state.accountEpoch() !== epoch)
        throw Error('automation.ownerChanged')
    }
    let notify = () => undefined
    let ownerError: unknown
    const unsubscribeAccount = state.subscribeAccount(() => {
      ownerError = Error('automation.ownerChanged')
      controller.abort()
      notify()
    })
    const aborted = () => {
      controller.abort()
      notify()
    }
    context.signal?.addEventListener('abort', aborted, { once: true })
    target.bindingSignal?.addEventListener('abort', aborted, { once: true })
    let receipt: ChatGptNativeMethodReceipt | undefined
    let nativeError: unknown
    let correlated = false
    const previousRuns = new Map(
      state.listSnapshots().map((snapshot) => [snapshot.conversationId, snapshot.lifecycle]),
    )
    const deadline = setTimeout(() => {
      nativeError = Error('automation.commandUnconfirmed')
      notify()
    }, confirmationTimeoutMs)
    const unsubscribe = state.subscribe(() => notify())
    try {
      // Subscribe before invocation; a synchronous native fetch must not race confirmation.
      const confirmed = new Promise<unknown>((resolve, reject) => {
        let settled = false
        notify = () => {
          if (settled) return
          try {
            if (ownerError) throw ownerError
            if (nativeError) throw nativeError
            assertOwner()
            if (!receipt) return
            if (receipt.operationId !== operationId || receipt.source !== 'native-method')
              throw Error('automation.commandUnconfirmed')
            if (
              expectedConversationId &&
              action.type !== 'new-chat' &&
              receipt.conversationId !== expectedConversationId
            )
              throw Error('automation.conversationChanged')
            if (action.type === 'new-chat' && !action.text?.trim()) {
              if (receipt.newChat !== true) throw Error('automation.commandUnconfirmed')
              settled = true
              resolve({ observed: 'native-method', conversationId: receipt.conversationId })
              return
            }
            if (!receipt.conversationId || !receipt.runId) throw Error('automation.commandUnconfirmed')
            const lifecycle = state.lifecycle(receipt.conversationId)
            if (!lifecycle || lifecycle.requestId !== receipt.runId) return
            const previous = previousRuns.get(receipt.conversationId)
            if (action.type === 'stop') {
              if (
                previous?.requestId !== receipt.runId ||
                !['in_progress', 'stop_requested'].includes(previous.state)
              )
                throw Error('automation.conversationChanged')
              if (!correlated) {
                context.correlateRun?.(receipt.runId)
                correlated = true
              }
              if (!['stopped', 'cancelled'].includes(lifecycle.state)) return
              settled = true
              resolve({ observed: 'stop', conversationId: receipt.conversationId, runId: receipt.runId })
            } else {
              if (previous?.requestId === receipt.runId) throw Error('automation.commandUnconfirmed')
              if (!correlated) {
                context.correlateRun?.(receipt.runId)
                correlated = true
              }
              settled = true
              resolve({
                observed: 'request',
                conversationId: receipt.conversationId,
                runId: receipt.runId,
              })
            }
          } catch (error) {
            settled = true
            reject(error)
          }
        }
        context.beforeAction?.()
        try {
          assertOwner()
          // beforeAction is external code, so reverify immediately before native invocation.
          assertTarget(methods.preflight(action))
          void methods
            .invoke(
              action,
              Object.freeze({
                operationId,
                signal: controller.signal,
                expectedConversationId,
                expectedProjectId,
              }),
            )
            .then(
              (value) => {
                if (
                  controller.signal.aborted ||
                  context.signal?.aborted ||
                  state.verifiedAccountId() !== owner ||
                  state.accountEpoch() !== epoch
                )
                  return
                receipt = value
                notify()
              },
              (error) => {
                nativeError = error
                notify()
              },
            )
        } catch (error) {
          nativeError = error
          notify()
        }
      })
      return await confirmed
    } finally {
      clearTimeout(deadline)
      controller.abort()
      unsubscribe()
      unsubscribeAccount()
      context.signal?.removeEventListener('abort', aborted)
      target.bindingSignal?.removeEventListener('abort', aborted)
    }
  }
  return {
    send(text, context) {
      if (!text.trim()) return Promise.reject(Error('automation.commandUnavailable'))
      return execute({ type: 'send-message', text }, context) as ReturnType<
        ChatGptNativeCommandPort['send']
      >
    },
    stop(context) {
      return execute({ type: 'stop' }, context) as ReturnType<ChatGptNativeCommandPort['stop']>
    },
    continue(text, context) {
      return execute({ type: 'continue', ...(text ? { text } : {}) }, context)
    },
    newChat(options = {}, context) {
      return execute({ type: 'new-chat', ...options }, context)
    },
  }
}
