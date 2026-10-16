import {
  type ArchiveMessageV1,
  decodeArchiveClone,
  encodeArchiveClone,
} from '@kobaproduction/browser-archive'
import {
  assertServiceScope,
  type PortableBackupIndexedPort,
  type PortableBackupReader,
  type PortableBackupRow,
  type ServiceScope,
} from '@kobaproduction/browser-storage'
import Dexie, { type DexieOptions, type Table } from 'dexie'
import { projectVkArchiveMessage, readVkArchiveMessage } from './archive-message-adapter'
import type { VkMessage } from './types'

/**
 * First-party fixed VK record layout. It does NOT copy a v2 folder,
 * inspect old output paths, or rewrite the established file-based exporter.
 */
export const VK_FIXED_RECORD_VERSION = 1 as const
export interface FixedVkMessage {
  key: string
  ownerId: string
  peerId: number
  messageId: number
  schemaVersion: typeof VK_FIXED_RECORD_VERSION
  date: number | null
  senderId: number | null
  outgoing: boolean | null
  text: string | null
  attachmentCount: number | null
}
export interface FixedVkSourceSnapshot {
  key: string
  ownerId: string
  sourceVersion: string
  recordedAtMs: number
  raw: VkMessage
  /** Shared authority; existing snapshots without it adapt in memory only. */
  normalized?: ArchiveMessageV1
}
class FixedVkDatabase extends Dexie {
  messages!: Table<FixedVkMessage, string>
  snapshots!: Table<FixedVkSourceSnapshot, string>
  constructor(name: string, options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({
      messages: '&key,ownerId,[ownerId+peerId],[ownerId+peerId+messageId]',
      snapshots: '&key,ownerId',
    })
  }
}
export function fixedVkDatabaseName(scope: ServiceScope): string {
  assertServiceScope(scope)
  if (scope.productId !== 'vk-booster' || !scope.installationId || !scope.ownerId)
    throw Error('VK Dexie needs verified product, installation and owner')
  return `koba-vk-canonical-v1:${scope.channel}:${scope.installationId}`
}
function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
function projectOriginal(ownerId: string, peerId: number, source: VkMessage): FixedVkMessage {
  if (
    !ownerId ||
    !positive(peerId) ||
    !positive(source.id) ||
    (source.peer_id !== undefined && source.peer_id !== peerId)
  )
    throw Error('Unverified VK projection identity')
  if (source.out !== undefined && ![0, 1, true, false].includes(source.out))
    throw Error('Unknown VK message direction')
  return {
    key: JSON.stringify([ownerId, peerId, source.id]),
    ownerId,
    peerId,
    messageId: source.id,
    schemaVersion: VK_FIXED_RECORD_VERSION,
    date: positive(source.date) ? source.date : null,
    senderId:
      typeof source.from_id === 'number' && Number.isSafeInteger(source.from_id) ? source.from_id : null,
    outgoing: source.out === undefined ? null : source.out === 1 || source.out === true,
    text: typeof source.text === 'string' ? source.text : null,
    attachmentCount: Array.isArray(source.attachments) ? source.attachments.length : null,
  }
}
export class FixedVkDexieRepository {
  readonly databaseName: string
  private readonly db: FixedVkDatabase
  readonly scope: ServiceScope
  constructor(scope: ServiceScope, options?: DexieOptions) {
    this.databaseName = fixedVkDatabaseName(scope)
    this.scope = Object.freeze({ ...scope })
    this.db = new FixedVkDatabase(this.databaseName, options)
  }
  async addOriginal(peerId: number, source: VkMessage, sourceVersion: string, recordedAtMs: number) {
    const ownerId = this.scope.ownerId
    if (
      !ownerId ||
      !positive(peerId) ||
      !positive(source.id) ||
      (source.peer_id !== undefined && source.peer_id !== peerId) ||
      !sourceVersion ||
      sourceVersion.length > 128 ||
      !Number.isSafeInteger(recordedAtMs) ||
      recordedAtMs < 0
    )
      throw Error('Unverified VK record or conversation identity')
    const data = projectOriginal(ownerId, peerId, source)
    const key = data.key
    const snapshot: FixedVkSourceSnapshot = {
      key,
      ownerId,
      sourceVersion,
      recordedAtMs,
      raw: structuredClone(source),
      normalized: projectVkArchiveMessage(source, {
        ownerId,
        conversationId: String(peerId),
        sourceKind: 'vk-history',
        sourceVersion,
        observedAtMs: recordedAtMs,
      }),
    }
    await this.db.transaction('rw', this.db.messages, this.db.snapshots, async () => {
      if (await this.db.messages.get(key))
        throw Error('Original VK message already saved; replacement requires an explicit revision')
      await this.db.messages.add(data)
      await this.db.snapshots.add(snapshot)
    })
    return key
  }
  async getMessage(peerId: number, messageId: number): Promise<FixedVkMessage | undefined> {
    if (!positive(peerId) || !positive(messageId) || !this.scope.ownerId)
      throw Error('VK archive owner or record identity unavailable')
    return this.db.messages.get(JSON.stringify([this.scope.ownerId, peerId, messageId]))
  }
  async countMessages(peerId: number): Promise<number> {
    if (!positive(peerId) || !this.scope.ownerId) throw Error('Verified VK peer and owner required')
    return this.db.messages.where('[ownerId+peerId]').equals([this.scope.ownerId, peerId]).count()
  }
  async messageBounds(
    peerId: number,
  ): Promise<{ first: FixedVkMessage | undefined; last: FixedVkMessage | undefined }> {
    if (!positive(peerId) || !this.scope.ownerId) throw Error('Verified VK peer and owner required')
    const lower = [this.scope.ownerId, peerId, 0],
      upper = [this.scope.ownerId, peerId, Number.MAX_SAFE_INTEGER]
    const query = () =>
      this.db.messages.where('[ownerId+peerId+messageId]').between(lower, upper, true, true)
    const [first, last] = await Promise.all([query().first(), query().last()])
    return { first, last }
  }

