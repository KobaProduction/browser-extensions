import { decodeNativeFullHistory } from '@chatgpt-booster/observer'
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
export function nativePaginationPending(
  scope: NativeHistoryScope,
  pagination: NativeModules['pagination'],
  conversationId: string,
): boolean | null {
  if (!pagination) return null
  const page = scope.get(pagination.token, conversationId) as
    | { complete?: boolean; cursor?: string | null }
    | undefined
  if (!page) return null
  if (page.complete === true || page.cursor === null) return false
  return true
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
      const readStartedAt = Date.now()
      const result = await modules.history(scope, context.conversationId, {
        forceFull: true,
        signal: context.signal,
      })
      guard()
      // The native client may hold a fetch reference predating our observer.
      // Admit the genuine bound method result through the same strict decoder
      // and owner gate instead of depending on that transport interception.
      if (result && typeof result === 'object' && 'mapping' in result) {
        const coverage = state.nativeHistoryCoverage(context.conversationId)
        if (!coverage.fullRead || (coverage.readStartedAt ?? 0) < readStartedAt) {
          const decoded = decodeNativeFullHistory(
            result as Record<string, unknown>,
            context.conversationId,
          )
          guard()
          state.ingestPage({
            kind: 'conversation-page',
            ...decoded,
            conversationId: context.conversationId,
            accountId: owner,
            readId: `native-${crypto.randomUUID()}`,
            readStartedAt,
            timestamp: Date.now(),
            isInitial: true,
            sourceUrl: `https://chatgpt.com/backend-api/conversation/${context.conversationId}`,
          })
        }
      }
    },
  }
}
