import { archiveCompositeKey as key } from '@kobaproduction/browser-archive'
import { requestResult as request } from '@kobaproduction/browser-storage'
import { type Row, object, existingSource, scanRecent } from './archive-canonical-source-reader'
import type { CanonicalStoredConversation } from './archive-canonical-model'
import { legacyV3OwnerEvidence } from './archive-migration-plan'
import { ARCHIVE_DB_NAME } from './archive-store'
import type { ArchiveV4Store } from './archive-v4-store'

/** Owner-evidence and count-only archive inspection. No staged writes,
 * generation activation, or implicit binding of ownerless legacy rows. */
export type LegacySkipReason = 'missing_owner' | 'owner_mismatch'
export interface LegacySkippedConversation {
  readonly conversationId: string
  readonly title: string | null
  readonly reason: LegacySkipReason
  readonly messages: number
  /** Only IDs are exposed for inspection; no message text or owner identifier. */
  readonly messageIds: readonly string[]
}

export interface ArchiveOwnerSkipInspection {
  readonly examined: number
  readonly skippedMessages: number
  readonly skippedConversations: readonly LegacySkippedConversation[]
  readonly sinceMs: number
}

export interface ArchiveCoverageAudit {
  readonly legacyConversations: number
  readonly canonicalConversations: number
  readonly conversationCountShortfall: number
  readonly conversationsWithMessageShortfall: number
  readonly sourceMessageCount: number
  readonly canonicalMessageCount: number
  /** Count comparisons do not prove message-ID, hash, page or branch identity. */
  readonly kind: 'count_only_read_only'
  readonly missingDetails: readonly {
    conversationId: string
    title: string | null
    v3Count: number
    v4Count: number
    canonicalCount: number
    ownerStatus: 'verified' | 'waiting_for_owner' | 'mismatch' | 'v4_only'
  }[]
}
export class ArchiveCanonicalAudit {
  constructor(
    private readonly store: ArchiveV4Store,
    private readonly active: (accountId: string) => Promise<string | null>,
    private readonly listConversations: (accountId: string) => Promise<CanonicalStoredConversation[]>,
  ) {}

  /** Count-only inventory of the UNION of v3 and account-scoped v4 IDs.
   * No native bodies are loaded and no archive is mutated. Overlapping v3/v4
   * records may share message IDs, so source counts are not additive proofs. */
  async auditCoverage(accountId: string): Promise<ArchiveCoverageAudit> {
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    const v3 = await existingSource(ARCHIVE_DB_NAME)
    const target = await this.store.canonicalDatabase()
    const current = await this.listConversations(accountId)
    const ids = new Map<
      string,
      {
        title: string | null
        v3Count: number
        v4Count: number
        ownerStatus: 'verified' | 'waiting_for_owner' | 'mismatch' | 'v4_only'
      }
    >()
    try {
      if (v3) {
        const headers = await request<Row[]>(
          v3.transaction('conversations', 'readonly').objectStore('conversations').getAll(),
        )
        for (const header of headers) {
          const id = header.conversationId
          if (typeof id !== 'string' || !id) continue
          const evidence = legacyV3OwnerEvidence(header, accountId)
          const count = await request<number>(
            v3
              .transaction('messages', 'readonly')
              .objectStore('messages')
              .index('conversationId')
              .count(id),
          )
          ids.set(id, {
            title: typeof header.title === 'string' ? header.title : null,
            v3Count: count,
            v4Count: 0,
            ownerStatus: evidence.status,
          })
        }
      }
      const v4 = await request<Row[]>(
        target
          .transaction('conversations', 'readonly')
          .objectStore('conversations')
          .index('byAccount')
          .getAll(accountId),
      )
      for (const header of v4) {
        const id = header.conversationId
        if (typeof id !== 'string' || !id) continue
        const count = await request<number>(
          target
            .transaction('messages', 'readonly')
            .objectStore('messages')
            .index('byConversation')
            .count(key(accountId, id)),
        )
        const previous = ids.get(id)
        ids.set(id, {
          title: (typeof header.title === 'string' && header.title) || previous?.title || null,
          v3Count: previous?.v3Count ?? 0,
          v4Count: count,
          ownerStatus: previous?.ownerStatus ?? 'v4_only',
        })
      }
      const canonical = new Set(current.map((row) => row.conversationId))
      let missing = 0,
        less = 0,
        before = 0,
        after = 0
      const missingDetails: ArchiveCoverageAudit['missingDetails'][number][] = []
      for (const [id, old] of ids) {
        const count = await request<number>(
          target
            .transaction('canonicalMessages', 'readonly')
            .objectStore('canonicalMessages')
            .index('byConversation')
            .count(key(generation, key(accountId, id))),
        )
        const sourceMax = Math.max(old.v3Count, old.v4Count)
        before += old.v3Count + old.v4Count
        after += count
        if (!canonical.has(id)) missing++
        if (count < sourceMax) less++
        if (!canonical.has(id) || count < sourceMax)
          missingDetails.push({
            conversationId: id,
            title: old.title,
            v3Count: old.v3Count,
            v4Count: old.v4Count,
            canonicalCount: count,
            ownerStatus: old.ownerStatus,
          })
      }
      if ((await this.active(accountId)) !== generation)
        throw new Error('Archive generation changed during audit')
      missingDetails.sort(
        (a, b) =>
          Math.max(b.v3Count, b.v4Count) -
            b.canonicalCount -
            (Math.max(a.v3Count, a.v4Count) - a.canonicalCount) ||
          a.conversationId.localeCompare(b.conversationId),
      )
      return {
        kind: 'count_only_read_only',
        legacyConversations: ids.size,
        canonicalConversations: current.length,
        conversationCountShortfall: missing,
        conversationsWithMessageShortfall: less,
        sourceMessageCount: before,
        canonicalMessageCount: after,
        missingDetails,
      }
    } finally {
      v3?.close()
    }
  }

