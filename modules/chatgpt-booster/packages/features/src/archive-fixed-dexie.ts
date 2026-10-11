import {
  ARCHIVE_CANONICAL_MODEL_VERSION,
  projectNativeMessage,
  type CanonicalContentElement,
  type CanonicalMessageProjection,
} from '@chatgpt-booster/core'
import { decodeArchiveClone, encodeArchiveClone } from '@kobaproduction/browser-archive'
import { assertServiceScope, type PortableBackupIndexedPort, type PortableBackupRow, type ServiceScope } from '@kobaproduction/browser-storage'
import Dexie, { type DexieOptions, type Table } from 'dexie'

/**
 * Provider-owned, immutable canonical archive v1. No legacy database is opened,
 * no staged generations and no automatic version-to-version conversions.
 */
export interface FixedProject {
  key: string
  accountId: string
  projectId: string
  title: string | null
}
export interface FixedConversation {
  key: string
  accountId: string
  conversationId: string
  projectId: string | null
  title: string | null
}
export interface FixedMessage {
  key: string
  accountId: string
  conversationId: string
  messageId: string
  modelVersion: typeof ARCHIVE_CANONICAL_MODEL_VERSION
  projection: CanonicalMessageProjection
}
export interface FixedSnapshot {
  accountId: string
  messageKey: string
  sourceKind: string
  sourceVersion: string
  observedAtMs: number
  raw: Record<string, unknown>
}
export interface FixedElement extends CanonicalContentElement {
  accountId: string
}
export interface SourceObservation {
  /** Identity must have been independently verified by the source adapter. */
  accountId: string
  conversationId: string
  projectId?: string | null
  conversationTitle?: string | null
  projectTitle?: string | null
  sourceKind: string
  sourceVersion: string
  observedAtMs: number
  /** Untouched original source values are stored separately, not as our schema. */
  raw: Record<string, unknown>
}

export function fixedArchiveDatabaseName(scope: ServiceScope): string {
  assertServiceScope(scope)
  if (scope.productId !== 'chatgpt-booster' || !scope.installationId || !scope.ownerId)
    throw Error('Canonical Dexie requires a verified ChatGPT owner and installation')
  // Account does not appear in physical names, only in verified record keys.
  return `koba-chatgpt-canonical-v1:${scope.channel}:${scope.installationId}`
}
class FixedArchiveDatabase extends Dexie {
  projects!: Table<FixedProject, string>
  conversations!: Table<FixedConversation, string>
  messages!: Table<FixedMessage, string>
  elements!: Table<FixedElement, string>
  snapshots!: Table<FixedSnapshot, string>

  constructor(name: string, options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({
      projects: '&key,accountId,[accountId+projectId]',
      conversations: '&key,accountId,[accountId+conversationId],[accountId+projectId]',
      messages: '&key,accountId,[accountId+conversationId],[accountId+conversationId+messageId],messageId',
      elements: '&elementId,accountId,messageKey,[messageKey+siblingOrder]',
      snapshots: '&messageKey,accountId',
    })
  }
}
function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}
function nullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > 4096) throw Error('Invalid source title')
  return value
}
function checkedObservation(value: SourceObservation, scope: ServiceScope): CanonicalMessageProjection {
  if (value.accountId !== scope.ownerId ||
      !nonEmpty(value.conversationId) ||
      (value.projectId !== undefined && value.projectId !== null && !nonEmpty(value.projectId)) ||
      !nonEmpty(value.sourceKind) || !nonEmpty(value.sourceVersion) ||
      !Number.isSafeInteger(value.observedAtMs) || value.observedAtMs < 0 ||
      !value.raw || typeof value.raw !== 'object' || Array.isArray(value.raw)) {
    throw Error('Source identity, provenance or observation invalid')
  }
  // Conversion can be revised when the upstream changes, but output v1 cannot.
  return projectNativeMessage(value.raw, {
    accountId: value.accountId,
    conversationId: value.conversationId,
  })
}

export class FixedCanonicalDexieRepository {
  readonly databaseName: string
  readonly scope: ServiceScope
  private readonly db: FixedArchiveDatabase

