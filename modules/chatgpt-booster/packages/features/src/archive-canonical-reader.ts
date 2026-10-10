import { exportCanonicalKnownRecords } from './archive-canonical-export'
import { archiveCompositeKey as key } from '@kobaproduction/browser-archive'
import { archiveRecordText, buildArchiveThread } from '@chatgpt-booster/chatgpt'
import type { ArchiveRecordView } from '@chatgpt-booster/core'
import type { ArchiveExportPreview, ArchiveThreadWindow, ArchiveWindowCursor } from '@chatgpt-booster/ui'
import { requestResult as request, transactionComplete as finish } from '@kobaproduction/browser-storage'
import { scan } from './archive-canonical-source-reader'
import type { CanonicalSourceSnapshot, CanonicalStoredConversation, CanonicalStoredMessage } from './archive-canonical-model'
import type { ArchiveV4Store } from './archive-v4-store'
import { normalizeConversationMessage } from './conversation-records'

/** Read-only canonical archive application service. Writes, migration locks,
 * account owner consent, generation activation and rollback are kept in the
 * migrator. Every reader operation resolves the generation through its port.
 */
export class ArchiveCanonicalReader {
  constructor(
    private readonly store: ArchiveV4Store,
    private readonly active: (accountId: string) => Promise<string | null>,
  ) {}
  async listConversations(accountId: string): Promise<CanonicalStoredConversation[]> {
    const generation = await this.active(accountId)
    if (!generation) return []
    const db = await this.store.canonicalDatabase()
    const all = await request<CanonicalStoredConversation[]>(
      db
        .transaction('canonicalConversations', 'readonly')
        .objectStore('canonicalConversations')
        .index('byAccount')
        .getAll(accountId),
    )
    return all.filter((entry) => entry.generation === generation)
  }
  async readMessages(accountId: string, conversationId: string): Promise<CanonicalStoredMessage[]> {
    const generation = await this.active(accountId)
    if (!generation) return []
    const db = await this.store.canonicalDatabase()
    const conversationKey = key(generation, key(accountId, conversationId))
    const all = await request<CanonicalStoredMessage[]>(
      db
        .transaction('canonicalMessages', 'readonly')
        .objectStore('canonicalMessages')
        .index('byConversation')
        .getAll(conversationKey),
    )
    return all.sort(
      (a, b) =>
        (a.sourceCreateTime ?? Infinity) - (b.sourceCreateTime ?? Infinity) ||
        a.messageId.localeCompare(b.messageId),
    )
  }
  /** Bounded count scan: do not materialize every saved message and its raw
   * content just to display a Reader status line. */
  async conversationCounts(
    accountId: string,
    conversationId: string,
  ): Promise<{
    total: number
    visible: number
    internal: number
    firstId: string | null
    lastId: string | null
  }> {
    const generation = await this.active(accountId)
    if (!generation) return { total: 0, visible: 0, internal: 0, firstId: null, lastId: null }
    const db = await this.store.canonicalDatabase()
    const id = key(generation, key(accountId, conversationId))
    return new Promise((resolve, reject) => {
      let total = 0,
        visible = 0,
        internal = 0
      let first: { id: string; time: number } | null = null
      let last: { id: string; time: number } | null = null
      const ix = db
        .transaction('canonicalMessages', 'readonly')
        .objectStore('canonicalMessages')
        .index('byConversation')
      const scan = ix.openCursor(IDBKeyRange.only(id))
      scan.onerror = () => reject(scan.error ?? new Error('Canonical count cursor failed'))
      scan.onsuccess = () => {
        const cursor = scan.result
        if (!cursor) {
          resolve({
            total,
            visible,
            internal,
            firstId: first?.id ?? null,
            lastId: last?.id ?? null,
          })
          return
        }
        const row = cursor.value as CanonicalStoredMessage
        if (
          row.generation !== generation ||
          row.accountId !== accountId ||
          row.conversationId !== conversationId
        ) {
          reject(new Error('Canonical account scope mismatch'))
          return
        }
        total++
        const p = row.projection
        const shown =
          p.role === 'user' ||
          (p.role === 'assistant' &&
            (p.channel === null || p.channel === 'final') &&
            (p.recipient === null || p.recipient === 'all') &&
            p.elements[0]?.kind !== 'reasoning')
        if (shown) visible++
        else internal++
        if (shown && row.sourceCreateTime !== null) {
          const time = row.sourceCreateTime
          if (!first || time < first.time || (time === first.time && row.messageId < first.id))
            first = { id: row.messageId, time }
          if (!last || time > last.time || (time === last.time && row.messageId > last.id))
            last = { id: row.messageId, time }
        }
        cursor.continue()
      }
    })
  }

