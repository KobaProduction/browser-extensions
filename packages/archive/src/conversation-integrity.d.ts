/** Provider adapters supply observed relationships and boundary evidence. */
export interface ArchiveGraphNode {
  readonly id: string
  readonly parentId: string | null
  readonly parentKnown: boolean
}
export interface ArchiveIntegrityEvidence {
  readonly startReached: boolean
  readonly endReached: boolean
  readonly headId: string | null
}
export interface ArchiveConversationIntegrity {
  readonly start: 'verified' | 'unknown'
  readonly end: 'verified' | 'unknown' | 'missing'
  readonly chain: 'verified' | 'gaps' | 'unknown'
  readonly firstMessageId?: string | null
  readonly lastMessageId?: string | null
  readonly roots: readonly string[]
  readonly tips: readonly string[]
  readonly branches: readonly {
    parentId: string
    messageIds: readonly string[]
  }[]
  readonly issues: readonly {
    messageId: string
    parentId: string | null
    reason:
      | 'missing-parent'
      | 'cycle'
      | 'unverified-root'
      | 'missing-head'
      | 'disconnected'
      | 'duplicate-id'
  }[]
}
/** No numeric-ID or source-order inference: only explicit parent relationships. */
export declare function conversationIntegrityFromGraph(
  nodes: readonly ArchiveGraphNode[],
  evidence: ArchiveIntegrityEvidence,
): ArchiveConversationIntegrity
export interface LinearArchiveEvidence {
  readonly savedCount: number
  readonly reportedCount: number | null
  readonly firstId: string | null
  readonly lastId: string | null
  readonly startReached: boolean
  readonly endReached: boolean
  readonly countStable: boolean
  readonly current: boolean
}
/** Linear providers need observed source boundaries/counts, never adjacent IDs. */
export declare function linearArchiveIntegrity(
  evidence: LinearArchiveEvidence,
): ArchiveConversationIntegrity
