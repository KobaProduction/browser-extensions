import { decodeNativeFullHistory } from '@chatgpt-booster/observer'
import type { ConversationStateStore } from './conversation-state'
import type { ChatGptNativeHistoryPort } from './history-loader'

export interface NativeHistoryScope {
  scope: unknown
  node: { token: unknown }
  get(token: unknown, key?: string): unknown
}
export interface NativeModules {
  refreshAccount?(
    scope: { get(token: unknown, key?: string): unknown },
    signal: AbortSignal,
    force: boolean,
  ): Promise<unknown>
  delivery?: { status: unknown; error: unknown; head: unknown }
  react: { useRef: (...args: unknown[]) => { current: unknown } }
  appToken: unknown
  accountToken: unknown
  userToken: unknown
  initialHistory?: (
    scope: NativeHistoryScope,
    id: string,
    options: { forceFull: false; signal: AbortSignal },
  ) => Promise<unknown>
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
  modules: Pick<
    NativeModules,
    'accountToken' | 'userToken' | 'history' | 'initialHistory' | 'pagination'
  >,
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
      const id = context.conversationId
      const read = async (request: () => Promise<unknown>, initial: boolean) => {
        const readStartedAt = Date.now()
        const result = await request().catch((error: unknown) => {
          if ((error as { responseStatus?: unknown } | null)?.responseStatus === 429)
            throw Error('archive.error.rateLimited')
          throw error
        })
        guard()
        if (!result || typeof result !== 'object') return false
        const payload = result as Record<string, unknown>
        // The client builds a temporary linear mapping from a paginated response.
        // Its synthetic root and adjusted head cannot certify archive completeness.
        if (payload.pagination != null) return false
        const full = 'mapping' in payload
        if (full) {
          const coverage = state.nativeHistoryCoverage(id)
          if (coverage.fullRead && (coverage.readStartedAt ?? 0) >= readStartedAt) return true
        } else {
          if (!initial || !Array.isArray(payload.messages) || !payload.page_info) return false
          if (state.pages(id).some((page) => (page.readStartedAt ?? page.timestamp) >= readStartedAt))
            return false
        }
        const data = full ? decodeNativeFullHistory(payload, id) : { payload }
        guard()
        state.ingestPage({
          kind: 'conversation-page',
          ...data,
          conversationId: id,
          accountId: owner,
          readId: `native-${crypto.randomUUID()}`,
          readStartedAt,
          timestamp: Date.now(),
          isInitial: true,
          sourceUrl: `https://chatgpt.com/backend-api/${full ? 'conversation' : 'conversations'}/${encodeURIComponent(id)}`,
        })
        return full
      }
      // A late-started observer can miss the initial response that the host
      // already requested. Save the native initial page before requiring a full graph.
      const initial = modules.initialHistory
      if (initial && state.pages(id).length === 0) {
        const alreadyFull = await read(
          () => initial(scope, id, { forceFull: false, signal: context.signal }),
          true,
        )
        if (alreadyFull) return
      }
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
      await read(() => modules.history(scope, id, { forceFull: true, signal: context.signal }), false)
    },
  }
}
