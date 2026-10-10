import type { ConversationSubmissionSelection } from '@chatgpt-booster/observer'

export type Source = Record<string, unknown>
export type OwnerType = 'project' | 'conversation' | 'message' | 'account'
export type MetadataKind =
  | 'history-page'
  | 'message-snapshot'
  | 'message-revision-evidence'
  | 'submission-selection'
  | 'write-generation'

export interface ArchiveV4Project {
  key: string
  projectId: string
  accountId: string
  title: string | null
  firstSeenAt: number
  lastSeenAt: number
}

export interface ArchiveV4Conversation {
  key: string
  conversationId: string
  accountId: string
  projectId: string | null
  title: string | null
  currentNodeId: string | null
  /** Newest native initial read allowed to update title/project/selected head. */
  headReadId?: string | null
  headReadStartedAt?: number | null
  catalogReadStartedAt?: number | null
  /** Changes on recreation, so deleting and recollecting cannot alias revision 1. */
  instanceId?: string
  latestReadId?: string | null
  latestReadStartedAt?: number | null
  latestReadConflicted?: boolean
  knownMessageCount: number
  // Native create_time may be null. These messages remain stored but have no proven chronology.
  unsequencedMessageCount: number
  firstKnownMessageId: string | null
  lastKnownMessageId: string | null
  firstKnownTime: number | null
  lastKnownTime: number | null
  // Source pagination proof does not prove selected branch ancestry.
  verifiedPathRootId: string | null
  verifiedPathTipId: string | null
  /** The exact native history read and revision that established these boundaries. */
  verifiedPathReadId?: string | null
  verifiedPathRevision?: number | null
  coverage: 'unverified'
  revision: number
  firstSeenAt: number
  lastSeenAt: number
}

export interface ArchiveV4Message {
  key: string
  conversationKey: string
  messageId: string
  parentId: string | null
  // Absent parent_id is not proof that this node is a root.
  parentKnown: boolean
  sourceCreateTime: number | null
  firstSeenAt: number
  lastSeenAt: number
  revision: number
  /** Snapshot provenance prevents a late older read overwriting fresher raw. */
  sourceReadId?: string | null
  sourceReadStartedAt?: number | null
  sourceFingerprint?: string
  // Entire original ChatGPT message. No Booster keys inserted or removed.
  raw: Source
}

export interface ArchiveV4Metadata {
  key: string
  ownerType: OwnerType
  ownerKey: string
  kind: MetadataKind
  observedAt: number
  payload: Source
}

/** Previous stored source version; no claim about when or who edited it. */
export interface ArchiveV4SourceRevisionEvidence {
  previousRevision: number
  previousLastSeenAtMs: number
  sourceReadId: string | null
  sourceReadStartedAtMs: number | null
}

export interface ArchiveV4SourceRevisionWindow {
  previous: ArchiveV4SourceRevisionEvidence[]
  /** Older revisions have been omitted to bound the exported evidence. */
  olderRevisionsOmitted: boolean
}

export type ArchiveV4SubmissionEvidence =
  | { status: 'unobserved' | 'conflicted'; selection: null }
  | { status: 'observed'; selection: ConversationSubmissionSelection }

export type ArchiveV4Change =
  | { kind: 'conversation'; accountId: string; conversationId: string; revision: number }
  | { kind: 'project'; accountId: string; projectId: string }
  | { kind: 'cleared'; accountId: string }

export interface ArchiveV4WriteTicket {
  readonly accountId: string
  readonly generation: string | null
  readonly localEpoch: number
  readonly requestedAt: number
}
export interface ArchiveV4WriteOptions {
  ticket?: ArchiveV4WriteTicket
  signal?: AbortSignal
}

export interface ArchiveV4IngestResult {
  mutated: boolean
  conversationKey: string
  inserted: number
  changed: number
  unchanged: number
  totalMessages: number
  revision: number
}

/** A chronological preview is not proof of a complete message lineage. */
export interface ArchiveV4Preview {
  conversation: ArchiveV4Conversation | undefined
  earliest: ArchiveV4Message[]
  latest: ArchiveV4Message[]
  hiddenKnownCount: number
  hasUnsequencedMessages: boolean
}

export type ArchiveV4PathStatus =
  | 'verified'
  | 'conversation_missing'
  | 'head_mismatch'
  | 'pagination_incomplete'
  | 'capture_omissions'
  | 'tip_missing'
  | 'parent_unknown'
  | 'missing_parent'
  | 'cyclic_parent'
  | 'depth_limit'
  | 'source_changed'

export interface ArchiveV4PathResult {
  status: ArchiveV4PathStatus
  /** Ordered root -> selected tip for the confirmed subset only. */
  messages: ArchiveV4Message[]
  rootId: string | null
  selectedTipId: string
  // Raw provenance is never inferred from chronological adjacency.
  coverageReadId: string | null
  /** Conversation revision captured before tracing this native path. */
  conversationRevision: number | null
  conversationInstanceId?: string | null
}

/** Verified root-to-tip IDs without retaining every source-native raw message. */
export type ArchiveV4PathIndex = Omit<ArchiveV4PathResult, 'messages'> & {
  messageIds: string[]
}