  constructor(scope: ServiceScope, options?: DexieOptions) {
    this.databaseName = fixedArchiveDatabaseName(scope)
    this.scope = scope
    this.db = new FixedArchiveDatabase(this.databaseName, options)
  }

  /**
   * One original message + all canonical v1 rows are an indivisible transaction.
   * Existing message IDs are immutable: an upstream edit is explicitly refused
   * until a separate revision policy is accepted, never silently overwritten.
   */
  async addObservation(observation: SourceObservation, stillAuthorized: () => boolean = () => true): Promise<string> {
    if (!stillAuthorized()) throw Error('Fixed archive capture authorization expired')
    const projection = checkedObservation(observation, this.scope)
    const accountId = observation.accountId
    const conversationId = observation.conversationId
    const messageKey = projection.messageKey
    const conversationKey = JSON.stringify([accountId, conversationId])
    const projectId = observation.projectId ?? null
    const original = structuredClone(observation.raw)
    const title = nullableText(observation.conversationTitle)
    const projectTitle = nullableText(observation.projectTitle)
    const record: FixedMessage = {
      key: messageKey,
      accountId,
      conversationId,
      messageId: projection.messageId,
      modelVersion: ARCHIVE_CANONICAL_MODEL_VERSION,
      projection,
    }
    const source: FixedSnapshot = {
      messageKey,
      accountId,
      sourceKind: observation.sourceKind,
      sourceVersion: observation.sourceVersion,
      observedAtMs: observation.observedAtMs,
      raw: original,
    }
    await this.db.transaction(
      'rw',
      this.db.projects, this.db.conversations, this.db.messages,
      this.db.elements, this.db.snapshots,
      async () => {
        if (!stillAuthorized()) throw Error('Fixed archive capture authorization expired')
        if (await this.db.messages.get(messageKey))
          throw Error('Canonical message already exists; revisions are not implicit')
        const existing = await this.db.conversations.get(conversationKey)
        if (existing && existing.projectId !== projectId)
          throw Error('Conversation project changed; a verified explicit action is required')
        if (projectId) {
          const projectKey = JSON.stringify([accountId, projectId])
          if (!(await this.db.projects.get(projectKey)))
            await this.db.projects.add({
              key: projectKey, accountId, projectId, title: projectTitle,
            })
        }
        if (!existing) {
          await this.db.conversations.add({
            key: conversationKey,
            accountId,
            conversationId,
            projectId,
            title,
          })
        }
        await this.db.messages.add(record)
        await this.db.elements.bulkAdd(projection.elements.map(element => ({ ...element, accountId })))
        await this.db.snapshots.add(source)
        if (!stillAuthorized()) throw Error('Fixed archive capture authorization expired')
      },
    )
    return messageKey
  }

  async listProjects(): Promise<FixedProject[]> {
    if (!this.scope.ownerId) throw Error('Verified owner required')
    return this.db.projects.where('accountId').equals(this.scope.ownerId).toArray()
  }
  async listConversations(): Promise<FixedConversation[]> {
    if (!this.scope.ownerId) throw Error('Verified owner required')
    return this.db.conversations.where('accountId').equals(this.scope.ownerId).toArray()
  }
  async getConversation(id: string): Promise<FixedConversation | undefined> {
    if (!this.scope.ownerId || !nonEmpty(id)) throw Error('Verified conversation required')
    return this.db.conversations.get(JSON.stringify([this.scope.ownerId, id]))
  }
  async clearAccount(): Promise<void> {
    throw Error('Clear of canonical data is disabled; export and verified backup required')
  }
  async getMessage(conversationId: string, messageId: string): Promise<FixedMessage | undefined> {
    if (!nonEmpty(conversationId) || !nonEmpty(messageId))
      throw Error('Invalid canonical message identity')
    const account = this.scope.ownerId
    if (!account) throw Error('Owner not verified')
    return this.db.messages.get(JSON.stringify([account, conversationId, messageId]))
  }

