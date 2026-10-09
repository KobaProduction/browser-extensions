import { buildArchiveThread } from '@chatgpt-booster/chatgpt'
import {
  type ArchiveRecordView,
  type CanonicalMessageProjection,
  projectNativeMessage,
} from '@chatgpt-booster/core'
import type { ArchiveThreadWindow, ArchiveWindowCursor } from '@chatgpt-booster/ui'
import { legacyV3OwnerEvidence } from './archive-migration-plan'
import { ARCHIVE_DB_NAME } from './archive-store'
import type { ArchiveV4Store } from './archive-v4-store'
import { canonicalSourceJson, sourceFingerprint } from './archive-v4-write'

type Row = Record<string, unknown>
const object = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null
const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Archive migration request failed'))
  })
const finish = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Archive migration transaction aborted'))
  })
const key = (...parts: string[]) => JSON.stringify(parts)
export type CanonicalMigrationStatus =
  | 'idle'
  | 'checking'
  | 'transforming'
  | 'validating'
  | 'ready'
  | 'failed_recoverable'
  | 'waiting_for_owner'

export interface CanonicalMigrationProgress {
  status: CanonicalMigrationStatus
  conversations: number
  messages: number
  waitingForOwner: number
  message: string
}
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
  raw: Row
}

/** Read at most 128 records in one readonly transaction before yielding work.
 * Composite cursor identity must include the primary key, because every record
 * in the conversation index has the same index key. */
async function* scan(db: IDBDatabase, table: string, index: string, query: IDBValidKey) {
  let after: IDBValidKey | null = null
  while (true) {
    const tx = db.transaction(table, 'readonly')
    const ix = tx.objectStore(table).index(index)
    const batch = await new Promise<{ rows: Row[]; last: IDBValidKey | null }>(
      (resolve, reject) => {
        const rows: Row[] = []
        let last: IDBValidKey | null = null
        let resumed = false
        const cursorRequest = ix.openCursor(IDBKeyRange.only(query))
        cursorRequest.onerror = () =>
          reject(cursorRequest.error ?? new Error('Legacy cursor failed'))
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) {
            resolve({ rows, last })
            return
          }
          if (after !== null && !resumed) {
            resumed = true
            cursor.continuePrimaryKey(query, after)
            return
          }
          // continuePrimaryKey() is inclusive of its target; the last
          // committed source row must not be counted a second time.
          if (after !== null && indexedDB.cmp(cursor.primaryKey, after) <= 0) {
            cursor.continue()
            return
          }
          const value = object(cursor.value)
          if (!value) {
            reject(new Error('Legacy source row malformed'))
            return
          }
          rows.push(value)
          last = cursor.primaryKey
          if (rows.length >= 128) {
            resolve({ rows, last })
            return
          }
          cursor.continue()
        }
      },
    )
    if (!batch.rows.length) return
    for (const row of batch.rows) yield row
    if (batch.rows.length < 128 || batch.last === null) return
    after = batch.last
  }
}
async function existingSource(name: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB.databases !== 'function') throw new Error('IndexedDB inspection unavailable')
  const known = await indexedDB.databases()
  if (!known.some((x) => x.name === name)) return null
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onupgradeneeded = () => {
      req.transaction?.abort()
      reject(new Error('Legacy source was missing'))
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open legacy source'))
  })
}

/**
 * One-time consented archive conversion. Both old DBs remain untouched.
 * Stage in generation-specific records; expose only the manifest's active generation.
 * An ownerless v3 record requires direct user confirmation for THIS verified account.
 */
