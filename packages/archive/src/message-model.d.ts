/** One application message contract. Provider-native originals remain separate
 * immutable source snapshots; this DTO stores references, never a raw copy. */
export declare const ARCHIVE_MESSAGE_MODEL_VERSION: 1
export interface ArchiveMessageIdentity {
  readonly providerId: string
  readonly ownerId: string
  readonly conversationId: string
  readonly messageId: string
}
export interface ArchiveMessageElementV1 {
  readonly id: string
  readonly parentId: string | null
  readonly order: number
  readonly kind:
    | 'container'
    | 'text'
    | 'code'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'attachment'
    | 'opaque'
  readonly visibility: 'visible' | 'internal' | 'unknown'
  readonly text: string | null
  readonly language: string | null
  readonly sourcePath: string
}
export interface ArchiveMessageV1 {
  readonly schema: 'koba.message'
  readonly modelVersion: typeof ARCHIVE_MESSAGE_MODEL_VERSION
  readonly key: string
  readonly identity: ArchiveMessageIdentity
  readonly author: {
    readonly id: string | null
    readonly role: string | null
    readonly name: string | null
  }
  readonly time: {
    readonly createdAtMs: number | null
    readonly updatedAtMs: number | null
    readonly observedAtMs: number
  }
  readonly links: {
    readonly parentId: string | null
    readonly parentObserved: boolean
    readonly replyToId: string | null
    readonly threadId: string | null
  }
  readonly context: {
    readonly channel: string | null
    readonly recipient: string | null
    readonly status: string | null
    readonly endTurn: boolean | null
    readonly projectId: string | null
    readonly requestId: string | null
    readonly turnExchangeId: string | null
    readonly workingTurnId: string | null
    readonly requestedModel: string | null
    readonly resolvedModel: string | null
    readonly direction: 'incoming' | 'outgoing' | null
  }
  readonly content: {
    readonly coverage: 'typed' | 'contains-opaque'
    readonly elements: readonly ArchiveMessageElementV1[]
  }
  /** Per-message source evidence, not proof of whole-conversation completeness. */
  readonly evidence: {
    readonly terminal: 'observed' | 'unknown'
  }
  readonly source: {
    readonly snapshotKey: string
    readonly kind: string
    readonly version: string
    readonly variantIndex: number | null
  }
}
export interface ArchiveMessageSourceContext {
  readonly ownerId: string
  readonly conversationId: string
  readonly sourceKind: string
  readonly sourceVersion: string
  readonly observedAtMs: number
  readonly projectId?: string | null
  readonly variantIndex?: number | null
}
export declare function archiveMessageKey(identity: ArchiveMessageIdentity): string
/** Strict model/version/identity validation before a stored or remote DTO is used. */
export declare function validateArchiveMessage(
  input: unknown,
  expected?: ArchiveMessageIdentity,
): ArchiveMessageV1
/** Unknown fields/types remain in the companion source, rather than guessed text. */
export declare function archiveMessageText(message: ArchiveMessageV1): string
/** Stored optional envelopes are checked against the immutable source. Missing
 * legacy metadata is adapted in memory; disagreement is never silently trusted. */
export declare function resolveArchiveMessage(
  stored: unknown,
  derived: ArchiveMessageV1,
): ArchiveMessageV1
