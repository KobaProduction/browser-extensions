import {
  ARCHIVE_CANONICAL_MODEL_VERSION,
  type CanonicalContentElement,
  type CanonicalMessageProjection,
  projectNativeMessage,
} from '@chatgpt-booster/core'
import {
  type ArchiveMessageV1,
  archiveSha256Hex,
  collectArchiveRange,
  decodeArchiveClone,
  encodeArchiveClone,
} from '@kobaproduction/browser-archive'
import {
  assertServiceScope,
  type PortableBackupIndexedPort,
  type PortableBackupReader,
  type PortableBackupRow,
  type ServiceScope,
  serializedBackupRow,
} from '@kobaproduction/browser-storage'
import Dexie, { type DexieOptions, type Table, type Transaction } from 'dexie'
import {
  advanceHistoryCoverage,
  type HistoryCoverageCheckpoint,
  type HistoryPageEvidence,
  validateHistoryCoverageCheckpoint,
} from './archive-coverage'
import {
  assertFixedBackupAdmission,
  assertFixedBackupCodecBudget,
  decodeFixedBackupRow,
  detachedFixedBackupSnapshot,
  type FixedBackupCounts,
  type FixedBackupModel,
  validateFixedStagedBackup,
} from './archive-fixed-backup-validation'
import { conversationIntegrity } from './archive-integrity'
import {
  projectChatGptArchiveMessage,
  readChatGptArchiveMessage,
  validateChatGptNormalizedSnapshot,
} from './archive-message-adapter'
import {
  compareSourceObservation,
  type ObservationDecision,
  type SourceCloneDigest,
  sourceCloneDigest,
  sourceFingerprint,
} from './archive-observation-policy'
import {
  type FixedProjectAssociation,
  originalConversationProject,
  sourceProjectBelongsToConversation,
  validateProjectAssociations,
} from './archive-project-association'

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
  pageEvidence?: HistoryPageEvidence[]
  pageCoverage?: HistoryCoverageCheckpoint
  currentHeadId?: string | null
  terminalHeadId?: string | null
  pageHeadId?: string | null
  revision?: number
  /** Physical conversation incarnation; restore/recreation never reuses it. */
  instanceId?: string
  projectAssociations?: FixedProjectAssociation[]
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
  /** Additive payload metadata in schema 1; historical rows adapt on read only. */
  normalized?: ArchiveMessageV1
  projectId?: string | null
  /** All distinct original observations survive, including stale reloads and contradictions. */
  versions?: FixedSourceVersion[]
  sourceEvents?: readonly Record<string, unknown>[]
}
export interface FixedSourceVersion {
  sourceKind: string
  sourceVersion: string
  observedAtMs: number
  decision: ObservationDecision | 'initial'
  raw: Record<string, unknown>
  normalized?: ArchiveMessageV1
  sourceEvents?: readonly Record<string, unknown>[]
  projectId?: string | null
}
export interface FixedElement extends CanonicalContentElement {
  accountId: string
}
export interface FixedTimelineMessage {
  id: string
  parentId: string | null
  parentKnown: boolean
  role: string | null
  channel: string | null
  recipient: string | null
  preview: string
  sourceCreateTime: number | null
}
interface ChronologyPlan {
  stamp: string
  ids: readonly string[]
  positions: ReadonlyMap<string, number>
}
interface ObservationDigests {
  stamp: string
  preferred: SourceCloneDigest
  preferredObservation: string
  seen: Set<string>
}
/** Revision alone is not an identity: a peer can remove and recreate revision1. */
export function fixedConversationStamp(
  header: Pick<FixedConversation, 'revision' | 'instanceId'> | undefined,
): string {
  return JSON.stringify([header?.instanceId ?? null, header?.revision ?? 0])
}
async function observationDigest(raw: SourceCloneDigest, events: unknown) {
  return JSON.stringify([raw.hash, await sourceCloneDigest(events ?? null)])
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
  sourceEvents?: readonly Record<string, unknown>[]
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
      messages:
        '&key,accountId,[accountId+conversationId],[accountId+conversationId+messageId],messageId',
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
  if (
    value.accountId !== scope.ownerId ||
    !nonEmpty(value.conversationId) ||
    (value.projectId !== undefined && value.projectId !== null && !nonEmpty(value.projectId)) ||
    !nonEmpty(value.sourceKind) ||
    !nonEmpty(value.sourceVersion) ||
    !Number.isSafeInteger(value.observedAtMs) ||
    value.observedAtMs < 0 ||
    !value.raw ||
    typeof value.raw !== 'object' ||
    Array.isArray(value.raw)
  ) {
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
  /** Small LRU of lightweight ID/order facts, never source snapshots. */
  private readonly orderPlans = new Map<string, { stamp: string; pending: Promise<ChronologyPlan> }>()
  private readonly observationDigests = new Map<string, ObservationDigests>()

  constructor(scope: ServiceScope, options?: DexieOptions) {
    this.databaseName = fixedArchiveDatabaseName(scope)
    this.scope = Object.freeze({ ...scope })
    this.db = new FixedArchiveDatabase(this.databaseName, options)
  }

  /**
   * One original message + all canonical v1 rows are an indivisible transaction.
   * Every original observation is retained. Only monotonic enrichment may
   * become the preferred projection; contradictory/reduced reloads stay variants.
   */
  async addObservation(
    observation: SourceObservation,
    stillAuthorized: () => boolean = () => true,
  ): Promise<string> {
    return (await this.addObservationResult(observation, stillAuthorized)).key
  }
  async addObservationResult(
    observation: SourceObservation,
    stillAuthorized: () => boolean = () => true,
  ): Promise<{ key: string; normalized?: ArchiveMessageV1 }> {
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
      projectId,
      normalized: projectChatGptArchiveMessage(original, {
        ownerId: accountId,
        conversationId,
        projectId,
        sourceKind: observation.sourceKind,
        sourceVersion: observation.sourceVersion,
        observedAtMs: observation.observedAtMs,
      }),
      ...(observation.sourceEvents ? { sourceEvents: structuredClone(observation.sourceEvents) } : {}),
    }
    await assertFixedBackupAdmission('messages', messageKey, record)
    await assertFixedBackupAdmission('snapshots', messageKey, detachedFixedBackupSnapshot(source))
    const originalFingerprint = await sourceCloneDigest(original)
    const observationFingerprint = await observationDigest(originalFingerprint, source.sourceEvents)
    if (!stillAuthorized()) throw Error('Fixed archive capture authorization expired')
    let committedNormalized: ArchiveMessageV1 | undefined
    let committedDigests: ObservationDigests | undefined
    await this.db.transaction(
      'rw',
      this.db.projects,
      this.db.conversations,
      this.db.messages,
      this.db.elements,
      this.db.snapshots,
      async () => {
        const transaction = Dexie.currentTransaction
        if (!transaction) throw Error('Canonical capture transaction unavailable')
        const projects = transaction.table<FixedProject, string>('projects')
        const conversations = transaction.table<FixedConversation, string>('conversations')
        const messages = transaction.table<FixedMessage, string>('messages')
        const elements = transaction.table<FixedElement, string>('elements')
        const snapshots = transaction.table<FixedSnapshot, string>('snapshots')
        if (!stillAuthorized()) throw Error('Fixed archive capture authorization expired')
        const prior = await snapshots.get(messageKey)
        const priorMessage = await messages.get(messageKey)
        const existingConversation = await conversations.get(conversationKey)
        const instanceId = existingConversation?.instanceId ?? crypto.randomUUID()
        if (existingConversation && existingConversation.projectId !== projectId)
          throw Error('Conversation project changed; a verified explicit action is required')
        if (priorMessage && !prior) throw Error('Canonical source snapshot missing')
        if (prior) {
          validateChatGptNormalizedSnapshot(
            prior,
            conversationId,
            prior.projectId === undefined
              ? existingConversation
                ? originalConversationProject(existingConversation)
                : null
              : prior.projectId,
          )
          const cached = this.observationDigests.get(messageKey)
          const memo =
            cached?.stamp === fixedConversationStamp(existingConversation) ? cached : undefined
          const priorFingerprint = memo?.preferred ?? (await Dexie.waitFor(sourceCloneDigest(prior.raw)))
          const decision = compareSourceObservation(prior.raw, original, {
            current: priorFingerprint.hash,
            incoming: originalFingerprint.hash,
            currentLength: priorFingerprint.length,
            incomingLength: originalFingerprint.length,
          })
          if (
            decision === 'identical' &&
            (memo?.preferredObservation ??
              (await Dexie.waitFor(observationDigest(priorFingerprint, prior.sourceEvents)))) ===
              observationFingerprint
          )
            return
          const priorProject =
            prior.projectId === undefined
              ? existingConversation
                ? originalConversationProject(existingConversation)
                : null
              : prior.projectId
          const versions = prior.versions?.map((version) => ({
            ...version,
            projectId: version.projectId === undefined ? priorProject : version.projectId,
          })) ?? [
            {
              sourceKind: prior.sourceKind,
              sourceVersion: prior.sourceVersion,
              observedAtMs: prior.observedAtMs,
              decision: 'initial' as const,
              raw: prior.raw,
              projectId:
                prior.projectId === undefined
                  ? existingConversation
                    ? originalConversationProject(existingConversation)
                    : null
                  : prior.projectId,
              normalized: projectChatGptArchiveMessage(prior.raw, {
                ownerId: accountId,
                conversationId,
                projectId:
                  prior.projectId === undefined
                    ? existingConversation
                      ? originalConversationProject(existingConversation)
                      : null
                    : prior.projectId,
                sourceKind: prior.sourceKind,
                sourceVersion: prior.sourceVersion,
                observedAtMs: prior.observedAtMs,
                variantIndex: 0,
              }),
              ...(prior.sourceEvents ? { sourceEvents: prior.sourceEvents } : {}),
            },
          ]
          const seen = new Set(memo?.seen)
          if (!memo)
            for (const version of versions) {
              const rawDigest = await Dexie.waitFor(sourceCloneDigest(version.raw))
              seen.add(await Dexie.waitFor(observationDigest(rawDigest, version.sourceEvents)))
            }
          if (seen.has(observationFingerprint)) return
          seen.add(observationFingerprint)
          if (!source.normalized) throw Error('Normalized source unavailable')
          const versionNormalized = structuredClone(source.normalized)
          const history = [
            ...versions,
            {
              sourceKind: source.sourceKind,
              sourceVersion: source.sourceVersion,
              observedAtMs: source.observedAtMs,
              normalized: {
                ...versionNormalized,
                source: { ...versionNormalized.source, variantIndex: versions.length },
              },
              decision,
              raw: original,
              projectId,
              ...(source.sourceEvents ? { sourceEvents: source.sourceEvents } : {}),
            },
          ]
          const nextSnapshot =
            decision === 'advance' ? { ...source, versions: history } : { ...prior, versions: history }
          await Dexie.waitFor(
            assertFixedBackupAdmission(
              'snapshots',
              messageKey,
              detachedFixedBackupSnapshot(nextSnapshot),
            ),
          )
          await snapshots.put(nextSnapshot)
          committedNormalized = history.at(-1)?.normalized
          if (decision === 'advance') {
            await elements.where('messageKey').equals(messageKey).delete()
            await messages.put(record)
            await elements.bulkAdd(projection.elements.map((element) => ({ ...element, accountId })))
          }
          const conversation = await conversations.get(conversationKey)
          if (conversation) {
            const nextHeader = {
              ...conversation,
              revision: (conversation.revision ?? 0) + 1,
              instanceId,
            }
            await Dexie.waitFor(assertFixedBackupAdmission('conversations', conversationKey, nextHeader))
            await conversations.put(nextHeader)
          }
          committedDigests = {
            stamp: fixedConversationStamp({ revision: (conversation?.revision ?? 0) + 1, instanceId }),
            preferred: decision === 'advance' ? originalFingerprint : priorFingerprint,
            preferredObservation:
              decision === 'advance'
                ? observationFingerprint
                : (memo?.preferredObservation ??
                  (await Dexie.waitFor(observationDigest(priorFingerprint, prior.sourceEvents)))),
            seen,
          }
          if (!stillAuthorized()) throw Error('Fixed archive capture authorization expired')
          return
        }
        const existing = await conversations.get(conversationKey)
        if (existing && existing.projectId !== projectId)
          throw Error('Conversation project changed; a verified explicit action is required')
        if (projectId) {
          const projectKey = JSON.stringify([accountId, projectId])
          if (!(await projects.get(projectKey)))
            await projects.add({
              key: projectKey,
              accountId,
              projectId,
              title: projectTitle,
            })
        }
        if (!existing) {
          await conversations.add({
            key: conversationKey,
            accountId,
            conversationId,
            projectId,
            title,
            revision: 0,
            instanceId,
          })
        }
        await messages.add(record)
        await elements.bulkAdd(projection.elements.map((element) => ({ ...element, accountId })))
        await snapshots.add(source)
        committedNormalized = source.normalized
        const createdHeader = await conversations.get(conversationKey)
        if (!createdHeader) throw Error('Canonical conversation missing')
        const nextHeader = { ...createdHeader, revision: (existing?.revision ?? 0) + 1, instanceId }
        await Dexie.waitFor(assertFixedBackupAdmission('conversations', conversationKey, nextHeader))
        await conversations.put(nextHeader)
        committedDigests = {
          stamp: fixedConversationStamp({ revision: (existing?.revision ?? 0) + 1, instanceId }),
          preferred: originalFingerprint,
          preferredObservation: observationFingerprint,
          seen: new Set([observationFingerprint]),
        }
        if (!stillAuthorized()) throw Error('Fixed archive capture authorization expired')
      },
    )
    if (committedDigests) {
      this.observationDigests.delete(messageKey)
      this.observationDigests.set(messageKey, committedDigests)
      while (this.observationDigests.size > 128) {
        const first = this.observationDigests.keys().next().value
        if (first !== undefined) this.observationDigests.delete(first)
      }
    }
    return { key: messageKey, ...(committedNormalized ? { normalized: committedNormalized } : {}) }
  }

  async listProjects(): Promise<FixedProject[]> {
    if (!this.scope.ownerId) throw Error('Verified owner required')
    return this.db.projects.where('accountId').equals(this.scope.ownerId).toArray()
  }
  async upsertProjectTitle(
    projectId: string,
    title: string,
    stillAuthorized: () => boolean,
  ): Promise<boolean> {
    const owner = this.scope.ownerId
    if (
      !owner ||
      !projectId.startsWith('g-p-') ||
      projectId.length <= 4 ||
      projectId.length > 256 ||
      /[\s/?#]/.test(projectId) ||
      !title.trim() ||
      title.length > 4096 ||
      !stillAuthorized()
    )
      throw Error('Verified bounded project metadata required')
    let changed = false
    await this.db.transaction('rw', this.db.projects, async () => {
      const key = JSON.stringify([owner, projectId])
      const previous = await this.db.projects.get(key)
      if (!stillAuthorized()) throw Error('Project metadata authorization expired')
      if (previous?.title === title) return
      const next: FixedProject = { key, accountId: owner, projectId, title }
      await Dexie.waitFor(assertFixedBackupAdmission('projects', key, next))
      if (!stillAuthorized()) throw Error('Project metadata authorization expired')
      await this.db.projects.put(next)
      if (!stillAuthorized()) throw Error('Project metadata authorization expired')
      changed = true
    })
    return changed
  }
  /** Only an explicitly observed, current initial native read may move an
   * existing conversation. Optional/missing context never authorizes a move. */
  async reassociateProject(
    conversationId: string,
    evidence: Omit<FixedProjectAssociation, 'previousProjectId'>,
    stillAuthorized: () => boolean,
  ): Promise<boolean> {
    const owner = this.scope.ownerId
    if (!owner || !nonEmpty(conversationId) || !stillAuthorized())
      throw Error('Verified project association authorization required')
    let changed = false
    await this.db.transaction('rw', this.db.projects, this.db.conversations, async () => {
      const key = JSON.stringify([owner, conversationId])
      const header = await this.db.conversations.get(key)
      if (!header || header.projectId === evidence.projectId) return
      const entry: FixedProjectAssociation = {
        ...structuredClone(evidence),
        previousProjectId: header.projectId,
      }
      const history = [...(header.projectAssociations ?? []), entry]
      const next = {
        ...header,
        projectId: entry.projectId,
        projectAssociations: history,
        revision: (header.revision ?? 0) + 1,
        instanceId: header.instanceId ?? crypto.randomUUID(),
      }
      validateProjectAssociations(next)
      // A native-page read used by capture must not predate the persisted page
      // frontier, even when no earlier project movement has been recorded.
      const latestRead = Math.max(
        -1,
        ...[header.pageCoverage?.initial?.readStartedAt ?? -1],
        ...(header.pageEvidence ?? []).map((page) => page.readStartedAt ?? page.observedAt),
      )
      if (entry.readStartedAt < latestRead) throw Error('Stale project association read')
      if (!stillAuthorized()) throw Error('Project association authorization expired')
      if (entry.projectId) {
        const projectKey = JSON.stringify([owner, entry.projectId])
        if (!(await this.db.projects.get(projectKey)))
          await this.db.projects.add({
            key: projectKey,
            accountId: owner,
            projectId: entry.projectId,
            title: null,
          })
      }
      await Dexie.waitFor(assertFixedBackupAdmission('conversations', key, next))
      await this.db.conversations.put(next)
      if (!stillAuthorized()) throw Error('Project association authorization expired')
      changed = true
    })
    return changed
  }
  async recordPageEvidence(
    conversationId: string,
    page: HistoryPageEvidence,
    headId: string | null,
    stillAuthorized = () => true,
    context?: { projectId: string | null; title: string | null },
  ) {
    if (!nonEmpty(conversationId)) throw Error('Invalid page evidence conversation')
    const owner = this.scope.ownerId
    if (!owner) throw Error('Verified page evidence owner required')
    const key = JSON.stringify([owner, conversationId])
    await this.db.transaction(
      'rw',
      this.db.projects,
      this.db.conversations,
      this.db.messages,
      async () => {
        if (!stillAuthorized()) throw Error('Page evidence authorization expired')
        let current = await this.db.conversations.get(key)
        if (!current) {
          const projectId = context?.projectId ?? null
          if (projectId && !nonEmpty(projectId)) throw Error('Invalid page evidence project')
          if (projectId) {
            const projectKey = JSON.stringify([owner, projectId])
            if (!(await this.db.projects.get(projectKey)))
              await this.db.projects.add({
                key: projectKey,
                accountId: owner,
                projectId,
                title: null,
              })
          }
          current = {
            key,
            accountId: owner,
            conversationId,
            projectId,
            title: nullableText(context?.title),
            revision: 0,
            instanceId: crypto.randomUUID(),
          }
        }
        const pages = current.pageEvidence ?? []
        const signature = JSON.stringify([
          page.readId,
          page.isInitial,
          page.requestedBefore,
          page.startCursor,
        ])
        const next = pages.filter(
          (item) =>
            JSON.stringify([item.readId, item.isInitial, item.requestedBefore, item.startCursor]) !==
            signature,
        )
        next.push(page)
        const newest = !pages.some(
          (item) =>
            item.isInitial &&
            (item.readStartedAt ?? item.observedAt) > (page.readStartedAt ?? page.observedAt),
        )
        const priorHead = current.currentHeadId
          ? await this.getMessage(conversationId, current.currentHeadId)
          : undefined
        const incomingHead = headId ? await this.getMessage(conversationId, headId) : undefined
        const olderHead = Boolean(
          priorHead &&
            incomingHead &&
            (priorHead.projection.sourceUpdateTime ?? priorHead.projection.sourceCreateTime ?? 0) >
              (incomingHead.projection.sourceUpdateTime ??
                incomingHead.projection.sourceCreateTime ??
                0),
        )
        let pageCoverage = advanceHistoryCoverage(current.pageCoverage, page)
        if (page.isInitial)
          for (const retained of next)
            if (!retained.isInitial) pageCoverage = advanceHistoryCoverage(pageCoverage, retained)
        const nextHeader = {
          ...current,
          pageEvidence: next.slice(-96),
          pageCoverage: structuredClone(pageCoverage),
          revision: (current.revision ?? 0) + 1,
          instanceId: current.instanceId ?? crypto.randomUUID(),
          pageHeadId: page.isInitial && newest && headId ? headId : current.pageHeadId,
          currentHeadId:
            page.isInitial && newest && headId && !olderHead ? headId : current.currentHeadId,
        }
        await Dexie.waitFor(assertFixedBackupAdmission('conversations', key, nextHeader))
        await this.db.conversations.put(nextHeader)
        if (!stillAuthorized()) throw Error('Page evidence authorization expired')
      },
    )
  }
  async recordStreamHead(
    conversationId: string,
    raw: Record<string, unknown>,
    stillAuthorized = () => true,
    currentRunProof = false,
  ) {
    const author = raw.author as Record<string, unknown> | undefined
    if (
      typeof raw.id !== 'string' ||
      !['assistant', 'user'].includes(String(author?.role)) ||
      (raw.recipient !== undefined && raw.recipient !== null && raw.recipient !== 'all') ||
      (raw.channel !== undefined && raw.channel !== null && raw.channel !== 'final')
    )
      return
    const terminal =
      author?.role === 'assistant' && raw.end_turn === true && raw.status === 'finished_successfully'
    const key = JSON.stringify([this.scope.ownerId, conversationId])
    await this.db.transaction('rw', this.db.conversations, this.db.messages, async () => {
      if (!stillAuthorized()) throw Error('Stream head authorization expired')
      const header = await this.db.conversations.get(key)
      const incoming = await this.getMessage(conversationId, raw.id as string)
      const previous = header?.currentHeadId
        ? await this.getMessage(conversationId, header.currentHeadId)
        : undefined
      if (
        !currentRunProof &&
        previous &&
        incoming &&
        (previous.projection.sourceUpdateTime ?? previous.projection.sourceCreateTime ?? 0) >
          (incoming.projection.sourceUpdateTime ?? incoming.projection.sourceCreateTime ?? 0)
      )
        return
      let nextHeader: FixedConversation | undefined
      if (header && header.currentHeadId !== raw.id)
        nextHeader = {
          ...header,
          currentHeadId: raw.id as string,
          terminalHeadId: terminal ? (raw.id as string) : null,
          revision: (header?.revision ?? 0) + 1,
          instanceId: header?.instanceId ?? crypto.randomUUID(),
        }
      else if (header && terminal && header.terminalHeadId !== raw.id)
        nextHeader = {
          ...header,
          terminalHeadId: raw.id as string,
          revision: (header?.revision ?? 0) + 1,
          instanceId: header?.instanceId ?? crypto.randomUUID(),
        }
      if (nextHeader) {
        await Dexie.waitFor(assertFixedBackupAdmission('conversations', key, nextHeader))
        await this.db.conversations.put(nextHeader)
      }
      if (!stillAuthorized()) throw Error('Stream head authorization expired')
    })
  }
  async integrity(conversationId: string) {
    const header = await this.getConversation(conversationId)
    const projections: Pick<
      CanonicalMessageProjection,
      'messageId' | 'parentMessageId' | 'parentObserved'
    >[] = []
    let cursor: string | undefined
    while (true) {
      const page = await this.listMessages(conversationId, 500, cursor)
      projections.push(
        ...page.map(({ projection }) => ({
          messageId: projection.messageId,
          parentMessageId: projection.parentMessageId,
          parentObserved: projection.parentObserved,
        })),
      )
      if (page.length < 500) break
      cursor = page.at(-1)?.messageId
    }
    return conversationIntegrity(
      projections,
      header?.pageEvidence ?? [],
      header?.currentHeadId ?? null,
      header?.terminalHeadId ?? null,
      header?.pageHeadId ?? null,
      header?.pageCoverage,
    )
  }
  async branchPath(conversationId: string, tipId: string): Promise<readonly string[]> {
    const ownerId = this.scope.ownerId
    if (!ownerId) throw Error('Verified owner required')
    const parents = new Map<string, string | null>()
    await this.db.messages
      .where('[accountId+conversationId]')
      .equals([ownerId, conversationId])
      .each((row) => {
        parents.set(row.messageId, row.projection.parentMessageId)
      })
    if (!parents.has(tipId)) throw Error('archive.error.messageMissing')
    const path: string[] = [],
      seen = new Set<string>()
    let id: string | null = tipId
    while (id && parents.has(id) && !seen.has(id)) {
      seen.add(id)
      path.push(id)
      id = parents.get(id) ?? null
    }
    return path.reverse()
  }
  /** Derived provider context only. Unknown/conflicting native origins remain unknown. */
  async branchOrigin(
    conversationId: string,
  ): Promise<{ conversationId: string | null; title: string | null }> {
    let origin: string | null = null,
      title: string | null = null,
      titleConflict = false
    let cursor: string | undefined
    while (true) {
      const page = await this.listMessages(conversationId, 128, cursor)
      for (const row of page) {
        const snapshot = await this.getSourceSnapshot(conversationId, row.messageId)
        if (!snapshot) throw Error('Missing immutable branch source snapshot')
        const metadata = snapshot.raw.metadata
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue
        const context = metadata as Record<string, unknown>
        const candidate = context.branching_from_conversation_id
        if (typeof candidate !== 'string' || !candidate || candidate === conversationId) continue
        if (origin && origin !== candidate) return { conversationId: null, title: null }
        origin = candidate
        const candidateTitle = context.branching_from_conversation_title
        if (typeof candidateTitle === 'string' && candidateTitle) {
          if (title && title !== candidateTitle) titleConflict = true
          title ??= candidateTitle
        }
      }
      if (page.length < 128) break
      cursor = page.at(-1)?.messageId
    }
    return { conversationId: origin, title: titleConflict ? null : title }
  }

  async messageWindow(conversationId: string, messageId: string): Promise<FixedMessage[]> {
    const target = await this.getMessage(conversationId, messageId)
    if (!target) throw Error('archive.error.messageMissing')
    const [before, after] = await Promise.all([
      this.windowMessages(conversationId, 'older', messageId, 80),
      this.windowMessages(conversationId, 'newer', messageId, 80),
    ])
    return [...before, target, ...after]
  }
  async messageRangeIds(
    conversationId: string,
    firstId: string,
    lastId: string,
  ): Promise<readonly string[]> {
    try {
      return (
        await collectArchiveRange(
          await this.chronologicalIds(conversationId),
          { firstId, lastId },
          (id) => id,
        )
      ).messageIds
    } catch {
      throw Error('archive.error.messageMissing')
    }
  }
  async timelineMessages(conversationId: string): Promise<readonly FixedTimelineMessage[]> {
    if (!this.scope.ownerId || !nonEmpty(conversationId)) throw Error('Verified timeline required')
    const result: FixedTimelineMessage[] = []
    await this.db.messages
      .where('[accountId+conversationId]')
      .equals([this.scope.ownerId, conversationId])
      .each((row) => {
        const projection = row.projection
        result.push({
          id: row.messageId,
          parentId: projection.parentMessageId,
          parentKnown: projection.parentObserved,
          role: projection.role,
          channel: projection.channel,
          recipient: projection.recipient,
          preview: (projection.elements.find((element) => element.text)?.text ?? '').slice(0, 160),
          sourceCreateTime: projection.sourceCreateTime,
        })
      })
    return result.sort(
      (a, b) =>
        (a.sourceCreateTime ?? Number.POSITIVE_INFINITY) -
          (b.sourceCreateTime ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id),
    )
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
    if (
      !nonEmpty(conversationId) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      (afterMessageId !== undefined && !nonEmpty(afterMessageId))
    )
      throw Error('Invalid canonical page')
    const account = this.scope.ownerId
    if (!account) throw Error('Owner not verified')
    const start = [account, conversationId, afterMessageId ?? '']
    const end = [account, conversationId, '\uffff']
    return this.db.messages
      .where('[accountId+conversationId+messageId]')
      .between(start, end, afterMessageId === undefined, false)
      .limit(limit)
      .toArray()
  }

  /** Stable source-ID cursor, independent of provider timestamp inference. */
  async workspaceChunk(conversationId: string, afterId?: string, limit = 160) {
    if (!nonEmpty(conversationId) || !Number.isInteger(limit) || limit < 1 || limit > 160)
      throw Error('Invalid workspace chunk')
    return this.db.transaction(
      'r',
      this.db.conversations,
      this.db.messages,
      this.db.snapshots,
      async () => {
        const header = await this.db.conversations.get(
          JSON.stringify([this.scope.ownerId, conversationId]),
        )
        const candidates = await this.listMessages(conversationId, limit + 1, afterId)
        const rows = candidates.slice(0, limit)
        const snapshots = await this.db.snapshots.bulkGet(rows.map((row) => row.key))
        return {
          header,
          rows: rows.map((row, index) => {
            const source = snapshots[index]
            if (!source) throw Error('Workspace source missing')
            validateChatGptNormalizedSnapshot(
              source,
              conversationId,
              source.projectId === undefined
                ? header
                  ? originalConversationProject(header)
                  : null
                : source.projectId,
            )
            return {
              id: row.messageId,
              raw: source.raw,
              normalized: source.normalized,
              observedAtMs: source.observedAtMs,
            }
          }),
          cursor: rows.at(-1)?.messageId,
          hasMore: candidates.length > limit,
        }
      },
    )
  }
  async windowMessages(
    conversationId: string,
    direction: 'older' | 'newer' | 'first' | 'middle',
    cursorId?: string,
    limit = 160,
  ): Promise<FixedMessage[]> {
    const owner = this.scope.ownerId
    if (
      !owner ||
      !nonEmpty(conversationId) ||
      (cursorId !== undefined && !nonEmpty(cursorId)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 240
    )
      throw Error('Invalid saved archive window')
    const plan = await this.chronologyPlan(conversationId)
    const ids = plan.ids
    const cursor = cursorId ? (plan.positions.get(cursorId) ?? -1) : -1
    if (cursorId && cursor < 0) throw Error('archive.error.messageMissing')
    if (direction === 'middle') {
      const start = Math.max(0, Math.floor((ids.length - limit) / 2))
      return this.readPlannedRows(conversationId, plan, start, start + limit)
    }
    const end =
      direction === 'first'
        ? Math.min(limit, ids.length)
        : direction === 'older'
          ? cursorId
            ? cursor
            : ids.length
          : Math.min(ids.length, cursor + 1 + limit)
    const start =
      direction === 'first' ? 0 : direction === 'older' ? Math.max(0, end - limit) : cursor + 1
    return this.readPlannedRows(conversationId, plan, start, end)
  }

  private async readPlannedRows(
    conversationId: string,
    plan: ChronologyPlan,
    start: number,
    end: number,
  ) {
    const owner = this.scope.ownerId
    return this.db.transaction('r', this.db.conversations, this.db.messages, async () => {
      const header = await this.db.conversations.get(JSON.stringify([owner, conversationId]))
      if (fixedConversationStamp(header) !== plan.stamp) throw Error('archive.error.sourceChanged')
      const rows = await this.db.messages.bulkGet(
        plan.ids.slice(start, end).map((id) => JSON.stringify([owner, conversationId, id])),
      )
      if (rows.some((row) => !row)) throw Error('archive.error.sourceChanged')
      return rows as FixedMessage[]
    })
  }

  /** Schema-v1 has no timestamp index. Scan only lightweight order facts and
   * materialize a bounded message window; never treat random UUID order as time. */
  private async chronologicalIds(conversationId: string): Promise<readonly string[]> {
    return (await this.chronologyPlan(conversationId)).ids
  }
  private async chronologyPlan(conversationId: string): Promise<ChronologyPlan> {
    const ownerId = this.scope.ownerId
    if (!ownerId || !nonEmpty(conversationId)) throw Error('Verified conversation required')
    const stamp = fixedConversationStamp(await this.getConversation(conversationId))
    const cached = this.orderPlans.get(conversationId)
    if (cached?.stamp === stamp) {
      this.orderPlans.delete(conversationId)
      this.orderPlans.set(conversationId, cached)
      return cached.pending
    }
    const pending = this.db.transaction('r', this.db.conversations, this.db.messages, async () => {
      const header = await this.db.conversations.get(JSON.stringify([ownerId, conversationId]))
      if (fixedConversationStamp(header) !== stamp) throw Error('archive.error.sourceChanged')
      const facts: { id: string; time: number | null }[] = []
      await this.db.messages
        .where('[accountId+conversationId]')
        .equals([ownerId, conversationId])
        .each((row) => {
          facts.push({ id: row.messageId, time: row.projection.sourceCreateTime })
        })
      facts.sort(
        (a, b) =>
          (a.time ?? Number.POSITIVE_INFINITY) - (b.time ?? Number.POSITIVE_INFINITY) ||
          a.id.localeCompare(b.id),
      )
      const ids = facts.map((fact) => fact.id)
      return { stamp, ids, positions: new Map(ids.map((id, index) => [id, index])) }
    })
    const entry = { stamp, pending }
    this.orderPlans.delete(conversationId)
    this.orderPlans.set(conversationId, entry)
    while (this.orderPlans.size > 8) {
      const oldest = this.orderPlans.keys().next().value
      if (oldest !== undefined) this.orderPlans.delete(oldest)
    }
    try {
      return await pending
    } catch (error) {
      if (this.orderPlans.get(conversationId) === entry) this.orderPlans.delete(conversationId)
      throw error
    }
  }

  async hasMessageBoundary(conversationId: string, messageId: string, side: 'before' | 'after') {
    const owner = this.scope.ownerId
    if (!owner || !nonEmpty(conversationId) || !nonEmpty(messageId))
      throw Error('Saved archive boundary unverified')
    const plan = await this.chronologyPlan(conversationId),
      index = plan.positions.get(messageId) ?? -1
    return index >= 0 && (side === 'before' ? index > 0 : index < plan.ids.length - 1)
  }
  /** Exact counts of saved projections for the selected verified conversation.
   * A cursor walks message rows; do not claim this proves full remote history. */
  async savedConversationStats(conversationId: string): Promise<{
    messages: number
    internalElements: number
    toolCalls: number
    reasoning: number
  }> {
    const owner = this.scope.ownerId
    if (!owner || !nonEmpty(conversationId)) throw Error('Verified conversation required')
    const result = { messages: 0, internalElements: 0, toolCalls: 0, reasoning: 0 }
    await this.db.messages
      .where('[accountId+conversationId]')
      .equals([owner, conversationId])
      .each((row) => {
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
    return this.db.messages
      .where('[accountId+conversationId]')
      .equals([this.scope.ownerId, conversationId])
      .count()
  }

  async getSourceSnapshot(
    conversationId: string,
    messageId: string,
  ): Promise<FixedSnapshot | undefined> {
    if (!nonEmpty(conversationId) || !nonEmpty(messageId)) throw Error('Invalid source identity')
    const account = this.scope.ownerId
    if (!account) throw Error('Owner not verified')
    const expectedKey = JSON.stringify([account, conversationId, messageId])
    const snapshot = await this.db.snapshots.get(expectedKey)
    if (!snapshot) return undefined
    if (
      snapshot.accountId !== account ||
      snapshot.messageKey !== expectedKey ||
      snapshot.raw.id !== messageId
    )
      throw Error('Canonical source identity mismatch')
    const header = await this.getConversation(conversationId)
    const projectId =
      snapshot.projectId === undefined
        ? header
          ? originalConversationProject(header)
          : null
        : snapshot.projectId
    const normalized = readChatGptArchiveMessage(
      snapshot.raw,
      {
        ownerId: account,
        conversationId,
        projectId,
        sourceKind: snapshot.sourceKind,
        sourceVersion: snapshot.sourceVersion,
        observedAtMs: snapshot.observedAtMs,
      },
      snapshot.normalized,
    )
    return { ...snapshot, projectId, normalized }
  }

  async messageVersions(
    conversationId: string,
    messageId: string,
  ): Promise<readonly FixedSourceVersion[]> {
    const ownerId = this.scope.ownerId
    if (!ownerId) throw Error('Verified owner required')
    const snapshot = await this.getSourceSnapshot(conversationId, messageId)
    const versions = snapshot
      ? (snapshot.versions ?? [
          {
            sourceKind: snapshot.sourceKind,
            sourceVersion: snapshot.sourceVersion,
            observedAtMs: snapshot.observedAtMs,
            decision: 'initial' as const,
            raw: snapshot.raw,
          },
        ])
      : []
    return versions.map((version, index) => ({
      ...version,
      normalized: readChatGptArchiveMessage(
        version.raw,
        {
          ownerId,
          conversationId,
          projectId: version.projectId === undefined ? (snapshot?.projectId ?? null) : version.projectId,
          sourceKind: version.sourceKind,
          sourceVersion: version.sourceVersion,
          observedAtMs: version.observedAtMs,
          variantIndex: index,
        },
        version.normalized,
      ),
    }))
  }

  async counts(): Promise<{
    projects: number
    conversations: number
    messages: number
    elements: number
    snapshots: number
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
  backupPort(
    authorize: () => void = () => undefined,
    hooks: { beforeCommit?: () => void | Promise<void> } = {},
  ): PortableBackupIndexedPort {
    const self = this
    const owner = this.scope.ownerId
    if (!owner) throw Error('Verified ChatGPT owner required for recovery')
    const stores = ['projects', 'conversations', 'messages', 'elements', 'snapshots'] as const
    const tables = stores.map((name) => ({ name, table: self.db[name] }))
    const schema = Object.fromEntries(
      tables.map(({ name, table }) => [
        name,
        {
          primaryKey: table.schema.primKey.src,
          indexes: table.schema.indexes.map((index) => index.src),
        },
      ]),
    )
    const countRows = async (transaction?: Transaction) =>
      Object.fromEntries(
        await Promise.all(
          tables.map(
            async ({ name, table }) =>
              [
                name,
                await (transaction?.table(name) ?? table).where('accountId').equals(owner).count(),
              ] as const,
          ),
        ),
      )
    const keyOwner = (name: (typeof stores)[number], key: string): unknown => {
      try {
        const parts: unknown = JSON.parse(key)
        if (!Array.isArray(parts)) return null
        if (name !== 'elements') return parts[0]
        if (typeof parts[0] !== 'string') return null
        const message: unknown = JSON.parse(parts[0])
        return Array.isArray(message) ? message[0] : null
      } catch {
        return null
      }
    }
    const ownedKeyPages = async function* (
      name: (typeof stores)[number],
      limit: number,
      transaction?: Transaction,
    ) {
      const table = transaction?.table(name) ?? self.db[name],
        keyField = table.schema.primKey.name
      if (!keyField) throw Error('Missing canonical primary key')
      let cursor: string | undefined
      while (true) {
        authorize()
        const keys =
          cursor === undefined
            ? await table.orderBy(keyField).limit(limit).primaryKeys()
            : await table.where(keyField).above(cursor).limit(limit).primaryKeys()
        const owned: string[] = []
        for (const key of keys) {
          if (typeof key !== 'string') throw Error('Invalid canonical primary key type')
          cursor = key
          // Inspect only canonical keys of sibling owners, never their values.
          if (keyOwner(name, key) === owner) owned.push(key)
        }
        if (owned.length) yield owned
        if (keys.length < limit) break
      }
    }
    const sourceStamp = async (transaction?: Transaction) => {
      authorize()
      let digest = 'chatgpt-recovery-revisions-v1',
        facts: string[] = []
      const flush = async () => {
        if (!facts.length) return
        digest = await archiveSha256Hex(`${digest}\n${facts.join('\n')}`)
        facts = []
      }
      const add = async (fact: unknown) => {
        facts.push(sourceFingerprint(fact))
        if (facts.length === 128) await flush()
      }
      // Projects can exist without a conversation. Include their small canonical
      // metadata because no conversation revision can fence that special case.
      for await (const keys of ownedKeyPages('projects', 128, transaction)) {
        const page: (FixedProject | undefined)[] = await (
          transaction?.table('projects') ?? self.db.projects
        ).bulkGet(keys)
        for (const row of page) {
          if (!row || row.accountId !== owner)
            throw Error('Canonical project changed during revision scan')
          await add(['project', row.key, row.projectId, row.title])
        }
        authorize()
      }
      await flush()
      for await (const keys of ownedKeyPages('conversations', 128, transaction)) {
        const page: (FixedConversation | undefined)[] = await (
          transaction?.table('conversations') ?? self.db.conversations
        ).bulkGet(keys)
        for (const row of page) {
          if (!row || row.accountId !== owner)
            throw Error('Canonical conversation changed during revision scan')
          await add(['conversation', row.key, fixedConversationStamp(row)])
        }
        authorize()
      }
      await flush()
      const counts = await countRows(transaction)
      authorize()
      return archiveSha256Hex(`${digest}\n${JSON.stringify(counts)}`)
    }
    const deleteOwned = async (table: Table<FixedBackupModel, string>) => {
      while (true) {
        authorize()
        const keys = await table.where('accountId').equals(owner).limit(256).primaryKeys()
        if (!keys.length) break
        await table.bulkDelete(keys)
      }
    }
    const beforeCommit = async () => {
      authorize()
      await Dexie.waitFor(Promise.resolve(hooks.beforeCommit?.()))
      authorize()
    }
    const validatedStages = new WeakMap<
      PortableBackupReader,
      { stamp: string; counts: FixedBackupCounts }
    >()
    const validateStagedRows = async (reader: PortableBackupReader) => {
      authorize()
      const prior = validatedStages.get(reader)
      const stamp = await sourceStamp()
      if (prior && prior.stamp !== stamp)
        throw Error('Canonical source changed since staged recovery preflight')
      const counts = await validateFixedStagedBackup(reader, owner, authorize)
      if ((await sourceStamp()) !== stamp)
        throw Error('Canonical source changed during staged recovery validation')
      authorize()
      validatedStages.set(reader, { stamp, counts })
    }
    const restoreStagedAtomically = async (reader: PortableBackupReader) => {
      if (!validatedStages.has(reader)) await validateStagedRows(reader)
      const validation = validatedStages.get(reader)
      if (!validation) throw Error('Staged recovery validation unavailable')
      authorize()
      if ((await sourceStamp()) !== validation.stamp)
        throw Error('Canonical source changed before staged recovery activation')
      let committedStamp: string | undefined
      await self.db.transaction(
        'rw',
        self.db.projects,
        self.db.conversations,
        self.db.messages,
        self.db.elements,
        self.db.snapshots,
        async () => {
          const transaction = Dexie.currentTransaction
          if (!transaction) throw Error('Missing canonical recovery transaction')
          const transactionalTables = stores.map((name) => ({
            name,
            table: transaction.table<FixedBackupModel, string>(name),
          }))
          return Dexie.waitFor(
            (async () => {
              authorize()
              // Async iterators and WebCrypto may leave Dexie's implicit PSD context.
              // Bind reads to this transaction so they cannot wait behind its own write lock.
              if ((await Dexie.waitFor(sourceStamp(transaction))) !== validation.stamp)
                throw Error('Canonical source changed before recovery transaction')
              // Deletion is itself bounded: Dexie's unbounded Collection.delete()
              // materializes all matching primary keys before its internal batching.
              for (const { name, table } of transactionalTables)
                if (name !== 'conversations') await deleteOwned(table)
              // Retain only matching headers until their old revision has been read.
              // There is no archive-wide previous-revision map.
              for await (const keys of ownedKeyPages('conversations', 128, transaction)) {
                const page: (FixedConversation | undefined)[] = await transaction
                  .table('conversations')
                  .bulkGet(keys)
                const remove: string[] = []
                for (const header of page) {
                  if (!header || header.accountId !== owner)
                    throw Error('Canonical header changed during recovery')
                  const staged = await Dexie.waitFor(
                    Dexie.ignoreTransaction(() => reader.get('conversations', header.key)),
                  )
                  if (!staged) remove.push(header.key)
                  else if (staged.store !== 'conversations' || staged.key !== header.key)
                    throw Error('Staged conversation lookup changed')
                  authorize()
                }
                if (remove.length) await transaction.table('conversations').bulkDelete(remove)
              }
              const actual: FixedBackupCounts = {
                projects: 0,
                conversations: 0,
                messages: 0,
                elements: 0,
                snapshots: 0,
              }
              for (const { name, table } of transactionalTables) {
                const iterator = reader.readRows(name)[Symbol.asyncIterator]()
                let finished = false,
                  previous = ''
                try {
                  while (!finished) {
                    // External temporary-DB awaits must not auto-commit this active
                    // archive transaction, nor inherit its Dexie transaction context.
                    const batch = await Dexie.waitFor(
                      Dexie.ignoreTransaction(async () => {
                        const rows: PortableBackupRow[] = []
                        let chars = 0
                        while (rows.length < 256 && chars < 2 * 1024 * 1024) {
                          const next = await iterator.next()
                          if (next.done) {
                            finished = true
                            break
                          }
                          chars += JSON.stringify(next.value).length
                          rows.push(next.value)
                        }
                        return rows
                      }),
                    )
                    authorize()
                    let decoded: FixedBackupModel[] = [],
                      allocation = 0
                    const flush = async () => {
                      if (!decoded.length) return
                      if (name === 'conversations') {
                        const headers = decoded as FixedConversation[]
                        const previousRows: (FixedConversation | undefined)[] = await transaction
                          .table('conversations')
                          .bulkGet(headers.map((header) => header.key))
                        for (const [index, header] of headers.entries()) {
                          const revision =
                            Math.max(header.revision ?? 0, previousRows[index]?.revision ?? 0) + 1
                          if (!Number.isSafeInteger(revision))
                            throw Error('Canonical conversation revision overflow')
                          headers[index] = { ...header, revision, instanceId: crypto.randomUUID() }
                          await Dexie.waitFor(
                            assertFixedBackupAdmission('conversations', header.key, headers[index]),
                          )
                        }
                      }
                      await (table as Table<FixedBackupModel, string>).bulkPut(decoded)
                      actual[name] += decoded.length
                      if (actual[name] > validation.counts[name])
                        throw Error('Staged activation count changed')
                      decoded = []
                      allocation = 0
                    }
                    for (const row of batch) {
                      if (row.store !== name) throw Error('Wrong staged recovery store')
                      const token = JSON.stringify([row.store, row.key])
                      if (previous && token <= previous)
                        throw Error('Duplicate or unordered staged activation row')
                      previous = token
                      const cost = assertFixedBackupCodecBudget(row.value)
                      if (decoded.length && allocation + cost > 4 * 1024 * 1024) await flush()
                      decoded.push(decodeFixedBackupRow(row, owner))
                      allocation += cost
                      if (allocation >= 4 * 1024 * 1024) await flush()
                    }
                    await flush()
                  }
                } finally {
                  const close = iterator.return?.bind(iterator)
                  if (!finished && close) await Dexie.waitFor(Dexie.ignoreTransaction(close))
                }
              }
              if (
                JSON.stringify(actual) !== JSON.stringify(validation.counts) ||
                JSON.stringify(await countRows(transaction)) !== JSON.stringify(validation.counts)
              )
                throw Error('Staged activation graph count mismatch')
              committedStamp = await Dexie.waitFor(sourceStamp(transaction))
              await beforeCommit()
            })(),
            Infinity,
          )
        },
      )
      validatedStages.delete(reader)
      self.orderPlans.clear()
      self.observationDigests.clear()
      authorize()
      if ((await sourceStamp()) !== committedStamp)
        throw Error('Canonical source changed after recovery activation')
    }
    const validateRows = async (rows: readonly PortableBackupRow[]) => {
      authorize()
      type Model = FixedProject | FixedConversation | FixedMessage | FixedElement | FixedSnapshot
      const buckets: Record<(typeof stores)[number], Model[]> = {
        projects: [],
        conversations: [],
        messages: [],
        elements: [],
        snapshots: [],
      }
      const keys: Record<(typeof stores)[number], Set<string>> = {
        projects: new Set(),
        conversations: new Set(),
        messages: new Set(),
        elements: new Set(),
        snapshots: new Set(),
      }
      const obj = (value: unknown): value is Record<string, unknown> =>
        value !== null && typeof value === 'object' && !Array.isArray(value)
      const tuple = (key: string, size: number): string[] => {
        const parsed: unknown = JSON.parse(key)
        if (
          !Array.isArray(parsed) ||
          parsed.length !== size ||
          parsed[0] !== owner ||
          !parsed.every((v) => nonEmpty(v as string))
        )
          throw Error('Invalid canonical key')
        return parsed as string[]
      }
      for (const row of rows) {
        if (!stores.includes(row.store as (typeof stores)[number]))
          throw Error('Unknown canonical recovery table')
        const store = row.store as (typeof stores)[number]
        // The retained array port observes the same wire/allocation admission
        // as staged restoration and future capture.
        serializedBackupRow({ key: JSON.stringify([store, row.key]), value: row.value })
        assertFixedBackupCodecBudget(row.value)
        const value: unknown = decodeArchiveClone(row.value)
        if (!obj(value) || value.accountId !== owner || keys[store].has(row.key))
          throw Error('Duplicate or wrong-owner canonical recovery row')
        const keyField =
          store === 'elements' ? 'elementId' : store === 'snapshots' ? 'messageKey' : 'key'
        if (value[keyField] !== row.key || !row.key || row.key.length > 1024)
          throw Error('Canonical primary key mismatch')
        if (store === 'projects') {
          const parts = tuple(row.key, 2)
          if (value.projectId !== parts[1] || (value.title !== null && typeof value.title !== 'string'))
            throw Error('Invalid project recovery record')
        } else if (store === 'conversations') {
          if (value.pageCoverage !== undefined) validateHistoryCoverageCheckpoint(value.pageCoverage)
          const parts = tuple(row.key, 2)
          if (
            value.conversationId !== parts[1] ||
            (value.projectId !== null && !nonEmpty(value.projectId as string)) ||
            (value.title !== null && typeof value.title !== 'string')
          )
            throw Error('Invalid conversation recovery record')
          validateProjectAssociations(value as unknown as FixedConversation)
          if (
            value.revision !== undefined &&
            (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)
          )
            throw Error('Invalid conversation revision')
          if (
            value.instanceId !== undefined &&
            (typeof value.instanceId !== 'string' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.instanceId))
          )
            throw Error('Invalid conversation instance identity')
          for (const field of ['currentHeadId', 'terminalHeadId', 'pageHeadId'] as const)
            if (value[field] !== undefined && value[field] !== null && !nonEmpty(value[field] as string))
              throw Error('Invalid saved head evidence')
          if (value.pageEvidence !== undefined) {
            if (!Array.isArray(value.pageEvidence)) throw Error('Invalid page evidence')
            for (const page of value.pageEvidence) {
              if (
                !obj(page) ||
                !Number.isFinite(page.observedAt) ||
                (page.observedAt as number) < 0 ||
                ![true, false, null].includes(page.hasPreviousPage as boolean | null) ||
                ![true, false, null].includes(page.hasNextPage as boolean | null) ||
                (page.startCursor !== null && typeof page.startCursor !== 'string') ||
                (page.endCursor !== null && typeof page.endCursor !== 'string')
              )
                throw Error('Invalid page evidence record')
            }
          }
        } else if (store === 'messages') {
          const parts = tuple(row.key, 3)
          const projection = value.projection
          if (
            value.conversationId !== parts[1] ||
            value.messageId !== parts[2] ||
            value.modelVersion !== ARCHIVE_CANONICAL_MODEL_VERSION ||
            !obj(projection) ||
            projection.accountId !== owner ||
            projection.conversationId !== parts[1] ||
            projection.messageId !== parts[2] ||
            projection.messageKey !== row.key ||
            projection.modelVersion !== ARCHIVE_CANONICAL_MODEL_VERSION ||
            !Array.isArray(projection.elements)
          )
            throw Error('Invalid message recovery projection')
        } else if (store === 'elements') {
          if (
            typeof value.messageKey !== 'string' ||
            !Number.isSafeInteger(value.siblingOrder) ||
            (value.siblingOrder as number) < 0 ||
            !nonEmpty(value.kind as string) ||
            !nonEmpty(value.visibility as string) ||
            typeof value.sourcePath !== 'string'
          )
            throw Error('Invalid canonical element')
        } else {
          const parts = tuple(row.key, 3)
          if (
            !obj(value.raw) ||
            value.raw.id !== parts[2] ||
            !nonEmpty(value.sourceKind as string) ||
            !nonEmpty(value.sourceVersion as string) ||
            !Number.isSafeInteger(value.observedAtMs) ||
            (value.observedAtMs as number) < 0
          )
            throw Error('Invalid source snapshot recovery record')
          if (
            value.sourceEvents !== undefined &&
            (!Array.isArray(value.sourceEvents) || !value.sourceEvents.every(obj))
          )
            throw Error('Invalid source event evidence')
          if (value.versions !== undefined) {
            if (!Array.isArray(value.versions) || !value.versions.length)
              throw Error('Invalid source versions')
            for (const version of value.versions) {
              if (
                !obj(version) ||
                !obj(version.raw) ||
                version.raw.id !== parts[2] ||
                !nonEmpty(version.sourceKind as string) ||
                !nonEmpty(version.sourceVersion as string) ||
                !Number.isSafeInteger(version.observedAtMs) ||
                (version.observedAtMs as number) < 0 ||
                !['initial', 'advance', 'identical', 'stale', 'conflict'].includes(
                  String(version.decision),
                )
              )
                throw Error('Invalid source version evidence')
              if (
                version.projectId !== undefined &&
                version.projectId !== null &&
                !nonEmpty(version.projectId as string)
              )
                throw Error('Invalid source version project context')
              if (
                version.sourceEvents !== undefined &&
                (!Array.isArray(version.sourceEvents) || !version.sourceEvents.every(obj))
              )
                throw Error('Invalid source version event evidence')
            }
          }
          if (
            value.projectId !== undefined &&
            value.projectId !== null &&
            !nonEmpty(value.projectId as string)
          )
            throw Error('Invalid source project context')
          const conversationId = parts[1]
          if (!conversationId) throw Error('Missing canonical conversation identity')
          validateChatGptNormalizedSnapshot(value as unknown as FixedSnapshot, conversationId)
        }
        keys[store].add(row.key)
        buckets[store].push(value as unknown as Model)
      }
      const projects = keys.projects,
        conversations = keys.conversations
      const messages = new Map((buckets.messages as FixedMessage[]).map((m) => [m.key, m]))
      const conversationHeaders = new Map(
        (buckets.conversations as FixedConversation[]).map((header) => [header.key, header]),
      )
      const snapshots = keys.snapshots,
        elements = keys.elements
      for (const c of buckets.conversations as FixedConversation[]) {
        if (c.projectId && !projects.has(JSON.stringify([owner, c.projectId])))
          throw Error('Unresolved canonical recovery project')
        for (const entry of c.projectAssociations ?? [])
          for (const projectId of [entry.previousProjectId, entry.projectId])
            if (projectId && !projects.has(JSON.stringify([owner, projectId])))
              throw Error('Unresolved canonical historic project association')
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
        const message = messages.get(snap.messageKey)
        if (!message) throw Error('Orphan canonical snapshot')
        if (
          sourceFingerprint(
            projectNativeMessage(snap.raw, { accountId: owner, conversationId: message.conversationId }),
          ) !== sourceFingerprint(message.projection)
        )
          throw Error('Canonical projection disagrees with source evidence')
        const header = conversationHeaders.get(JSON.stringify([owner, message.conversationId]))
        if (!header) throw Error('Canonical conversation missing')
        const sourceProject =
          snap.projectId === undefined ? originalConversationProject(header) : snap.projectId
        if (
          !sourceProjectBelongsToConversation(header, sourceProject) ||
          snap.versions?.some(
            (version) =>
              version.projectId !== undefined &&
              !sourceProjectBelongsToConversation(header, version.projectId),
          )
        )
          throw Error('Normalized source project disagrees with conversation')
        validateChatGptNormalizedSnapshot(snap, message.conversationId, sourceProject)
      }
      const sourceByKey = new Map(
        (buckets.snapshots as FixedSnapshot[]).map((snap) => [snap.messageKey, snap]),
      )
      for (const conversation of buckets.conversations as FixedConversation[]) {
        if (!conversation.terminalHeadId) continue
        const source = sourceByKey.get(
          JSON.stringify([owner, conversation.conversationId, conversation.terminalHeadId]),
        )?.raw
        const author = source && obj(source.author) ? source.author : null
        if (
          !source ||
          author?.role !== 'assistant' ||
          source.end_turn !== true ||
          source.status !== 'finished_successfully' ||
          (source.recipient !== undefined && source.recipient !== null && source.recipient !== 'all') ||
          (source.channel !== undefined && source.channel !== null && source.channel !== 'final')
        )
          throw Error('Saved terminal head disagrees with assistant source evidence')
      }
      let expectedElements = 0
      for (const m of messages.values()) expectedElements += m.projection.elements.length
      if (elements.size !== expectedElements) throw Error('Orphan or duplicate canonical elements')
      const byId = new Map((buckets.elements as FixedElement[]).map((e) => [e.elementId, e]))
      for (const m of messages.values())
        for (const original of m.projection.elements) {
          const element = byId.get(original.elementId)
          if (
            !element ||
            element.messageKey !== m.key ||
            element.parentElementId !== original.parentElementId ||
            element.siblingOrder !== original.siblingOrder ||
            element.kind !== original.kind ||
            element.visibility !== original.visibility ||
            element.text !== original.text ||
            element.language !== original.language ||
            element.sourcePath !== original.sourcePath
          )
            throw Error('Canonical element projection disagrees with stored content')
        }

      authorize()
      return buckets
    }
    let exportSnapshotStamp: string | undefined
    let exportSnapshotComplete = false
    return {
      scope: this.scope,
      schemaVersion: 1,
      stores,
      schema,
      countRows,
      validateStagedRows,
      restoreStagedAtomically,
      async *readRows(pageSize: number) {
        exportSnapshotComplete = false
        if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 2048)
          throw Error('Invalid ChatGPT recovery page size')
        const before = await countRows()
        const stamp = await sourceStamp()
        if (exportSnapshotStamp !== undefined && exportSnapshotStamp !== stamp)
          throw Error('Canonical source changed since the original recovery export')
        exportSnapshotStamp ??= stamp
        const emitted: FixedBackupCounts = {
          projects: 0,
          conversations: 0,
          messages: 0,
          elements: 0,
          snapshots: 0,
        }
        for (const { name, table } of tables) {
          for await (const keys of ownedKeyPages(name, Math.min(pageSize, 256))) {
            for (const key of keys) {
              authorize()
              // A key page is small even when a version snapshot is several MiB.
              // Materialize one owned value at a time under sink backpressure.
              const value = await table.get(key)
              if (!value) throw Error('Canonical source row disappeared during recovery export')
              const data = value as unknown as Record<string, unknown>
              if (!key || key.length > 1024) throw Error('Invalid ChatGPT backup primary key')
              if (data.accountId !== owner)
                throw Error('Canonical source row owner disagrees with its key')
              const encoded = await encodeArchiveClone(
                name === 'snapshots' ? detachedFixedBackupSnapshot(value as FixedSnapshot) : value,
              )
              assertFixedBackupCodecBudget(encoded)
              emitted[name]++
              yield { store: name, key, value: encoded }
            }
          }
        }
        if (
          JSON.stringify(emitted) !== JSON.stringify(before) ||
          JSON.stringify(await countRows()) !== JSON.stringify(before) ||
          (await sourceStamp()) !== stamp
        )
          throw Error('Canonical source changed during recovery export')
        exportSnapshotComplete = true
      },
      async assertSnapshotCurrent() {
        authorize()
        if (!exportSnapshotComplete || exportSnapshotStamp === undefined)
          throw Error('Canonical export snapshot is incomplete')
        if ((await sourceStamp()) !== exportSnapshotStamp)
          throw Error('Canonical export snapshot changed')
        authorize()
      },
      async validateRows(rows: readonly PortableBackupRow[]) {
        await validateRows(rows)
      },
      async restoreAtomically(rows: readonly PortableBackupRow[]) {
        const stamp = await sourceStamp()
        const buckets = await validateRows(rows)
        if ((await sourceStamp()) !== stamp)
          throw Error('Canonical source changed during recovery validation')
        // One transaction replaces only the verified account; another owner shares no writable rows.
        await self.db.transaction(
          'rw',
          self.db.projects,
          self.db.conversations,
          self.db.messages,
          self.db.elements,
          self.db.snapshots,
          async () => {
            authorize()
            const transaction = Dexie.currentTransaction
            if (!transaction) throw Error('Canonical recovery transaction unavailable')
            if ((await Dexie.waitFor(sourceStamp(transaction))) !== stamp)
              throw Error('Canonical source changed before recovery transaction')
            const previous = new Map(
              (await self.db.conversations.where('accountId').equals(owner).toArray()).map((row) => [
                row.key,
                row.revision ?? 0,
              ]),
            )
            for (const { table } of tables) await deleteOwned(table as Table<FixedBackupModel, string>)
            if (buckets.projects.length)
              await self.db.projects.bulkAdd(buckets.projects as FixedProject[])
            if (buckets.conversations.length) {
              const headers = (buckets.conversations as FixedConversation[]).map((row) => ({
                ...row,
                revision: Math.max(row.revision ?? 0, previous.get(row.key) ?? 0) + 1,
                instanceId: crypto.randomUUID(),
              }))
              for (const header of headers)
                await Dexie.waitFor(assertFixedBackupAdmission('conversations', header.key, header))
              await self.db.conversations.bulkAdd(headers)
            }
            if (buckets.messages.length)
              await self.db.messages.bulkAdd(buckets.messages as FixedMessage[])
            if (buckets.elements.length)
              await self.db.elements.bulkAdd(buckets.elements as FixedElement[])
            if (buckets.snapshots.length)
              await self.db.snapshots.bulkAdd(buckets.snapshots as FixedSnapshot[])
            await beforeCommit()
          },
        )
        self.orderPlans.clear()
        self.observationDigests.clear()
      },
    }
  }

  close(): void {
    this.orderPlans.clear()
    this.observationDigests.clear()
    this.db.close()
  }
}
