import type { ConversationStateStore } from './conversation-state'
import type { ChatGptNativeHistoryPort } from './history-loader'

export interface NativeHistoryScope {
  scope: unknown
  node: { token: unknown }
  get(token: unknown, key?: string): unknown
}
export interface NativeModules {
  delivery?: { status: unknown; error: unknown; head: unknown }
  react: { useRef: (...args: unknown[]) => { current: unknown } }
  appToken: unknown
  accountToken: unknown
  userToken: unknown
  pagination?: {
    token: unknown
    readPage(scope: NativeHistoryScope, id: string, flush: (callback: () => void) => void): Promise<void>
    flush(callback: () => void): void
  }
  history: (
    scope: NativeHistoryScope,
    id: string,
    options: { forceFull: true; signal: AbortSignal },
  ) => Promise<unknown>
}
export function createNativeHistoryReader(
  state: ConversationStateStore,
  scope: NativeHistoryScope,
  modules: Pick<NativeModules, 'accountToken' | 'userToken' | 'history' | 'pagination'>,
  current: () => boolean,
): ChatGptNativeHistoryPort {
  const owner = state.verifiedAccountId(),
    epoch = state.accountEpoch(),
    user = scope.get(modules.userToken)
  return {
    async readOlder(context) {
      const guard = () => {
        context.signal.throwIfAborted()
        if (
          !current() ||
          !owner ||
          owner !== state.verifiedAccountId() ||
          epoch !== state.accountEpoch()
        )
          throw Error('archive.error.sourceChanged')
        if (
          scope.get(modules.accountToken) !== owner ||
          typeof user !== 'string' ||
          !user ||
          scope.get(modules.userToken) !== user
        )
          throw Error('archive.error.auth')
      }
      guard()
      // The native paginated view can contain historical/source variants absent
      // from the full mapping. Drain its genuine cursor before reading that graph.
      const pagination = modules.pagination
      const seen = new Set<string>()
      if (pagination)
        while (true) {
          guard()
          const page = scope.get(pagination.token, context.conversationId) as
            | { complete?: boolean; cursor?: string | null; isLoading?: boolean; hasError?: boolean }
            | undefined
          if (!page || page.complete || page.cursor === null) break
          if (typeof page.cursor !== 'string' || !page.cursor || page.isLoading || seen.has(page.cursor))
            throw Error('archive.error.noProgress')
          seen.add(page.cursor)
          await pagination.readPage(scope, context.conversationId, pagination.flush)
          guard()
          const next = scope.get(pagination.token, context.conversationId) as typeof page
          if (next?.hasError) throw Error('archive.error.network')
          if (!next || next.cursor === page.cursor) throw Error('archive.error.noProgress')
        }
      await modules.history(scope, context.conversationId, { forceFull: true, signal: context.signal })
      guard()
    },
  }
}