  async inspectSkippedRecent(
    accountId: string,
    sinceMs: number,
    quickAfterLastImport: boolean,
  ): Promise<ArchiveOwnerSkipInspection> {
    const target = await this.store.canonicalDatabase()
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    const manifest = await request<Row | undefined>(
      target
        .transaction('migrationManifest', 'readonly')
        .objectStore('migrationManifest')
        .get(key(accountId)),
    )
    const checkpoint =
      typeof manifest?.lastReconciledAt === 'number' &&
      manifest.lastReconciledSkippedOwnership === 0
        ? manifest.lastReconciledAt
        : typeof manifest?.verifiedAt === 'number'
          ? manifest.verifiedAt
          : null
    const effectiveSince =
      quickAfterLastImport && checkpoint !== null
        ? Math.max(sinceMs, checkpoint - 15 * 60_000)
        : sinceMs
    const active = new Set(
      (await this.listConversations(accountId)).map((row) => row.conversationId),
    )
    const legacy = await existingSource(ARCHIVE_DB_NAME)
    if (!legacy)
      return { examined: 0, skippedMessages: 0, skippedConversations: [], sinceMs: effectiveSince }
    try {
      const headers = await request<Row[]>(
        legacy.transaction('conversations', 'readonly').objectStore('conversations').getAll(),
      )
      const reasons = new Map<string, { header: Row; reason: LegacySkipReason }>()
      for (const header of headers) {
        const id = header.conversationId
        if (typeof id !== 'string' || !id || active.has(id)) continue
        const evidence = legacyV3OwnerEvidence(header, accountId)
        if (evidence.status !== 'verified')
          reasons.set(id, {
            header,
            reason: evidence.status === 'mismatch' ? 'owner_mismatch' : 'missing_owner',
          })
      }
      const groups = new Map<string, LegacySkippedConversation>()
      let examined = 0
      if (reasons.size) {
        for await (const batch of scanRecent(
          legacy,
          'messages',
          'lastSeenAt',
          effectiveSince,
          Date.now(),
        )) {
          examined += batch.length
          for (const row of batch) {
            const id = row.conversationId
            if (typeof id !== 'string') continue
            const target = reasons.get(id)
            if (!target) continue
            const old = groups.get(id)
            const rawId =
              typeof object(row.raw)?.id === 'string' ? (object(row.raw)?.id as string) : null
            const entry: LegacySkippedConversation = {
              conversationId: id,
              title: typeof target.header.title === 'string' ? target.header.title : null,
              reason: target.reason,
              messages: (old?.messages ?? 0) + 1,
              messageIds:
                rawId && (old?.messageIds.length ?? 0) < 10
                  ? [...(old?.messageIds ?? []), rawId]
                  : (old?.messageIds ?? []),
            }
            groups.set(id, entry)
          }
        }
      }
      if ((await this.active(accountId)) !== generation)
        throw new Error('Archive owner changed while inspecting')
      const skippedConversations = [...groups.values()].sort(
        (a, b) => b.messages - a.messages || a.conversationId.localeCompare(b.conversationId),
      )
      return {
        examined,
        sinceMs: effectiveSince,
        skippedMessages: skippedConversations.reduce((sum, row) => sum + row.messages, 0),
        skippedConversations,
      }
    } finally {
      legacy.close()
    }
  }

  /** All-time, read-only owner inventory. Unlike the recent-history scanner,
   * this sees old conversations even when their messages were never modified. */
  async inspectSkippedAll(accountId: string): Promise<ArchiveOwnerSkipInspection> {
    if (!accountId.trim()) throw new Error('Verified account required')
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    const existing = new Set((await this.listConversations(accountId)).map((c) => c.conversationId))
    const legacy = await existingSource(ARCHIVE_DB_NAME)
    if (!legacy) return { examined: 0, skippedMessages: 0, skippedConversations: [], sinceMs: 0 }
    const skippedConversations: LegacySkippedConversation[] = []
    let examined = 0
    try {
      const headers = await request<Row[]>(
        legacy.transaction('conversations', 'readonly').objectStore('conversations').getAll(),
      )
      for (const header of headers) {
        const id = header.conversationId
        if (typeof id !== 'string' || !id || existing.has(id)) continue
        const owner = legacyV3OwnerEvidence(header, accountId)
        if (owner.status === 'verified') continue
        const index = legacy
          .transaction('messages', 'readonly')
          .objectStore('messages')
          .index('conversationId')
        const messages = await request<number>(index.count(id))
        examined += messages
        skippedConversations.push({
          conversationId: id,
          title: typeof header.title === 'string' ? header.title : null,
          reason: owner.status === 'mismatch' ? 'owner_mismatch' : 'missing_owner',
          messages,
          messageIds: [],
        })
      }
      if ((await this.active(accountId)) !== generation)
        throw new Error('Archive generation changed during owner inspection')
      skippedConversations.sort(
        (a, b) => b.messages - a.messages || a.conversationId.localeCompare(b.conversationId),
      )
      return { examined, skippedMessages: examined, skippedConversations, sinceMs: 0 }
    } finally {
      legacy.close()
    }
  }

}
