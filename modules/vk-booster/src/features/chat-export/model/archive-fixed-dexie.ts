import { assertServiceScope, type ServiceScope } from '@kobaproduction/browser-storage'
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
  close() {
    this.db.close()
  }
}
