import type {
  ChatGptNativeAction,
  ChatGptNativeMethodAdapter,
  ChatGptNativeMethodReceipt,
} from './conversation-command-port'
import type { ConversationStateStore } from './conversation-state'

/** Observed exports in 698524.js: teM, Mr, Ow, g2 and Cs. No site-global discovery. */
export const CHATGPT_NATIVE_BINDING_CONTRACT = 'chatgpt-native-methods-2026-10-15-v1'
export interface ChatGptNativeApplicationScope {
  get(token: unknown, key?: string): unknown
}
export interface ChatGptNativeSubmissionResult {
  conversationId: string
  serverConversationId?: string | null
  streamRequestId: string
}
export interface ChatGptNativeCompletionMessages {
  message: { id: string; author: { role: string }; [key: string]: unknown }
  extraDeveloperInstructionMessages: unknown[]
}
export interface ChatGptNativeCachedExports {
  teM: {
    d(input: { prompt: string }): ChatGptNativeCompletionMessages
    submitChatGPTCompletion(
      scope: ChatGptNativeApplicationScope,
      input: {
        conversationId: string
        prompt: string
        userCompletionMessages: ChatGptNativeCompletionMessages
        model: string
        thinkingEffort?: string | null
        projectId?: string
        expectedIdentity: { accountId: string; userId: string }
        startupSignal: AbortSignal
        isSubmissionCurrent(): boolean
        isRequestCurrent(): boolean
      },
    ): Promise<ChatGptNativeSubmissionResult | null>
    f(
      scope: ChatGptNativeApplicationScope,
      conversationId: string,
      errorText: string,
      options: {
        expectedStreamRequestId: string
        eventSource: 'skip'
        onStopped(): void
      },
    ): Promise<void>
  }
  Mr: { j: unknown; Z: unknown; N: unknown }
  Ow: { s: unknown }
  g2: { n: unknown }
  Cs: { i: unknown }
}
export interface ChatGptNativeBindingOptions {
  /** Caller has inspected these cached native exports for this exact source contract. */
  contractVersion: typeof CHATGPT_NATIVE_BINDING_CONTRACT
  scope: ChatGptNativeApplicationScope
  modules: ChatGptNativeCachedExports
  /** Both identities are explicit evidence from a real native submission, never a URL. */
  target: { conversationId: string; nativeConversationId: string }
}

/**
 * Bind the observed native application use cases for one explicit existing conversation.
 * Native code builds messages, integrity, request DTOs, conduit headers and cancellation.
 * Only an exact native message ID + owner + observed request can acknowledge a send.
 */
