import type { CanonicalMessageProjection } from '@chatgpt-booster/core'

/** Provider-owned canonical projections and immutable source snapshots. */
export interface CanonicalStoredConversation {
  key: string
  accountId: string
  conversationId: string
  projectId: string | null
  title: string | null
  currentNodeId: string | null
  lastSeenAt: number
  source: 'legacy_v3' | 'legacy_v4'
  verifiedPagination: false
  generation: string
}
export interface CanonicalStoredMessage {
  key: string
  conversationKey: string
  accountId: string
  conversationId: string
  messageId: string
  sourceCreateTime: number | null
  sourceFingerprint: string
  source?: 'legacy_v3' | 'legacy_v4' | 'native'
  generation: string
  projection: CanonicalMessageProjection
}
/** Never write source body into canonical projection rows. */
export interface CanonicalSourceSnapshot {
  key: string
  messageKey: string
  generation: string
  fingerprint: string
  source: 'legacy_v3' | 'legacy_v4' | 'native'
  raw: Record<string, unknown>
}
