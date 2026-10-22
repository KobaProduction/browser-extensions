import type { CanonicalMessageProjection } from '@chatgpt-booster/core'
import {
  type ArchiveConversationIntegrity,
  conversationIntegrityFromGraph,
} from '@kobaproduction/browser-archive'
import {
  checkpointHistoryCoverage,
  type HistoryCoverageCheckpoint,
  type HistoryPageEvidence,
  historyCoverage,
} from './archive-coverage'

export type ConversationIntegrity = ArchiveConversationIntegrity
export function conversationIntegrity(
  messages: readonly Pick<
    CanonicalMessageProjection,
    'messageId' | 'parentMessageId' | 'parentObserved'
  >[],
  pages: readonly HistoryPageEvidence[],
  headId: string | null,
  terminalHeadId: string | null = null,
  pageHeadId: string | null = null,
  checkpoint?: HistoryCoverageCheckpoint,
  firstMessageId?: string,
): ConversationIntegrity {
  const evidence = checkpoint ? checkpointHistoryCoverage(checkpoint) : historyCoverage([...pages])
  return conversationIntegrityFromGraph(
    messages.map((message) => ({
      id: message.messageId,
      parentId: message.parentMessageId,
      parentKnown: message.parentObserved,
    })),
    {
      startReached: evidence.startReached,
      firstId: firstMessageId,
      rootId: evidence.startReached ? evidence.oldestCursor : null,
      headId,
      endReached: Boolean(
        headId && ((evidence.endReached && headId === pageHeadId) || terminalHeadId === headId),
      ),
    },
  )
}