export function createChatGptNativeApplicationBinding(
  state: ConversationStateStore,
  options: ChatGptNativeBindingOptions,
): ChatGptNativeMethodAdapter {
  if (options.contractVersion !== CHATGPT_NATIVE_BINDING_CONTRACT)
    throw Error('automation.nativeMethodUnavailable')
  const { scope, modules, target } = options
  if (
    !target.conversationId ||
    !target.nativeConversationId ||
    typeof scope?.get !== 'function' ||
    typeof modules?.teM?.d !== 'function' ||
    typeof modules.teM.submitChatGPTCompletion !== 'function' ||
    typeof modules.teM.f !== 'function'
  )
    throw Error('automation.nativeMethodUnavailable')
  const targetId = target.conversationId,
    nativeId = target.nativeConversationId
  const readIdentity = () => {
    const accountId = scope.get(modules.g2.n),
      userId = scope.get(modules.Cs.i)
    if (typeof accountId !== 'string' || !accountId || typeof userId !== 'string' || !userId)
      throw Error('automation.nativeMethodUnavailable')
    return { accountId, userId }
  }
  const originalIdentity = readIdentity(),
    originalEpoch = state.accountEpoch()
  // Only this binding's completed send establishes an exact native-stream/network-run pair.
  // A prompt ID alone is insufficient: native retries may reuse that same message.
  let sentRun: { streamId: string; requestId: string; messageId: string } | undefined
  const assertCurrent = (signal?: AbortSignal) => {
    if (signal?.aborted) throw Error('automation.commandCancelled')
    const identity = readIdentity()
    if (
      state.accountEpoch() !== originalEpoch ||
      state.verifiedAccountId() !== originalIdentity.accountId ||
      identity.accountId !== originalIdentity.accountId ||
      identity.userId !== originalIdentity.userId
    )
      throw Error('automation.ownerChanged')
    if (scope.get(modules.Mr.j, nativeId) !== targetId) throw Error('automation.conversationChanged')
  }
  assertCurrent()
  const project = () => {
    const value = scope.get(modules.Mr.N, nativeId)
    if (value === undefined || value === null) return null
    if (typeof value !== 'string') throw Error('automation.nativeMethodUnavailable')
    return value
  }
  const supports = (action: ChatGptNativeAction) =>
    action.type === 'send-message' || action.type === 'stop'
  return {
    preflight(action) {
      if (!supports(action)) return null
      assertCurrent()
      return { source: 'native-method', conversationId: targetId, projectId: project() }
    },
    async invoke(action, context): Promise<ChatGptNativeMethodReceipt> {
      if (!supports(action)) throw Error('automation.nativeMethodUnavailable')
      assertCurrent(context.signal)
      const expectedProject = project()
      if (context.expectedConversationId !== targetId || context.expectedProjectId !== expectedProject)
        throw Error('automation.conversationChanged')
      const assertInvocation = () => {
        assertCurrent(context.signal)
        if (project() !== expectedProject) throw Error('automation.conversationChanged')
      }
      if (action.type === 'stop') {
        const lifecycle = state.lifecycle(targetId),
          streamId = scope.get(modules.Mr.Z, nativeId)
        if (
          !lifecycle?.requestId ||
          !sentRun ||
          sentRun.requestId !== lifecycle.requestId ||
          sentRun.streamId !== streamId ||
          sentRun.messageId !== lifecycle.userMessageId ||
          typeof streamId !== 'string' ||
          !streamId ||
          !lifecycle.userMessageId ||
          !['in_progress', 'stop_requested'].includes(lifecycle.state)
        )
          throw Error('automation.stopUnavailable')
        let acknowledged = false
        assertInvocation()
        await Reflect.apply(modules.teM.f, undefined, [
          scope,
          nativeId,
          'Stop unavailable',
          {
            expectedStreamRequestId: streamId,
            eventSource: 'skip',
            onStopped: () => {
              acknowledged = true
            },
          },
        ])
        assertInvocation()
        // The native use case can return early when its expected stream no longer owns the turn.
        if (!acknowledged) throw Error('automation.commandUnconfirmed')
        const current = state.lifecycle(targetId)
        if (current?.requestId !== lifecycle.requestId) throw Error('automation.conversationChanged')
        return {
          operationId: context.operationId,
          source: 'native-method',
          conversationId: targetId,
          runId: lifecycle.requestId,
        }
      }
      if (action.type !== 'send-message' || !action.text.trim())
        throw Error('automation.nativeMethodUnavailable')
      const messages = Reflect.apply(modules.teM.d, undefined, [
        { prompt: action.text },
      ]) as ChatGptNativeCompletionMessages
      if (
        !messages?.message?.id ||
        messages.message.author?.role !== 'user' ||
        !Array.isArray(messages.extraDeveloperInstructionMessages)
      )
        throw Error('automation.nativeMethodUnavailable')
      const messageId = messages.message.id
      const model = scope.get(modules.Ow.s, nativeId) as {
        slug?: unknown
        thinkingEffort?: unknown
      } | null
      if (
        !model ||
        typeof model.slug !== 'string' ||
        !model.slug ||
        (model.thinkingEffort !== undefined &&
          model.thinkingEffort !== null &&
          typeof model.thinkingEffort !== 'string')
      )
        throw Error('automation.nativeMethodUnavailable')
      const previousRun = state.lifecycle(targetId)?.requestId
      sentRun = undefined
      assertInvocation()
      const result = (await Reflect.apply(modules.teM.submitChatGPTCompletion, undefined, [
        scope,
        {
          conversationId: nativeId,
          prompt: action.text,
          userCompletionMessages: messages,
          model: model.slug,
          thinkingEffort: model.thinkingEffort,
          ...(expectedProject ? { projectId: expectedProject } : {}),
          expectedIdentity: originalIdentity,
          startupSignal: context.signal,
          isSubmissionCurrent: () => {
            assertInvocation()
            return true
          },
          isRequestCurrent: () => {
            assertInvocation()
            return true
          },
        },
      ])) as ChatGptNativeSubmissionResult | null
      assertInvocation()
      if (
        !result ||
        result.conversationId !== nativeId ||
        result.serverConversationId !== targetId ||
        typeof result.streamRequestId !== 'string' ||
        !result.streamRequestId ||
        scope.get(modules.Mr.Z, nativeId) !== result.streamRequestId
      )
        throw Error('automation.commandUnconfirmed')
      const read = () => {
        assertInvocation()
        if (scope.get(modules.Mr.Z, nativeId) !== result.streamRequestId)
          throw Error('automation.conversationChanged')
        const lifecycle = state.lifecycle(targetId)
        if (
          lifecycle?.requestId &&
          lifecycle.requestId !== previousRun &&
          lifecycle.userMessageId === messageId
        ) {
          sentRun = { streamId: result.streamRequestId, requestId: lifecycle.requestId, messageId }
          return {
            operationId: context.operationId,
            source: 'native-method' as const,
            conversationId: targetId,
            runId: lifecycle.requestId,
          }
        }
        return undefined
      }
      const immediate = read()
      if (immediate) return immediate
      return await new Promise<ChatGptNativeMethodReceipt>((resolve, reject) => {
        let settled = false
        const finish = (receipt?: ChatGptNativeMethodReceipt, error?: unknown) => {
          if (settled) return
          settled = true
          unsubscribe()
          unsubscribeAccount()
          context.signal.removeEventListener('abort', abort)
          if (error) reject(error)
          else resolve(receipt as ChatGptNativeMethodReceipt)
        }
        const check = () => {
          try {
            const receipt = read()
            if (receipt) finish(receipt)
          } catch (error) {
            finish(undefined, error)
          }
        }
        const abort = () => finish(undefined, Error('automation.commandCancelled'))
        const unsubscribe = state.subscribe(check),
          unsubscribeAccount = state.subscribeAccount(check)
        context.signal.addEventListener('abort', abort, { once: true })
        check()
      })
    },
  }
}