export class ArchiveCanonicalMigrator {
  #listeners = new Set<(p: CanonicalMigrationProgress) => void>()
  #progress: CanonicalMigrationProgress = {
    status: 'idle',
    conversations: 0,
    messages: 0,
    waitingForOwner: 0,
    message: '',
  }
  #pending: Promise<void> | null = null
  constructor(private readonly store: ArchiveV4Store) {}
  subscribe(fn: (p: CanonicalMigrationProgress) => void) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }
  snapshot() {
    return { ...this.#progress }
  }
  #set(update: Partial<CanonicalMigrationProgress>) {
    this.#progress = { ...this.#progress, ...update }
    for (const fn of this.#listeners) fn(this.snapshot())
  }
  async active(accountId: string): Promise<string | null> {
    const db = await this.store.canonicalDatabase()
    const row = await request<Row | undefined>(
      db
        .transaction('migrationManifest', 'readonly')
        .objectStore('migrationManifest')
        .get(key(accountId)),
    )
    return row?.status === 'ready' && typeof row.generation === 'string' ? row.generation : null
  }
  async migrate(accountId: string, bindUnowned: boolean): Promise<void> {
    if (!accountId.trim()) throw new Error('Verified account required')
    if (this.#pending) return this.#pending
    this.#pending = this.#run(accountId, bindUnowned).finally(() => {
      this.#pending = null
    })
    return this.#pending
  }
  async #run(accountId: string, bindUnowned: boolean): Promise<void> {
    const lockName = 'chatgpt-booster:canonical-migration-v1'
    if (!navigator.locks?.request) throw new Error('Cross-tab archive lock is unavailable')
    await navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
      this.#set({
        status: 'checking',
        conversations: 0,
        messages: 0,
        waitingForOwner: 0,
        message: '',
      })
      const target = await this.store.canonicalDatabase()
      const sources = [await existingSource(ARCHIVE_DB_NAME), target] as const
      const generation = crypto.randomUUID()
      const manifestKey = key(accountId)
      const previous = await request<Row | undefined>(
        target
          .transaction('migrationManifest', 'readonly')
          .objectStore('migrationManifest')
          .get(manifestKey),
      )
      const fallbackGeneration =
        previous?.status === 'ready' ? previous.generation : previous?.previousGeneration
      try {
        // A durable fence prevents native writers in other tabs from changing
        // the source generation while a staged import is in progress.
        const begin = target.transaction('migrationManifest', 'readwrite')
        const beginDone = finish(begin)
        begin.objectStore('migrationManifest').put({
          key: manifestKey,
          accountId,
          generation,
          status: 'transforming',
          previousGeneration: typeof fallbackGeneration === 'string' ? fallbackGeneration : null,
          storageSchemaVersion: 2,
          canonicalModelVersion: 1,
          startedAt: Date.now(),
        })
        await beginDone
        // Staging records are invisible to active canonical readers.
        this.#set({ status: 'transforming' })
        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
          const db = sources[sourceIndex]
          if (!db) continue
          const source = sourceIndex === 0 ? 'legacy_v3' : 'legacy_v4'
          const conversations = db
            .transaction('conversations', 'readonly')
            .objectStore('conversations')
          // Cursor queue contains only headers, not message bodies.
          const headers = await request<Row[]>(conversations.getAll())
          for (const header of headers) {
            const conversationId = header.conversationId
            if (typeof conversationId !== 'string' || !conversationId) continue
            if (source === 'legacy_v4' && header.accountId !== accountId) continue
            if (source === 'legacy_v3') {
              const binding = legacyV3OwnerEvidence(header, accountId)
              // DEV-only, explicit one-time binding: old v3 owner.user_id may
              // not equal ChatGPT account_id / account_user_id. Never silently
              // attribute either unknown OR mismatched local legacy owners.
              if (binding.status !== 'verified' && !bindUnowned) {
                this.#set({ waitingForOwner: this.#progress.waitingForOwner + 1 })
                continue
              }
            }
            const scoped = key(accountId, conversationId)
            const conversationKey = key(generation, scoped)
            const txHeader = target.transaction('canonicalConversations', 'readwrite')
            const hdrDone = finish(txHeader)
            const headers = txHeader.objectStore('canonicalConversations')
            const previous = await request<CanonicalStoredConversation | undefined>(
              headers.get(conversationKey),
            )
            headers.put({
              key: conversationKey,
              accountId,
              conversationId,
              projectId:
                typeof header.projectId === 'string'
                  ? header.projectId
                  : (previous?.projectId ?? null),
              title:
                typeof header.title === 'string' && header.title.trim()
                  ? header.title
                  : (previous?.title ?? null),
              currentNodeId:
                typeof header.currentNodeId === 'string'
                  ? header.currentNodeId
                  : (previous?.currentNodeId ?? null),
              lastSeenAt: Math.max(
                previous?.lastSeenAt ?? 0,
                typeof header.lastSeenAt === 'number' ? header.lastSeenAt : 0,
              ),
              verifiedPagination: false,
              source,
              generation,
            } satisfies CanonicalStoredConversation)
            await hdrDone
            // Read one conversation's indexed rows. Individual writes are atomic;
            // a failed migration generation never becomes active.
            const ix = source === 'legacy_v3' ? 'conversationId' : 'byConversation'
            const query = source === 'legacy_v3' ? conversationId : scoped
            for await (const row of scan(db, 'messages', ix, query)) {
              const raw = object(row.raw)
              if (!raw || typeof raw.id !== 'string' || !raw.id)
                throw new Error('Legacy source record is malformed')
              const projection = projectNativeMessage(raw, { accountId, conversationId })
              const fingerprint = await sourceFingerprint(canonicalSourceJson(raw))
              const messageKey = key(conversationKey, raw.id)
              const snapKey = key(messageKey, source, fingerprint)
              const tx = target.transaction(
                ['canonicalMessages', 'canonicalElements', 'sourceSnapshots'],
                'readwrite',
              )
              const done = finish(tx)
              const table = tx.objectStore('canonicalMessages')
              const existing = await request<CanonicalStoredMessage | undefined>(
                table.get(messageKey),
              )
              // Prefer newer v4 snapshots where both databases contained the same
              // message, without deleting earlier v3 evidence or faking versions.
              if (!existing || source === 'legacy_v4') {
                table.put({
                  key: messageKey,
                  conversationKey,
                  accountId,
                  conversationId,
                  messageId: raw.id,
                  sourceCreateTime: projection.sourceCreateTime,
                  sourceFingerprint: fingerprint,
                  generation,
                  projection,
                } satisfies CanonicalStoredMessage)
                const els = tx.objectStore('canonicalElements')
                // Generation-specific keys permit staging over earlier active data.
                for (const element of projection.elements)
                  els.put({
                    ...element,
                    elementId: key(generation, element.elementId),
                    messageKey,
                    generation,
                  })
              }
              tx.objectStore('sourceSnapshots').put({
                key: snapKey,
                messageKey,
                generation,
                fingerprint,
                source,
                raw: structuredClone(raw),
              } satisfies CanonicalSourceSnapshot)
              await done
              this.#set({ messages: this.#progress.messages + 1 })
            }
            this.#set({ conversations: this.#progress.conversations + 1 })
          }
        }
        this.#set({ status: 'validating' })
        const tx = target.transaction(
          [
            'canonicalConversations',
            'canonicalMessages',
            'canonicalElements',
            'sourceSnapshots',
            'migrationManifest',
          ],
          'readwrite',
        )
        const done = finish(tx)
        const [conversations, messages, elements, snapshots] = await Promise.all([
          request<number>(
            tx.objectStore('canonicalConversations').index('byGeneration').count(generation),
          ),
          request<number>(
            tx.objectStore('canonicalMessages').index('byGeneration').count(generation),
          ),
          request<number>(
            tx.objectStore('canonicalElements').index('byGeneration').count(generation),
          ),
          request<number>(
            tx.objectStore('sourceSnapshots').index('byGeneration').count(generation),
          ),
        ])
        if (
          !conversations ||
          !messages ||
          conversations > this.#progress.conversations ||
          snapshots !== this.#progress.messages ||
          elements < messages
        ) {
          tx.abort()
          throw new Error('Staged canonical archive verification failed')
        }
        const current = await request<Row | undefined>(
          tx.objectStore('migrationManifest').get(manifestKey),
        )
        if (current?.generation !== generation || current.status !== 'transforming')
          throw new Error('Archive migration generation changed')
        const record = {
          key: key(accountId),
          accountId,
          generation,
          status: 'ready',
          storageSchemaVersion: 2,
          canonicalModelVersion: 1,
          messages,
          conversations,
          sourceSnapshots: snapshots,
          contentElements: elements,
          waitingForOwner: this.#progress.waitingForOwner,
          verifiedAt: Date.now(),
        }
        tx.objectStore('migrationManifest').put(record)
        await done
        this.#set({ status: 'ready' })
      } catch (error) {
        // Preserve a previously verified active generation after failed retry.
        const tx = target.transaction('migrationManifest', 'readwrite')
        const done = finish(tx)
        tx.objectStore('migrationManifest').put(
          typeof fallbackGeneration === 'string'
            ? {
                key: manifestKey,
                accountId,
                generation: fallbackGeneration,
                status: 'ready',
                storageSchemaVersion: 2,
                canonicalModelVersion: 1,
                restoredAt: Date.now(),
              }
            : {
                key: manifestKey,
                accountId,
                generation,
                status: 'failed_recoverable',
                storageSchemaVersion: 2,
                canonicalModelVersion: 1,
                failedAt: Date.now(),
              },
        )
        await done
        this.#set({
          status: 'failed_recoverable',
          message: error instanceof Error ? error.message : 'Migration failed',
        })
        throw error
      } finally {
        sources[0]?.close()
      }
    })
  }

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
      const entries = await this.readMessages(accountId, conversationId)
      const index = entries.findIndex((m) => m.messageId === focus)
      if (index < 0) throw new Error('archive.error.messageMissing')
      const start = Math.max(0, index - 20)
      rows = entries.slice(start, start + 40)
      knownCount = entries.length
      hasOlderStored = start > 0
      hasNewerStored = start + 40 < entries.length
      unsequenced = entries.some((m) => m.sourceCreateTime === null)
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
    }
    if (signal?.aborted) throw new DOMException('Archive read cancelled', 'AbortError')
    if ((await this.active(accountId)) !== generation)
      throw new Error('archive.error.sourceChanged')
    const records: ArchiveRecordView[] = rows.map((row) => {
      const p = row.projection
      const text = p.elements
        .filter((e) => e.kind === 'text' || e.kind === 'code')
        .map((e) => e.text ?? '')
        .join('\n')
      const kind = p.elements[0]?.kind
      return {
        messageKey: p.messageKey,
        conversationId,
        messageId: p.messageId,
        role: p.role,
        channel: p.channel,
        recipient: p.recipient,
        contentType: kind === 'code' ? 'code' : 'text',
        messageType: null,
        status: null,
        modelSlug: null,
        parentId: p.parentMessageId,
        turnExchangeId: null,
        createTime: p.sourceCreateTime,
        updateTime: p.sourceUpdateTime,
        raw: {
          content: { content_type: 'text', parts: [text] },
          author: { role: p.role },
          metadata: { parent_id: p.parentMessageId },
        },
      }
    })
    return {
      thread: buildArchiveThread(records),
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

  async exportKnownRecords(
    accountId: string,
    conversationId: string,
    format: 'json' | 'markdown' = 'json',
  ): Promise<Blob> {
    const rows = await this.readMessages(accountId, conversationId)
    if (!rows.length) throw new Error('No migrated records in the selected conversation')
    if (format === 'markdown') {
      const lines = [
        '# Восстановленный архив (неполная история)',
        '',
        '> Полнота пагинации и выбранной цепочки не подтверждена.',
        '> Исходные записи без потерь доступны в техническом JSON.',
        '',
      ]
      for (const row of rows) {
        const projection = row.projection
        lines.push('## ' + (projection.role ?? 'unknown'), '')
        for (const element of projection.elements.slice(1))
          lines.push(element.text ?? '[Неподдерживаемый элемент сохранён в JSON]', '')
      }
      return new Blob([lines.join('\n')], { type: 'text/markdown' })
    }
    const db = await this.store.canonicalDatabase()
    const generation = await this.active(accountId)
    if (!generation) throw new Error('Archive migration is not active')
    const snapshots: { messageId: string; raw: Record<string, unknown>; source: string }[] = []
    for (const m of rows) {
      const tx = db.transaction('sourceSnapshots', 'readonly')
      const all = await request<CanonicalSourceSnapshot[]>(
        tx.objectStore('sourceSnapshots').index('byMessage').getAll(m.key),
      )
      for (const source of all)
        if (source.generation === generation)
          snapshots.push({ messageId: m.messageId, raw: source.raw, source: source.source })
    }
    return new Blob(
      [
        JSON.stringify(
          {
            archiveFormat: 'booster-recovery-unverified-v1',
            warning: 'Partial recovered archive. Pagination and selected lineage are not verified.',
            conversationId,
            canonicalModelVersion: 1,
            records: rows.map((m) => m.projection),
            sourceSnapshots: snapshots,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
  }
}
