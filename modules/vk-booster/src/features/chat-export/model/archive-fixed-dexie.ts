import { decodeArchiveClone, encodeArchiveClone } from '@kobaproduction/browser-archive'
import {
  assertServiceScope,
  type PortableBackupIndexedPort,
  type PortableBackupRow,
  type ServiceScope,
} from '@kobaproduction/browser-storage'
import Dexie, { type DexieOptions, type Table } from 'dexie'
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
export class FixedVkDexieRepository {
  readonly databaseName: string
  private readonly db: FixedVkDatabase
  readonly scope: ServiceScope
  constructor(scope: ServiceScope, options?: DexieOptions) {
    this.databaseName = fixedVkDatabaseName(scope)
    this.scope = scope
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
    const key = JSON.stringify([ownerId, peerId, source.id])
    const date = positive(source.date) ? source.date : null
    const senderId =
      typeof source.from_id === 'number' && Number.isSafeInteger(source.from_id) ? source.from_id : null
    if (source.out !== undefined && ![0, 1, true, false].includes(source.out))
      throw Error('Unknown VK message direction')
    const outgoing = source.out === undefined ? null : source.out === 1 || source.out === true
    const text = typeof source.text === 'string' ? source.text : null
    const attachmentCount = Array.isArray(source.attachments) ? source.attachments.length : null
    const data: FixedVkMessage = {
      key,
      ownerId,
      peerId,
      messageId: source.id,
      schemaVersion: VK_FIXED_RECORD_VERSION,
      date,
      senderId,
      outgoing,
      text,
      attachmentCount,
    }
    const snapshot: FixedVkSourceSnapshot = {
      key,
      ownerId,
      sourceVersion,
      recordedAtMs,
      raw: structuredClone(source),
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
    return this.db.snapshots.get(JSON.stringify([this.scope.ownerId, peerId, messageId]))
  }
  /** VK-specific table adapter; the common backup engine knows no VK fields. */
  backupPort(): PortableBackupIndexedPort {
    const self = this
    const owner = this.scope.ownerId
    if (!owner) throw Error('Verified VK owner is required for backups')
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
      async restoreAtomically(input: readonly PortableBackupRow[]) {
        const messages: FixedVkMessage[] = []
        const snapshots: FixedVkSourceSnapshot[] = []
        const msgKeys = new Set<string>(),
          snapshotKeys = new Set<string>()
        // Strict provider validation happens before any transaction clears old rows.
        for (const row of input) {
          if (row.store !== 'messages' && row.store !== 'snapshots') throw Error('Unknown VK table')
          const value: unknown = decodeArchiveClone(row.value)
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw Error('Invalid VK record')
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
              row.key !== JSON.stringify([owner, record.peerId, record.messageId]) ||
              msgKeys.has(row.key)
            )
              throw Error('Invalid fixed VK backup message')
            msgKeys.add(row.key)
            messages.push(value as FixedVkMessage)
          } else {
            if (
              typeof record.sourceVersion !== 'string' ||
              !record.sourceVersion ||
              !Number.isSafeInteger(record.recordedAtMs) ||
              (record.recordedAtMs as number) < 0 ||
              !record.raw ||
              typeof record.raw !== 'object' ||
              Array.isArray(record.raw) ||
              snapshotKeys.has(row.key)
            )
              throw Error('Invalid fixed VK backup source')
            const original = record.raw as Record<string, unknown>
            const keyParts: unknown = JSON.parse(row.key)
            if (
              !Array.isArray(keyParts) ||
              keyParts[0] !== owner ||
              original.id !== keyParts[2] ||
              (original.peer_id !== undefined && original.peer_id !== keyParts[1])
            )
              throw Error('Invalid VK backup snapshot identity')
            snapshotKeys.add(row.key)
            snapshots.push(value as FixedVkSourceSnapshot)
          }
        }
        if (msgKeys.size !== snapshotKeys.size || [...msgKeys].some((key) => !snapshotKeys.has(key)))
          throw Error('VK backup projection/snapshot consistency mismatch')
        await self.db.transaction('rw', self.db.messages, self.db.snapshots, async () => {
          await self.db.messages.where('ownerId').equals(owner).delete()
          await self.db.snapshots.where('ownerId').equals(owner).delete()
          if (messages.length) await self.db.messages.bulkAdd(messages)
          if (snapshots.length) await self.db.snapshots.bulkAdd(snapshots)
        })
      },
    }
  }

  close() {
    this.db.close()
  }
}