  async listMessages(peerId: number, limit = 100, afterMessageId?: number): Promise<FixedVkMessage[]> {
    if (
      !positive(peerId) ||
      !this.scope.ownerId ||
      (afterMessageId !== undefined && !positive(afterMessageId)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    )
      throw Error('Invalid VK archive page')
    const lower = [this.scope.ownerId, peerId, afterMessageId ?? 0]
    const upper = [this.scope.ownerId, peerId, Number.MAX_SAFE_INTEGER]
    return this.db.messages
      .where('[ownerId+peerId+messageId]')
      .between(lower, upper, afterMessageId === undefined, false)
      .limit(limit)
      .toArray()
  }

  async getOriginal(peerId: number, messageId: number): Promise<FixedVkSourceSnapshot | undefined> {
    if (!positive(peerId) || !positive(messageId) || !this.scope.ownerId)
      throw Error('VK source record identity unavailable')
    const key = JSON.stringify([this.scope.ownerId, peerId, messageId])
    const snapshot = await this.db.snapshots.get(key)
    if (!snapshot) return undefined
    if (
      snapshot.key !== key ||
      snapshot.ownerId !== this.scope.ownerId ||
      snapshot.raw.id !== messageId ||
      (snapshot.raw.peer_id !== undefined && snapshot.raw.peer_id !== peerId)
    )
      throw Error('VK source identity mismatch')
    return {
      ...snapshot,
      normalized: readVkArchiveMessage(
        snapshot.raw,
        {
          ownerId: this.scope.ownerId,
          conversationId: String(peerId),
          sourceKind: 'vk-history',
          sourceVersion: snapshot.sourceVersion,
          observedAtMs: snapshot.recordedAtMs,
        },
        snapshot.normalized,
      ),
    }
  }
  /** VK-specific table adapter; the common backup engine knows no VK fields. */
  backupPort(guards?: { beforeCommit(): void | Promise<void> }): PortableBackupIndexedPort {
    const self = this
    const ownerValue = this.scope.ownerId
    if (!ownerValue) throw Error('Verified VK owner is required for backups')
    const owner: string = ownerValue
    type DecodedRow =
      | { store: 'messages'; value: FixedVkMessage }
      | { store: 'snapshots'; value: FixedVkSourceSnapshot }
    function decodeRow(row: PortableBackupRow): DecodedRow {
      if (row.store !== 'messages' && row.store !== 'snapshots') throw Error('Unknown VK table')
      const value: unknown = decodeArchiveClone(row.value)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid VK record')
      const record = value as Record<string, unknown>
      if (record.ownerId !== owner || record.key !== row.key || typeof row.key !== 'string')
        throw Error('VK backup owner/key mismatch')
      if (row.store === 'messages') {
        if (
          record.schemaVersion !== VK_FIXED_RECORD_VERSION ||
          !Number.isSafeInteger(record.peerId) ||
          (record.peerId as number) <= 0 ||
          !Number.isSafeInteger(record.messageId) ||
          (record.messageId as number) <= 0 ||
          row.key !== JSON.stringify([owner, record.peerId, record.messageId])
        )
          throw Error('Invalid fixed VK backup message')
        return { store: 'messages', value: value as FixedVkMessage }
      }
      if (
        typeof record.sourceVersion !== 'string' ||
        !record.sourceVersion ||
        record.sourceVersion.length > 128 ||
        !Number.isSafeInteger(record.recordedAtMs) ||
        (record.recordedAtMs as number) < 0 ||
        !record.raw ||
        typeof record.raw !== 'object' ||
        Array.isArray(record.raw)
      )
        throw Error('Invalid fixed VK backup source')
      const original = record.raw as Record<string, unknown>
      const parts: unknown = JSON.parse(row.key)
      if (
        !Array.isArray(parts) ||
        parts.length !== 3 ||
        parts[0] !== owner ||
        original.id !== parts[2] ||
        (original.peer_id !== undefined && original.peer_id !== parts[1])
      )
        throw Error('Invalid VK backup snapshot identity')
      if (record.normalized !== undefined)
        readVkArchiveMessage(
          record.raw as VkMessage,
          {
            ownerId: owner,
            conversationId: String(parts[1]),
            sourceKind: 'vk-history',
            sourceVersion: record.sourceVersion as string,
            observedAtMs: record.recordedAtMs as number,
          },
          record.normalized,
        )
      return { store: 'snapshots', value: value as FixedVkSourceSnapshot }
    }
    function validatePair(message: FixedVkMessage, snapshot: FixedVkSourceSnapshot): void {
      if (message.key !== snapshot.key) throw Error('VK backup projection/snapshot consistency mismatch')
      const expected = projectOriginal(owner, message.peerId, snapshot.raw)
      if (
        Object.keys(message).sort().join(',') !== Object.keys(expected).sort().join(',') ||
        (Object.keys(expected) as (keyof FixedVkMessage)[]).some((key) => message[key] !== expected[key])
      )
        throw Error('VK backup projection disagrees with original source')
    }
    const validateRows = (input: readonly PortableBackupRow[]) => {
      const messages: FixedVkMessage[] = []
      const snapshots: FixedVkSourceSnapshot[] = []
      const msgKeys = new Set<string>(),
        snapshotKeys = new Set<string>()
      // Strict provider validation happens before any transaction clears old rows.
      for (const row of input) {
        const decoded = decodeRow(row)
        if (decoded.store === 'messages') {
          if (msgKeys.has(row.key)) throw Error('Invalid fixed VK backup message')
          msgKeys.add(row.key)
          messages.push(decoded.value)
        } else {
          if (snapshotKeys.has(row.key)) throw Error('Invalid fixed VK backup source')
          snapshotKeys.add(row.key)
          snapshots.push(decoded.value)
        }
      }
      if (msgKeys.size !== snapshotKeys.size || [...msgKeys].some((key) => !snapshotKeys.has(key)))
        throw Error('VK backup projection/snapshot consistency mismatch')
      const originals = new Map(snapshots.map((snapshot) => [snapshot.key, snapshot]))
      for (const message of messages) {
        const snapshot = originals.get(message.key)
        if (!snapshot) throw Error('VK backup source snapshot is missing')
        validatePair(message, snapshot)
      }
      return { messages, snapshots }
    }
    async function validateStagedRows(reader: PortableBackupReader): Promise<void> {
      if (!Number.isSafeInteger(reader.count) || reader.count < 0)
        throw Error('Invalid VK staged row count')
      let messages = 0,
        snapshots = 0
      for (const store of ['messages', 'snapshots'] as const) {
        let previous: string | undefined
        for await (const row of reader.readRows(store)) {
          if (row.store !== store) throw Error('Unexpected VK staged table')
          const token = JSON.stringify([row.store, row.key])
          if (previous !== undefined && token <= previous)
            throw Error('Duplicate or unordered VK staged record')
          previous = token
          const decoded = decodeRow(row)
          const otherStore = store === 'messages' ? 'snapshots' : 'messages'
          const counterpart = await reader.get(otherStore, row.key)
          if (!counterpart || counterpart.store !== otherStore || counterpart.key !== row.key)
            throw Error('VK backup projection/snapshot consistency mismatch')
          const other = decodeRow(counterpart)
          if (decoded.store === 'messages' && other.store === 'snapshots')
            validatePair(decoded.value, other.value)
          else if (decoded.store === 'snapshots' && other.store === 'messages')
            validatePair(other.value, decoded.value)
          else throw Error('Unexpected VK staged counterpart')
          if (store === 'messages') messages++
          else snapshots++
          if (messages + snapshots > reader.count) throw Error('VK staged row count mismatch')
        }
      }
      if (messages !== snapshots || messages + snapshots !== reader.count)
        throw Error('VK backup projection/snapshot consistency mismatch')
    }
    async function beforeCommit() {
      if (guards) await Dexie.waitFor(Promise.resolve(guards.beforeCommit()))
    }
    async function deleteOwnedRows(): Promise<void> {
      for (const store of ['messages', 'snapshots'] as const) {
        const table = self.db[store]
        while (true) {
          // Dexie's secondary-index Collection.delete() first gathers every
          // primary key. Keep even the deletion phase bounded for large owners.
          const keys = await table.where('ownerId').equals(owner).limit(256).primaryKeys()
          if (!keys.length) break
          await table.bulkDelete(keys)
        }
      }
    }
    return {
      scope: this.scope,
      schemaVersion: VK_FIXED_RECORD_VERSION,
      stores: ['messages', 'snapshots'],
      schema: Object.fromEntries(
        self.db.tables.map((table) => [
          table.name,
          {
            primaryKey: table.schema.primKey.src,
            indexes: table.schema.indexes.map((index) => index.src),
          },
        ]),
      ),
      async countRows() {
        return {
          messages: await self.db.messages.where('ownerId').equals(owner).count(),
          snapshots: await self.db.snapshots.where('ownerId').equals(owner).count(),
        }
      },
      async *readRows(pageSize: number) {
        if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 2048)
          throw Error('Invalid VK backup page size')
        const counts = await Promise.all([
          self.db.messages.where('ownerId').equals(owner).count(),
          self.db.snapshots.where('ownerId').equals(owner).count(),
        ])
        // Fixed primary-key JSON tuple is [owner, peer, messageId]. A bounded
        // key range makes consecutive pages O(log N + page) instead of repeatedly
        // skipping every preceding row with increasing OFFSET.
        const prefix = `${JSON.stringify([owner]).slice(0, -1)},`
        const upper = `${prefix}\uffff`
        for (const store of ['messages', 'snapshots'] as const) {
          const table = self.db[store]
          let last: string | undefined
          while (true) {
            const page: (FixedVkMessage | FixedVkSourceSnapshot)[] = await table
              .where('key')
              .between(last ?? prefix, upper, last === undefined, false)
              .limit(pageSize)
              .toArray()
            for (const record of page) {
              if (record.ownerId !== owner || !record.key.startsWith(prefix))
                throw Error('Unexpected VK backup account')
              yield { store, key: record.key, value: await encodeArchiveClone(record) }
            }
            last = page.at(-1)?.key
            if (page.length < pageSize) break
          }
        }
        const after = await Promise.all([
          self.db.messages.where('ownerId').equals(owner).count(),
          self.db.snapshots.where('ownerId').equals(owner).count(),
        ])
        if (after[0] !== counts[0] || after[1] !== counts[1])
          throw Error('VK archive changed during backup; retry after capture stops')
      },
      validateRows(input) {
        validateRows(input)
      },
      validateStagedRows,
      async restoreAtomically(input: readonly PortableBackupRow[]) {
        const { messages, snapshots } = validateRows(input)
        await self.db.transaction('rw', self.db.messages, self.db.snapshots, async () => {
          await deleteOwnedRows()
          if (messages.length) await self.db.messages.bulkAdd(messages)
          if (snapshots.length) await self.db.snapshots.bulkAdd(snapshots)
          await beforeCommit()
        })
      },
      async restoreStagedAtomically(reader) {
        // The shared stage is sealed and indexed before this preflight. It never
        // shares this active schema or owner namespace and cannot grow mid-write.
        await validateStagedRows(reader)
        await self.db.transaction('rw', self.db.messages, self.db.snapshots, async () => {
          await deleteOwnedRows()
          let written = 0
          for (const store of ['messages', 'snapshots'] as const) {
            const rows = reader.readRows(store)[Symbol.asyncIterator]()
            let done = false
            try {
              while (!done) {
                const batch = await Dexie.waitFor(
                  (async () => {
                    const values: (FixedVkMessage | FixedVkSourceSnapshot)[] = []
                    for (let index = 0; index < 256; index++) {
                      const next = await rows.next()
                      if (next.done) {
                        done = true
                        break
                      }
                      if (next.value.store !== store) throw Error('Unexpected VK staged table')
                      const decoded = decodeRow(next.value)
                      values.push(decoded.value)
                    }
                    return values
                  })(),
                )
                written += batch.length
                if (written > reader.count) throw Error('VK staged row count changed')
                if (batch.length) {
                  if (store === 'messages') await self.db.messages.bulkAdd(batch as FixedVkMessage[])
                  else await self.db.snapshots.bulkAdd(batch as FixedVkSourceSnapshot[])
                }
              }
            } finally {
              if (!done && rows.return) await Dexie.waitFor(rows.return())
            }
          }
          if (written !== reader.count) throw Error('VK staged row count changed')
          await beforeCommit()
        })
      },
    }
  }

  close() {
    this.db.close()
  }
}
