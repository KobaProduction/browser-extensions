import { archiveCompositeKey as key } from '@kobaproduction/browser-archive'
import { archiveRecordText } from '@chatgpt-booster/chatgpt'
import { requestResult as request } from '@kobaproduction/browser-storage'
import { createGzipFromBlob } from './archive-package'
import { scan, type Row } from './archive-canonical-source-reader'
import type { CanonicalSourceSnapshot, CanonicalStoredConversation, CanonicalStoredMessage } from './archive-canonical-model'
import type { ArchiveV4Store } from './archive-v4-store'
import { normalizeConversationMessage } from './conversation-records'

/** Separate source export application use case. Only source-native snapshots
 * from a pinned, account-owned canonical generation may be serialized.
 */
export async function exportCanonicalKnownRecords(
    store: ArchiveV4Store,
    active: (accountId: string) => Promise<string | null>,
    accountId: string,
    conversationId: string,
    format: 'json' | 'markdown' | 'json-gzip' = 'json',
  ): Promise<Blob> {
    const generation = await active(accountId)
    if (!generation) throw new Error('Canonical archive has not been activated')
    const db = await store.canonicalDatabase()
    const conversationKey = key(generation, key(accountId, conversationId))
    const header = await request<CanonicalStoredConversation | undefined>(
      db
        .transaction('canonicalConversations', 'readonly')
        .objectStore('canonicalConversations')
        .get(conversationKey),
    )
    if (!header || header.accountId !== accountId || header.generation !== generation)
      throw new Error('Recovered conversation not found in active generation')
    const parts: BlobPart[] = []
    const markdown = format === 'markdown'
    parts.push(
      markdown
        ? `# ${header.title ?? 'Восстановленный архив'}\n\n> Неполная история: пагинация и выбранная ветка не подтверждены.\n\n`
        : JSON.stringify({
            archiveFormat: 'booster-recovery-unverified-v2',
            warning: 'Partial saved history: source pages and selected lineage unverified.',
            conversationId,
            canonicalModelVersion: 1,
            sourceOriginals: null,
          }).replace('"sourceOriginals":null}', '"sourceOriginals":['),
    )
    let buffered = ''
    let included = 0
    const flush = () => {
      if (buffered) parts.push(buffered)
      buffered = ''
    }
    for await (const source of scan(
      db,
      'canonicalMessages',
      'byConversation',
      conversationKey,
      16,
    )) {
      const row = source as unknown as CanonicalStoredMessage
      if (
        row.generation !== generation ||
        row.accountId !== accountId ||
        row.conversationId !== conversationId ||
        !row.messageId
      )
        throw new Error('Canonical source identity mismatch')
      const tx = db.transaction('sourceSnapshots', 'readonly')
      const stored = await request<CanonicalSourceSnapshot[]>(
        tx.objectStore('sourceSnapshots').index('byMessage').getAll(row.key),
      )
      const versions = stored.filter(
        (snap) =>
          snap.generation === generation &&
          snap.messageKey === row.key &&
          snap.raw.id === row.messageId,
      )
      if (!versions.some((snap) => snap.fingerprint === row.sourceFingerprint))
        throw new Error('Canonical source snapshot missing or mismatched')
      if (markdown) {
        const selected = versions.find(
          (snap) =>
            snap.fingerprint === row.sourceFingerprint && snap.source === (row.source ?? 'native'),
        )
        if (!selected) throw new Error('Canonical source snapshot missing')
        const record = normalizeConversationMessage(
          selected.raw,
          conversationId,
          header.projectId,
          0,
        )
        if (!record) throw new Error('Canonical source message malformed')
        const role = record.role ?? record.channel ?? 'unknown'
        buffered += `## ${role}\n\n${archiveRecordText(record)}\n\n`
      } else {
        // Equal fingerprints represent the same source JSON; preserve source
        // provenance labels without writing duplicate raw message bodies.
        const byFingerprint = new Map<
          string,
          { fingerprint: string; sources: string[]; raw: Row }
        >()
        for (const snap of versions) {
          const previous = byFingerprint.get(snap.fingerprint)
          if (previous) {
            if (!previous.sources.includes(snap.source)) previous.sources.push(snap.source)
          } else
            byFingerprint.set(snap.fingerprint, {
              fingerprint: snap.fingerprint,
              sources: [snap.source],
              raw: snap.raw,
            })
        }
        buffered +=
          (included ? ',' : '') +
          JSON.stringify({
            messageId: row.messageId,
            preferredFingerprint: row.sourceFingerprint,
            snapshots: [...byFingerprint.values()],
          })
      }
      included++
      if (buffered.length >= 256 * 1024) flush()
    }
    if (!included) throw new Error('No migrated records in the selected conversation')
    flush()
    if (!markdown) parts.push(']}')
    if ((await active(accountId)) !== generation)
      throw new Error('Archive generation changed during export')
    const blob = new Blob(parts, {
      type: markdown ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
    })
    return format === 'json-gzip' ? createGzipFromBlob(blob) : blob
}
