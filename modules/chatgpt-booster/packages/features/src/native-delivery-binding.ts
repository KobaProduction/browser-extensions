import type { ConversationStateStore } from './conversation-state'

export interface NativeDeliveryScope {
  get(token: unknown, key?: string): unknown
  watch(callback: (reader: { get(token: unknown, key?: string): unknown }) => void): () => void
}
/** Cached p0Ph.G/p/o and the actual AppScope, pinned to the inspected client. */
export function bindNativeDeliveryFailure(
  state: ConversationStateStore,
  scope: NativeDeliveryScope,
  tokens: { account: unknown; status: unknown; error: unknown; head: unknown },
  current: () => boolean,
) {
  let active = true
  const reconcile = (id: string, read = scope.get.bind(scope)) => {
    if (!active || !current()) return
    const accountId = state.verifiedAccountId(),
      epoch = state.accountEpoch()
    if (!accountId || read(tokens.account) !== accountId || read(tokens.status, id) !== 'error') return
    const error = read(tokens.error, id) as {
      metadata?: { errorCode?: unknown; messageId?: unknown }
    } | null
    const head = read(tokens.head, id)
    if (
      error?.metadata?.errorCode !== 'recovery_unconfirmed' ||
      typeof head !== 'string' ||
      error.metadata.messageId !== head
    )
      return
    state.ingestNativeDeliveryFailure({
      accountId,
      epoch,
      conversationId: id,
      expectedRequestId: state.lifecycle(id)?.requestId ?? null,
      headId: head,
      observedAt: Date.now(),
      errorCode: 'recovery_unconfirmed',
    })
  }
  let releaseWatch: (() => void) | undefined
  let signature = ''
  const observe = () => {
    const ids = state
      .listSnapshots()
      .map((snapshot) => snapshot.conversationId)
      .sort()
    const next = JSON.stringify([state.accountEpoch(), ids])
    if (next === signature) return
    releaseWatch?.()
    signature = next
    releaseWatch = scope.watch(({ get }) => {
      for (const id of ids) reconcile(id, get)
    })
  }
  const unsubscribe = state.subscribe((change) => {
    if (change.reason === 'page' || change.reason === 'request') {
      observe()
      reconcile(change.conversationId)
    }
  })
  try {
    observe()
  } catch (error) {
    active = false
    unsubscribe()
    releaseWatch?.()
    throw error
  }
  return () => {
    active = false
    unsubscribe()
    releaseWatch?.()
  }
}