  /** Cursor is a source message ID, not an invented chronology timestamp. */
  async listMessages(
    conversationId: string,
    limit = 100,
    afterMessageId?: string,
  ): Promise<FixedMessage[]> {
    if (!nonEmpty(conversationId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500 ||
        (afterMessageId !== undefined && !nonEmpty(afterMessageId)))
      throw Error('Invalid canonical page')
    const account = this.scope.ownerId
    if (!account) throw Error('Owner not verified')
    const start = [account, conversationId, afterMessageId ?? '']
    const end = [account, conversationId, '\uffff']
    return this.db.messages.where('[accountId+conversationId+messageId]')
      .between(start, end, afterMessageId === undefined, false).limit(limit).toArray()
  }

  /** Stable source-ID cursor, independent of provider timestamp inference. */
  async windowMessages(
    conversationId: string,
    direction: 'older' | 'newer' | 'first',
    cursorId?: string,
    limit = 160,
  ): Promise<FixedMessage[]> {
    const owner = this.scope.ownerId
    if (!owner || !nonEmpty(conversationId) || (cursorId !== undefined && !nonEmpty(cursorId)) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 240)
      throw Error('Invalid saved archive window')
    const from = [owner, conversationId, '']
    const to = [owner, conversationId, '\uffff']
    const query = this.db.messages.where('[accountId+conversationId+messageId]')
    if (direction === 'first')
      return query.between(from, to).limit(limit).toArray()
    if (direction === 'older')
      return (await query.between(from,
        cursorId ? [owner, conversationId, cursorId] : to,
        true, !cursorId).reverse().limit(limit).toArray()).reverse()
    return query.between(
      cursorId ? [owner, conversationId, cursorId] : from,
      to, !cursorId, false,
    ).limit(limit).toArray()
  }

  async hasMessageBoundary(conversationId: string, messageId: string, side: 'before' | 'after') {
    const owner = this.scope.ownerId
    if (!owner || !nonEmpty(conversationId) || !nonEmpty(messageId))
      throw Error('Saved archive boundary unverified')
    const key = [owner, conversationId, messageId]
    const from = [owner, conversationId, '']
    const to = [owner, conversationId, '\uffff']
    const range = side === 'before'
      ? this.db.messages.where('[accountId+conversationId+messageId]').between(from, key, true, false)
      : this.db.messages.where('[accountId+conversationId+messageId]').between(key, to, false, false)
    return (await range.limit(1).count()) > 0
  }
  /** Exact counts of saved projections for the selected verified conversation.
   * A cursor walks message rows; do not claim this proves full remote history. */
  async savedConversationStats(conversationId: string): Promise<{
    messages: number; internalElements: number; toolCalls: number; reasoning: number
  }> {
    const owner = this.scope.ownerId
    if (!owner || !nonEmpty(conversationId)) throw Error('Verified conversation required')
    const result = { messages: 0, internalElements: 0, toolCalls: 0, reasoning: 0 }
    await this.db.messages.where('[accountId+conversationId]')
      .equals([owner, conversationId]).each(row => {
        result.messages++
        for (const element of row.projection.elements) {
          if (element.visibility === 'internal') result.internalElements++
          if (element.kind === 'tool_call') result.toolCalls++
          if (element.kind === 'reasoning') result.reasoning++
        }
      })
    return result
  }

  async countConversation(conversationId: string): Promise<number> {
    if (!nonEmpty(conversationId) || !this.scope.ownerId) throw Error('Invalid conversation ownership')
    return this.db.messages.where('[accountId+conversationId]')
      .equals([this.scope.ownerId, conversationId]).count()
  }

  async getSourceSnapshot(
    conversationId: string,
    messageId: string,
  ): Promise<FixedSnapshot | undefined> {
    if (!nonEmpty(conversationId) || !nonEmpty(messageId))
      throw Error('Invalid source identity')
    const account = this.scope.ownerId
    if (!account) throw Error('Owner not verified')
    return this.db.snapshots.get(JSON.stringify([account, conversationId, messageId]))
  }

  async counts(): Promise<{
    projects: number; conversations: number; messages: number; elements: number; snapshots: number
  }> {
    const account = this.scope.ownerId
    if (!account) throw Error('Owner not verified')
    const [projects, conversations, messages, elements, snapshots] = await Promise.all([
      this.db.projects.where('accountId').equals(account).count(),
      this.db.conversations.where('accountId').equals(account).count(),
      this.db.messages.where('accountId').equals(account).count(),
      this.db.elements.where('accountId').equals(account).count(),
      this.db.snapshots.where('accountId').equals(account).count(),
    ])
    return { projects, conversations, messages, elements, snapshots }
  }

  /** Internal recovery port. Never reads or upgrades historical native v3/v4 stores. */
  backupPort(): PortableBackupIndexedPort {
    const self = this
    const owner = this.scope.ownerId
    if (!owner) throw Error('Verified ChatGPT owner required for recovery')
    const stores = ['projects', 'conversations', 'messages', 'elements', 'snapshots'] as const
    const tables = stores.map((name) => ({ name, table: self.db[name] }))
    const schema = Object.fromEntries(tables.map(({ name, table }) => [
      name,
      { primaryKey: table.schema.primKey.src, indexes: table.schema.indexes.map((index) => index.src) },
    ]))
    const countRows = async () => Object.fromEntries(await Promise.all(
      tables.map(async ({ name, table }) => [name, await table.where('accountId').equals(owner).count()] as const),
    ))
    return {
      scope: this.scope,
      schemaVersion: 1,
      stores,
      schema,
      countRows,
      async *readRows(pageSize: number) {
        if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 2048)
          throw Error('Invalid ChatGPT recovery page size')
        const before = await countRows()
        for (const { name, table } of tables) {
          const keyField = table.schema.primKey.name
          if (!keyField) throw Error('Missing canonical primary key')
          let cursor: string | undefined
          while (true) {
            // Primary-key continuation, never OFFSET; scan foreign-owner rows without emitting them.
            const page = cursor === undefined
              ? await table.orderBy(keyField).limit(pageSize).toArray()
              : await table.where(keyField).above(cursor).limit(pageSize).toArray()
            for (const value of page) {
              const data = value as unknown as Record<string, unknown>
              const key = data[keyField]
              if (typeof key !== 'string' || !key || key.length > 1024)
                throw Error('Invalid ChatGPT backup primary key')
              cursor = key
              if (data.accountId !== owner) continue
              yield { store: name, key, value: await encodeArchiveClone(value) }
            }
            if (page.length < pageSize) break
          }
        }
        if (JSON.stringify(await countRows()) !== JSON.stringify(before))
          throw Error('Canonical source changed during recovery export')
      },
      async restoreAtomically(rows: readonly PortableBackupRow[]) {
        type Model = FixedProject | FixedConversation | FixedMessage | FixedElement | FixedSnapshot
        const buckets: Record<(typeof stores)[number], Model[]> = {
          projects: [], conversations: [], messages: [], elements: [], snapshots: [],
        }
        const keys: Record<(typeof stores)[number], Set<string>> = {
          projects: new Set(), conversations: new Set(), messages: new Set(),
          elements: new Set(), snapshots: new Set(),
        }
        const obj = (value: unknown): value is Record<string, unknown> =>
          value !== null && typeof value === 'object' && !Array.isArray(value)
        const tuple = (key: string, size: number): string[] => {
          const parsed: unknown = JSON.parse(key)
          if (!Array.isArray(parsed) || parsed.length !== size || parsed[0] !== owner ||
              !parsed.every((v) => nonEmpty(v as string))) throw Error('Invalid canonical key')
          return parsed as string[]
        }
        for (const row of rows) {
          if (!stores.includes(row.store as (typeof stores)[number]))
            throw Error('Unknown canonical recovery table')
          const store = row.store as (typeof stores)[number]
          const value: unknown = decodeArchiveClone(row.value)
          if (!obj(value) || value.accountId !== owner || keys[store].has(row.key))
            throw Error('Duplicate or wrong-owner canonical recovery row')
          const keyField = store === 'elements' ? 'elementId' : store === 'snapshots' ? 'messageKey' : 'key'
          if (value[keyField] !== row.key || !row.key || row.key.length > 1024)
            throw Error('Canonical primary key mismatch')
          if (store === 'projects') {
            const parts = tuple(row.key, 2)
            if (value.projectId !== parts[1] || (value.title !== null && typeof value.title !== 'string'))
              throw Error('Invalid project recovery record')
          } else if (store === 'conversations') {
            const parts = tuple(row.key, 2)
            if (value.conversationId !== parts[1] ||
                (value.projectId !== null && !nonEmpty(value.projectId as string)) ||
                (value.title !== null && typeof value.title !== 'string'))
              throw Error('Invalid conversation recovery record')
          } else if (store === 'messages') {
            const parts = tuple(row.key, 3)
            const projection = value.projection
            if (value.conversationId !== parts[1] || value.messageId !== parts[2] ||
                value.modelVersion !== ARCHIVE_CANONICAL_MODEL_VERSION || !obj(projection) ||
                projection.accountId !== owner || projection.conversationId !== parts[1] ||
                projection.messageId !== parts[2] || projection.messageKey !== row.key ||
                projection.modelVersion !== ARCHIVE_CANONICAL_MODEL_VERSION ||
                !Array.isArray(projection.elements)) throw Error('Invalid message recovery projection')
          } else if (store === 'elements') {
            if (typeof value.messageKey !== 'string' ||
                !Number.isSafeInteger(value.siblingOrder) || (value.siblingOrder as number) < 0 ||
                !nonEmpty(value.kind as string) || !nonEmpty(value.visibility as string) ||
                typeof value.sourcePath !== 'string') throw Error('Invalid canonical element')
          } else {
            const parts = tuple(row.key, 3)
            if (!obj(value.raw) || value.raw.id !== parts[2] ||
                !nonEmpty(value.sourceKind as string) || !nonEmpty(value.sourceVersion as string) ||
                !Number.isSafeInteger(value.observedAtMs) || (value.observedAtMs as number) < 0)
              throw Error('Invalid source snapshot recovery record')
          }
          keys[store].add(row.key)
          buckets[store].push(value as unknown as Model)
        }
        const projects = keys.projects, conversations = keys.conversations
        const messages = new Map((buckets.messages as FixedMessage[]).map((m) => [m.key, m]))
        const snapshots = keys.snapshots, elements = keys.elements
        for (const c of buckets.conversations as FixedConversation[]) {
          if (c.projectId && !projects.has(JSON.stringify([owner, c.projectId])))
            throw Error('Unresolved canonical recovery project')
        }
        for (const m of messages.values()) {
          if (!conversations.has(JSON.stringify([owner, m.conversationId])) || !snapshots.has(m.key))
            throw Error('Missing conversation/source snapshot in canonical recovery')
          for (const element of m.projection.elements) {
            if (!elements.has(element.elementId) || element.messageKey !== m.key)
              throw Error('Missing canonical content element')
          }
        }
        for (const snap of buckets.snapshots as FixedSnapshot[]) {
          if (!messages.has(snap.messageKey)) throw Error('Orphan canonical snapshot')
        }
        let expectedElements = 0
        for (const m of messages.values()) expectedElements += m.projection.elements.length
        if (elements.size !== expectedElements) throw Error('Orphan or duplicate canonical elements')
        const byId = new Map((buckets.elements as FixedElement[]).map((e) => [e.elementId, e]))
        for (const m of messages.values()) for (const original of m.projection.elements) {
          const element = byId.get(original.elementId)
          if (!element || element.messageKey !== m.key || element.parentElementId !== original.parentElementId ||
              element.siblingOrder !== original.siblingOrder || element.kind !== original.kind ||
              element.visibility !== original.visibility || element.text !== original.text ||
              element.language !== original.language || element.sourcePath !== original.sourcePath)
            throw Error('Canonical element projection disagrees with stored content')
        }
        // One transaction replaces only the verified account; another owner shares no writable rows.
        await self.db.transaction('rw', self.db.projects, self.db.conversations, self.db.messages, self.db.elements, self.db.snapshots, async () => {
          for (const { table } of tables) await table.where('accountId').equals(owner).delete()
          if (buckets.projects.length) await self.db.projects.bulkAdd(buckets.projects as FixedProject[])
          if (buckets.conversations.length) await self.db.conversations.bulkAdd(buckets.conversations as FixedConversation[])
          if (buckets.messages.length) await self.db.messages.bulkAdd(buckets.messages as FixedMessage[])
          if (buckets.elements.length) await self.db.elements.bulkAdd(buckets.elements as FixedElement[])
          if (buckets.snapshots.length) await self.db.snapshots.bulkAdd(buckets.snapshots as FixedSnapshot[])
        })
      },
    }
  }

  close(): void { this.db.close() }
}