  /** IndexedDB's chronology index excludes null timestamps. Only for such
   * conversations, use a key-scoped cursor and a bounded top-41 selection.
   * This scans O(n) records but never materializes O(n) bodies in JS memory. */
  async #unsequencedWindow(
    db: IDBDatabase,
    conversationKey: string,
    before: ArchiveWindowCursor | null,
    direction: 'older' | 'newer' | 'first',
    signal?: AbortSignal,
  ): Promise<{ rows: CanonicalStoredMessage[]; hasOlder: boolean; hasNewer: boolean }> {
    const compare = (
      a: Pick<CanonicalStoredMessage, 'sourceCreateTime' | 'messageId'>,
      b: Pick<ArchiveWindowCursor, 'sourceCreateTime' | 'messageId'>,
    ) =>
      (a.sourceCreateTime ?? Infinity) - (b.sourceCreateTime ?? Infinity) ||
      a.messageId.localeCompare(b.messageId)
    const backwards = direction === 'older'
    return new Promise((resolve, reject) => {
      const ranked: CanonicalStoredMessage[] = []
      let count = 0
      const cursorRequest = db
        .transaction('canonicalMessages', 'readonly')
        .objectStore('canonicalMessages')
        .index('byConversation')
        .openCursor(IDBKeyRange.only(conversationKey))
      cursorRequest.onerror = () =>
        reject(cursorRequest.error ?? new Error('Canonical cursor failed'))
      cursorRequest.onsuccess = () => {
        if (signal?.aborted) {
          reject(new DOMException('Archive read cancelled', 'AbortError'))
          return
        }
        const cursor = cursorRequest.result
        if (!cursor) {
          const extra = count > 40
          resolve({
            rows: backwards ? ranked.slice(-40) : ranked.slice(0, 40),
            hasOlder: backwards ? extra : direction === 'newer' && !!before,
            hasNewer: backwards ? !!before : extra,
          })
          return
        }
        const row = cursor.value as CanonicalStoredMessage
        const diff = before ? compare(row, before) : 0
        if (!before || (backwards ? diff < 0 : direction === 'first' || diff > 0)) {
          count++
          // Top/bottom 41 only; avoid O(history size) arrays for 100k+ chats.
          const place = ranked.findIndex((candidate) => compare(row, candidate) < 0)
          ranked.splice(place < 0 ? ranked.length : place, 0, row)
          if (ranked.length > 41) {
            if (backwards) ranked.shift()
            else ranked.pop()
          }
        }
        cursor.continue()
      }
    })
  }

  async hasConversation(accountId: string, conversationId: string): Promise<boolean> {
    const generation = await this.active(accountId)
    if (!generation) return false
    const db = await this.store.canonicalDatabase()
    const row = await request<CanonicalStoredConversation | undefined>(
      db
        .transaction('canonicalConversations', 'readonly')
        .objectStore('canonicalConversations')
        .get(key(generation, key(accountId, conversationId))),
    )
    return row?.generation === generation && row.accountId === accountId
  }

  async threadWindow(
    accountId: string,
    conversationId: string,
    before: ArchiveWindowCursor | null = null,
    direction: 'older' | 'newer' | 'first' = 'older',
    signal?: AbortSignal,
    focus?: string,
  ): Promise<ArchiveThreadWindow> {
    if (signal?.aborted) throw new DOMException('Archive read cancelled', 'AbortError')
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Archive migration is not active')
    const db = await this.store.canonicalDatabase()
    const conversationKey = key(generation, key(accountId, conversationId))
    const point = (m: CanonicalStoredMessage) => ({
      sourceCreateTime: m.sourceCreateTime,
      messageId: m.messageId,
    })
    let rows: CanonicalStoredMessage[]
    let hasOlderStored = false
    let hasNewerStored = false
    let knownCount: number
    let unsequenced = false
    if (focus) {
      // Focused navigation must never getAll() an entire large conversation.
      const found = await request<CanonicalStoredMessage | undefined>(
        db
          .transaction('canonicalMessages', 'readonly')
          .objectStore('canonicalMessages')
          .get(key(conversationKey, focus)),
      )
      if (!found || found.generation !== generation || found.accountId !== accountId)
        throw new Error('archive.error.messageMissing')
      const compare = (a: CanonicalStoredMessage, b: CanonicalStoredMessage) =>
        (a.sourceCreateTime ?? Infinity) - (b.sourceCreateTime ?? Infinity) ||
        a.messageId.localeCompare(b.messageId)
      const older: CanonicalStoredMessage[] = []
      const newer: CanonicalStoredMessage[] = []
      let olderCount = 0,
        newerCount = 0
      unsequenced = false
      for await (const entry of scan(
        db,
        'canonicalMessages',
        'byConversation',
        conversationKey,
        16,
      )) {
        if (signal?.aborted) throw new DOMException('Archive read cancelled', 'AbortError')
        const row = entry as unknown as CanonicalStoredMessage
        if (row.sourceCreateTime === null) unsequenced = true
        const order = compare(row, found)
        if (order < 0) {
          olderCount++
          const position = older.findIndex((candidate) => compare(row, candidate) < 0)
          older.splice(position < 0 ? older.length : position, 0, row)
          if (older.length > 20) older.shift()
        } else if (order > 0) {
          newerCount++
          const position = newer.findIndex((candidate) => compare(row, candidate) < 0)
          newer.splice(position < 0 ? newer.length : position, 0, row)
          if (newer.length > 19) newer.pop()
        }
      }
      rows = [...older, found, ...newer]
      knownCount = olderCount + 1 + newerCount
      hasOlderStored = olderCount > older.length
      hasNewerStored = newerCount > newer.length
    } else {
      const tx = db.transaction('canonicalMessages', 'readonly')
      const table = tx.objectStore('canonicalMessages')
      const byConversation = table.index('byConversation')
      const chrono = table.index('byChronology')
      const done = finish(tx)
      const start = [conversationKey]
      const end = [conversationKey, []]
      let range: IDBKeyRange
      if (before?.sourceCreateTime !== null && before?.sourceCreateTime !== undefined) {
        const cursorPoint = [conversationKey, before.sourceCreateTime, before.messageId]
        range =
          direction === 'newer'
            ? IDBKeyRange.bound(cursorPoint, end, true, false)
            : IDBKeyRange.bound(start, cursorPoint, false, true)
      } else range = IDBKeyRange.bound(start, end)
      const backwards = direction !== 'first' && direction !== 'newer'
      const bounded = new Promise<CanonicalStoredMessage[]>((resolve, reject) => {
        const result: CanonicalStoredMessage[] = []
        const cursor = chrono.openCursor(range, backwards ? 'prev' : 'next')
        cursor.onerror = () => reject(cursor.error ?? new Error('Canonical cursor failed'))
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item || result.length >= 41) {
            resolve(result)
            return
          }
          result.push(item.value as CanonicalStoredMessage)
          if (result.length >= 41) resolve(result)
          else item.continue()
        }
      })
      const [total, timedCount, obtained] = await Promise.all([
        request<number>(byConversation.count(conversationKey)),
        request<number>(chrono.count(IDBKeyRange.bound(start, end))),
        bounded,
      ])
      await done
      knownCount = total
      unsequenced = total > timedCount
      const extra = obtained.length > 40
      rows = obtained.slice(0, 40)
      if (backwards) rows.reverse()
      hasOlderStored = backwards ? extra : !!before && direction === 'newer'
      hasNewerStored = backwards ? !!before : extra
      if (unsequenced) {
        // The chronological index excludes records with a null timestamp.
        // Fall back to an all-message cursor, never an unbounded getAll().
        const page = await this.#unsequencedWindow(db, conversationKey, before, direction, signal)
        rows = page.rows
        hasOlderStored = page.hasOlder
        hasNewerStored = page.hasNewer
      }
    }
    if (signal?.aborted) throw new DOMException('Archive read cancelled', 'AbortError')
    if ((await this.active(accountId)) !== generation)
      throw new Error('archive.error.sourceChanged')
    // Read only this bounded window's matching immutable source snapshots.
    // The native record is essential for model/tool/reasoning metadata and raw
    // inspection. Synthesizing a fake native raw loses that information.
    const snapshotsTx = db.transaction('sourceSnapshots', 'readonly')
    const snapshotsDone = finish(snapshotsTx)
    const snapshots = snapshotsTx.objectStore('sourceSnapshots')
    const records: ArchiveRecordView[] = await Promise.all(
      rows.map(async (row) => {
        const preferredSource = row.source ?? 'native'
        const snapshot = await request<CanonicalSourceSnapshot | undefined>(
          snapshots.get(key(row.key, preferredSource, row.sourceFingerprint)),
        )
        if (
          !snapshot ||
          snapshot.generation !== generation ||
          snapshot.fingerprint !== row.sourceFingerprint ||
          snapshot.messageKey !== row.key ||
          snapshot.raw.id !== row.messageId
        )
          throw new Error('archive.error.sourceChanged')
        const record = normalizeConversationMessage(snapshot.raw, conversationId, null, 0)
        if (!record) throw new Error('archive.error.sourceChanged')
        return { ...record, messageKey: row.projection.messageKey }
      }),
    )
    await snapshotsDone
    return {
      thread: buildArchiveThread(records, { unknownTimeLast: true }),
      source: 'saved',
      accountId,
      sourceRevision: null,
      sourceInstanceId: null,
      olderCursor: hasOlderStored && rows[0] ? point(rows[0]) : null,
      newerCursor:
        hasNewerStored && rows.length
          ? point(rows[rows.length - 1] as CanonicalStoredMessage)
          : null,
      hasOlderStored,
      hasNewerStored,
      loadedRecordCount: rows.length,
      totalKnownRecordCount: knownCount,
      hasUnsequencedRecords: unsequenced,
    }
  }

  /** Preview migrated local data independently from today's native adapter. */
  async preview(accountId: string, conversationId: string): Promise<ArchiveExportPreview> {
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Archive migration is not active')
    const db = await this.store.canonicalDatabase()
    const header = await request<CanonicalStoredConversation | undefined>(
      db
        .transaction('canonicalConversations', 'readonly')
        .objectStore('canonicalConversations')
        .get(key(generation, key(accountId, conversationId))),
    )
    if (!header || header.accountId !== accountId) throw new Error('Archive conversation missing')
    const [first, last] = await Promise.all([
      this.threadWindow(accountId, conversationId, null, 'first'),
      this.threadWindow(accountId, conversationId, null, 'older'),
    ])
    const mapWindow = (window: ArchiveThreadWindow) =>
      window.thread.turns
        .flatMap((turn) => [...turn.messages, ...turn.details])
        .map((item) => ({
          messageId: item.record.messageId,
          role: item.record.role,
          text: archiveRecordText(item.record).slice(0, 280),
        }))
    const earliest = mapWindow(first).slice(0, 3)
    const latest = mapWindow(last).slice(-3)
    const seen = new Set([...earliest, ...latest].map((item) => item.messageId))
    return {
      earliest,
      latest,
      hiddenKnownCount: Math.max(0, first.totalKnownRecordCount - seen.size),
      knownCount: first.totalKnownRecordCount,
      hasUnsequencedMessages: first.hasUnsequencedRecords,
      selectedTipId: header.currentNodeId,
      sourcePageContinuity: 'unknown',
      captureCoverage: 'unknown',
      latestHeadMatches: null,
    }
  }

  async exportKnownRecords(
    accountId: string,
    conversationId: string,
    format: 'json' | 'markdown' | 'json-gzip' = 'json',
  ): Promise<Blob> {
    return exportCanonicalKnownRecords(this.store, this.active, accountId, conversationId, format)
  }

}
