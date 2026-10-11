import {
  ARCHIVE_CANONICAL_MODEL_VERSION,
  projectNativeMessage,
  type CanonicalContentElement,
  type CanonicalMessageProjection,
} from '@chatgpt-booster/core'
import { assertServiceScope, type ServiceScope } from '@kobaproduction/browser-storage'
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
  async addObservation(observation: SourceObservation): Promise<string> {
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
      },
    )
    return messageKey
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

  close(): void { this.db.close() }
}
