import {
  currentConversationId,
  hasConversationDraft,
  hasPendingComposerAttachments,
} from '@chatgpt-booster/chatgpt'
import type { ArchiveExportOptions, ArchiveExportProgressListener } from '@chatgpt-booster/core'
import {
  ARCHIVE_UPDATED_EVENT,
  type BoosterModule,
  type BoosterSettings,
  captureRuleForOperation,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import {
  type ArchiveChangeFeed,
  type ArchiveMessageV1,
  archiveSha256Hex,
  createArchiveChangeFeed,
  createGzipFromChunks,
  encodeArchiveClone,
} from '@kobaproduction/browser-archive'
import { instanceScope } from '@kobaproduction/browser-core'
import type {
  PortableBackupIndexedPort,
  PortableBackupReader,
  PortableBackupRow,
} from '@kobaproduction/browser-storage'
import type { DexieOptions } from 'dexie'
import type { ArchiveCollectionRun, ArchiveCollectionSession } from './archive-collection-session'
import { checkpointHistoryCoverage, historyCoverage, nativePageEvidence } from './archive-coverage'
import {
  FixedCanonicalDexieRepository,
  fixedConversationStamp,
  type SourceObservation,
} from './archive-fixed-dexie'
import { exportFixedConversation } from './archive-fixed-export'
import { sourceCloneDigest } from './archive-observation-policy'
import { retainRawSource } from './archive-record-retention'
import { detachSourceSnapshot } from './archive-source-snapshot'
import type {
  BufferedConversationSource,
  ConversationObservationEntry,
} from './conversation-observation-gateway'
import { normalizeConversationProjectId } from './conversation-records'
import type { ConversationStateStore, RejectedConversationSource } from './conversation-state'

export interface FixedChatGptView {
  currentConversationId(): string | null
  listCurrent(limit?: number): Promise<readonly { id: string; text: string; coverage: string }[]>
  exportCurrent(): Promise<Blob>
  savedCurrent(): Promise<number>
  savedCurrentSummary(): Promise<{
    messages: number
    internalElements: number
    toolCalls: number
    reasoning: number
  }>
  captureFailed(): boolean
  listSavedConversations(): Promise<
    readonly { conversationId: string; projectId: string | null; title: string | null }[]
  >
  listSavedProjects(): Promise<readonly { projectId: string; title: string | null }[]>
  readConversation(
    id: string,
    limit?: number,
  ): Promise<
    readonly {
      id: string
      raw: Record<string, unknown>
      normalized?: ArchiveMessageV1
      canonical: unknown
      observedAtMs: number
    }[]
  >
  exportConversation(id: string): Promise<Blob>
  exportUserConversation(
    id: string,
    options: ArchiveExportOptions,
    signal?: AbortSignal,
    progress?: ArchiveExportProgressListener,
  ): Promise<import('@chatgpt-booster/core').ArchiveExportOutcome>
  savedCount(id: string): Promise<number>
  hasMessagesBefore(id: string, cursor: string): Promise<boolean>
  hasMessagesAfter(id: string, cursor: string): Promise<boolean>
  windowConversation(
    id: string,
    direction: 'older' | 'newer' | 'first' | 'middle',
    cursorId?: string,
  ): Promise<
    readonly {
      id: string
      raw: Record<string, unknown>
      normalized?: ArchiveMessageV1
      observedAtMs: number
    }[]
  >
  collectCurrent(): Promise<void>
  stopCollection(): void
  subscribeSaved(listener: (conversationId: string | null) => void): () => void
  messageVersions(
    id: string,
    messageId: string,
  ): Promise<readonly import('./archive-fixed-dexie').FixedSourceVersion[]>
  backupPort(): PortableBackupIndexedPort
  sourceRevision(id: string): Promise<number>
  sourceInstanceId(id: string): Promise<string>
  branchPath(id: string, tipId: string): Promise<readonly string[]>
  rangeMessageIds(id: string, firstId: string, lastId: string): Promise<readonly string[]>
  timelineMessages(id: string): Promise<readonly import('./archive-fixed-dexie').FixedTimelineMessage[]>
  integrity(id: string): Promise<import('./archive-integrity').ConversationIntegrity>
  windowAroundMessage(
    id: string,
    messageId: string,
  ): Promise<
    readonly {
      id: string
      raw: Record<string, unknown>
      normalized?: ArchiveMessageV1
      observedAtMs: number
    }[]
  >
}
export interface ChatGptCommittedSource {
  scope: {
    productId: 'chatgpt-booster'
    channel: 'dev' | 'prod'
    installationId: string
    ownerId: string
  }
  observation: SourceObservation
  normalized?: ArchiveMessageV1
}
/** Remote-only source has not been committed to the local canonical archive. */
export type ChatGptRemoteSource =
  | ChatGptCommittedSource
  | {
      scope: ChatGptCommittedSource['scope']
      page: Omit<ConversationArchiveEventDetail, 'payload'> & { payload: Record<string, unknown> }
    }
export interface ChatGptCommitReceipt {
  accepted: boolean
}
export interface ChatGptRejectedSource {
  scope: ChatGptCommittedSource['scope']
  source: RejectedConversationSource
  reason: 'validation' | 'storage'
}
function scopeIdentity(label: string): { channel: 'dev' | 'prod'; installationId: string } {
  const compiled = instanceScope() || 'chatgpt-booster:prod'
  if (!/^(chatgpt-booster|all-in-one):(dev|prod)$/.test(compiled))
    throw Error('Unsupported ChatGPT installation scope')
  if (!['Tampermonkey', 'Chromium'].includes(label)) throw Error('Unknown browser adapter')
  return {
    channel: compiled.endsWith(':dev') ? 'dev' : 'prod',
    installationId: `${compiled.split(':')[0]}-${label.toLowerCase()}`,
  }
}

/** New native-history pages -> fixed Dexie v1. No legacy data scan or conversion. */
export class FixedChatGptCapture implements BoosterModule, FixedChatGptView {
  readonly id = 'fixed-dexie-capture'
  private unsubscribe: (() => void) | undefined
  private unsubscribeSettings: (() => void) | undefined
  private unsubscribeRejected: (() => void) | undefined
  private unsubscribeCatalog: (() => void) | undefined
  private readonly savedListeners = new Set<(conversationId: string | null) => void>()
  private readonly countListeners = new Set<() => void>()
  private readonly committedListeners = new Set<
    (source: ChatGptCommittedSource) => ChatGptCommitReceipt | Promise<ChatGptCommitReceipt>
  >()
  private readonly remoteSourceListeners = new Set<
    (source: ChatGptRemoteSource) => Promise<{ accepted: boolean }>
  >()
  private readonly rejectedSourceListeners = new Set<
    (source: ChatGptRejectedSource) => Promise<{ accepted: boolean }>
  >()
  private changeFeed: ArchiveChangeFeed | undefined
  private unsubscribeChanges: (() => void) | undefined
  private changedConversation: string | null = null
  private policyEpoch = 0
  private pending: Promise<void> = Promise.resolve()
  private deliveryPending: Promise<void> = Promise.resolve()
  private routingSignature: string | undefined
  private remoteDelivered = new Map<unknown, Set<string>>()
  private readonly repositories = new Map<string, FixedCanonicalDexieRepository>()
  private readonly branchOrigins = new Map<
    string,
    {
      stamp: string
      feedRevision: number
      value: { conversationId: string | null; title: string | null }
    }
  >()
  private stopped = true
  private generation = 0
  private readonly identity: ReturnType<typeof scopeIdentity>
  private failure: Error | undefined

  constructor(
    private readonly state: ConversationStateStore,
    private readonly settings: SettingsAdapter,
    targetLabel: string,
    readonly collectionSession: ArchiveCollectionSession,
    private readonly dbOptions?: DexieOptions,
  ) {
    this.identity = scopeIdentity(targetLabel)
  }
  private repo(owner: string): FixedCanonicalDexieRepository {
    let store = this.repositories.get(owner)
    if (!store) {
      store = new FixedCanonicalDexieRepository(
        {
          productId: 'chatgpt-booster',
          channel: this.identity.channel,
          installationId: this.identity.installationId,
          ownerId: owner,
        },
        this.dbOptions,
      )
      this.repositories.set(owner, store)
    }
    return store
  }
  start() {
    if (!this.stopped) return
    this.stopped = false
    this.generation++
    this.changeFeed = createArchiveChangeFeed(
      `koba-archive:${instanceScope() || 'chatgpt-booster:' + this.identity.channel}:chatgpt-booster`,
    )
    this.unsubscribeChanges = this.changeFeed.subscribe(() => {
      for (const listener of this.savedListeners) listener(this.changedConversation)
      if (this.changedConversation === null) for (const listener of this.countListeners) listener()
      window.dispatchEvent(new CustomEvent(ARCHIVE_UPDATED_EVENT))
    })
    this.unsubscribeSettings = this.settings.subscribe((settings) => {
      const signature = JSON.stringify([settings.enabled, settings.archive, settings.automation.remote])
      if (signature === this.routingSignature) return
      this.routingSignature = signature
      this.policyEpoch++
      this.enqueueProjects()
      this.replayBuffered()
    })
    this.unsubscribeCatalog = this.state.subscribeCatalog((detail) => {
      if (detail.projects?.length) this.enqueueProjects(detail.projects.map((item) => item.projectId))
    })
    this.enqueueProjects()
    this.unsubscribeRejected = this.state.subscribeRejectedSource((detail) => {
      const owner = this.state.verifiedAccountId(),
        epoch = this.state.accountEpoch()
      if (!owner || owner !== detail.accountId) return
      this.pending = this.pending
        .then(async () => {
          if (
            this.stopped ||
            this.state.accountEpoch() !== epoch ||
            this.state.verifiedAccountId() !== owner
          )
            return
          await this.rejectedSource(
            detail,
            'validation',
            () =>
              !this.stopped &&
              this.state.accountEpoch() === epoch &&
              this.state.verifiedAccountId() === owner,
          )
        })
        .catch(() => undefined)
    })
    const enqueue = (page: ConversationArchiveEventDetail) => {
      const owner = this.state.verifiedAccountId()
      const epoch = this.state.accountEpoch()
      const policy = this.policyEpoch
      if (!owner || (page.accountId !== undefined && page.accountId !== owner)) return
      this.pending = this.pending
        .then(() => this.capture(page, owner, epoch))
        .catch((error) => {
          if (this.stopped || this.state.accountEpoch() !== epoch || this.policyEpoch !== policy) return
          this.failure = error instanceof Error ? error : Error('Fixed Dexie capture failed')
          // Do not print source messages, URLs or confidential exception text.
          console.warn('[ChatGPT Booster] Fixed archive capture:', this.failure.name)
        })
    }
    this.enqueuePage = enqueue
    this.enqueueStream = (detail) => {
      const owner = this.state.verifiedAccountId(),
        epoch = this.state.accountEpoch()
      const queuedPolicy = this.policyEpoch
      if (!owner || detail.accountId !== owner) return
      this.pending = this.pending
        .then(async () => {
          if (this.stopped || this.state.accountEpoch() !== epoch) return
          const policy = this.policyEpoch
          const settings = await this.settings.get(),
            header = this.state.header(detail.conversationId)
          if (
            this.policyEpoch !== policy ||
            this.state.accountEpoch() !== epoch ||
            this.state.verifiedAccountId() !== owner
          )
            return
          if (!settings.enabled) return
          const remoteOnly =
            settings.automation.remote.enabled && settings.automation.remote.mode === 'remote-only'
          const session = this.collectionSession.current()
          const manual = this.collectionSession.permits(session, owner, detail.conversationId)
          const rule = captureRuleForOperation(
            settings.archive,
            detail.conversationId,
            header?.projectId ?? null,
            manual || remoteOnly,
            settings.enabled,
          )
          if (!rule.enabled || !retainRawSource(detail.raw, rule)) return
          const stillAuthorized = () =>
            !this.stopped &&
            this.state.accountEpoch() === epoch &&
            this.state.verifiedAccountId() === owner &&
            this.policyEpoch === policy &&
            (!manual || this.collectionSession.permits(session, owner, detail.conversationId))
          const observation: SourceObservation = {
            accountId: owner,
            conversationId: detail.conversationId,
            projectId: header?.projectId ?? null,
            conversationTitle: header?.title ?? null,
            sourceKind: 'native-stream',
            sourceVersion: this.state.sourceGate.version,
            observedAtMs: detail.observedAt,
            raw: detail.raw,
            ...(detail.evidence ? { sourceEvents: detail.evidence } : {}),
          }
          if (remoteOnly) {
            this.queueRemote(
              { scope: { productId: 'chatgpt-booster', ...this.identity, ownerId: owner }, observation },
              stillAuthorized,
              settings,
            )
            return
          }
          let normalized: ArchiveMessageV1 | undefined
          try {
            normalized = (await this.repo(owner).addObservationResult(observation, stillAuthorized))
              .normalized
          } catch (error) {
            await this.rejectedObservation(observation, error, stillAuthorized)
            throw error
          }
          const canRecordHead = () =>
            stillAuthorized() &&
            (!this.state.lifecycle(detail.conversationId)?.requestId ||
              this.state.lifecycle(detail.conversationId)?.requestId === detail.requestId)
          if (detail.activeRun && canRecordHead())
            await this.repo(owner).recordStreamHead(
              detail.conversationId,
              detail.raw,
              canRecordHead,
              detail.restoreHead === true,
            )
          if (stillAuthorized()) {
            this.saved(
              detail.conversationId,
              !!normalized && (normalized.source.variantIndex ?? 0) === 0,
            )
            if (
              normalized ||
              (settings.automation.remote.enabled &&
                settings.automation.remote.mode === 'local-and-remote')
            )
              this.queueCommitted(observation, stillAuthorized, settings, normalized)
          }
        })
        .catch((error) => {
          if (this.stopped || this.state.accountEpoch() !== epoch || this.policyEpoch !== queuedPolicy)
            return
          this.failure = error instanceof Error ? error : Error('Stream archive failed')
        })
    }
    this.unsubscribe = this.state.observations.subscribeSources((entry) => this.enqueueSource(entry))
    this.replayBuffered()
  }
  private enqueueStream?: (
    detail: Extract<BufferedConversationSource, { kind: 'message' }>['detail'] & {
      restoreHead?: boolean
    },
  ) => void
  private enqueueSource(entry: ConversationObservationEntry, replay = false) {
    if (
      this.stopped ||
      entry.ownerId !== this.state.verifiedAccountId() ||
      entry.epoch !== this.state.accountEpoch()
    )
      return
    if (entry.source?.kind === 'page') this.enqueuePage?.(entry.source.detail)
    else if (entry.source?.kind === 'message')
      this.enqueueStream?.({
        ...entry.source.detail,
        activeRun: !replay && entry.source.detail.activeRun,
      })
  }
  /** Replay source evidence to storage/delivery only, never to native action/trigger handlers. */
  replayBuffered(conversationId?: string) {
    if (this.stopped) return
    const conversations = new Set<string>()
    for (const entry of this.state.observations.sources(conversationId)) {
      conversations.add(entry.conversationId)
      this.enqueueSource(entry, true)
    }
    for (const id of conversations) {
      const head = this.state.observations.head(id)
      if (head?.requestId && this.state.lifecycle(id)?.requestId === head.requestId)
        this.enqueueStream?.({ ...head, activeRun: true, restoreHead: true })
    }
  }
  async waitForDistribution() {
    await this.pending
    await this.deliveryPending
  }
  private enqueueProjects(ids = this.state.listProjects().map((project) => project.projectId)) {
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch(),
      generation = this.generation
    if (!owner || this.stopped) return
    for (const id of ids) {
      const source = this.state.project(id)
      if (!source) continue
      this.pending = this.pending
        .then(async () => {
          const policy = this.policyEpoch
          const stillAuthorized = () =>
            !this.stopped &&
            this.generation === generation &&
            this.policyEpoch === policy &&
            this.state.verifiedAccountId() === owner &&
            this.state.accountEpoch() === epoch &&
            this.state.project(id)?.requestStartedAt === source.requestStartedAt &&
            this.state.project(id)?.title === source.title
          if (!stillAuthorized()) return
          const settings = await this.settings.get()
          if (
            !stillAuthorized() ||
            !settings.enabled ||
            !(settings.archive.projects[id] ?? settings.archive.defaultRule).enabled ||
            (settings.automation.remote.enabled && settings.automation.remote.mode === 'remote-only')
          )
            return
          const changed = await this.repo(owner).upsertProjectTitle(id, source.title, stillAuthorized)
          if (changed && stillAuthorized()) this.changeFeed?.publish()
        })
        .catch(() => undefined)
    }
  }
  private async capture(page: ConversationArchiveEventDetail, owner: string, epoch: number) {
    if (this.stopped || this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      return
    const policyEpoch = this.policyEpoch
    const settings = await this.settings.get()
    if (
      this.policyEpoch !== policyEpoch ||
      this.state.accountEpoch() !== epoch ||
      this.state.verifiedAccountId() !== owner
    )
      return
    if (!settings.enabled) return
    const remoteOnly =
      settings.automation.remote.enabled && settings.automation.remote.mode === 'remote-only'
    const header = this.state.header(page.conversationId)
    const session = this.collectionSession?.current()
    const manual = Boolean(this.collectionSession?.permits(session, owner, page.conversationId))
    const rule = captureRuleForOperation(
      settings.archive,
      page.conversationId,
      header?.projectId ?? null,
      manual || remoteOnly,
      settings.enabled,
    )
    if (!rule.enabled || !Array.isArray(page.payload.messages)) return
    const stillAuthorized = () =>
      !this.stopped &&
      this.state.accountEpoch() === epoch &&
      this.state.verifiedAccountId() === owner &&
      this.policyEpoch === policyEpoch &&
      (!manual || Boolean(this.collectionSession?.permits(session, owner, page.conversationId)))
    const store = remoteOnly ? null : this.repo(owner)
    if (
      store &&
      header &&
      page.isInitial === true &&
      typeof page.readId === 'string' &&
      typeof page.readStartedAt === 'number' &&
      Object.hasOwn(page.payload, 'gizmo_id') &&
      header.headReadId === page.readId &&
      header.headReadStartedAt === page.readStartedAt &&
      normalizeConversationProjectId(page.payload) === header.projectId
    ) {
      const currentRead = () => {
        const current = this.state.header(page.conversationId)
        if (!current) return false
        return (
          stillAuthorized() &&
          current.headReadId === page.readId &&
          current.headReadStartedAt === page.readStartedAt &&
          current.projectId === header.projectId
        )
      }
      await store.reassociateProject(
        page.conversationId,
        {
          projectId: header.projectId,
          readId: page.readId,
          readStartedAt: page.readStartedAt,
          observedAtMs: page.timestamp,
          sourceKind: 'native',
          sourceVersion: this.state.sourceGate.version,
          raw: {
            gizmo_id: page.payload.gizmo_id,
            ...(Object.hasOwn(page.payload, 'gizmo_type')
              ? { gizmo_type: page.payload.gizmo_type }
              : {}),
          },
        },
        currentRead,
      )
    }
    let countChanged = false
    for (const candidate of page.payload.messages) {
      if (!stillAuthorized()) return
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const raw = candidate as Record<string, unknown>
      if (typeof raw.id !== 'string' || !raw.id || !retainRawSource(raw, rule)) continue
      if (!stillAuthorized()) return
      const observation: SourceObservation = {
        accountId: owner,
        conversationId: page.conversationId,
        projectId: header?.projectId ?? null,
        conversationTitle: header?.title ?? null,
        sourceKind: 'native',
        sourceVersion: this.state.sourceGate.version,
        observedAtMs: page.timestamp,
        raw,
      }
      if (remoteOnly)
        this.queueRemote(
          { scope: { productId: 'chatgpt-booster', ...this.identity, ownerId: owner }, observation },
          stillAuthorized,
          settings,
        )
      else if (store) {
        let normalized: ArchiveMessageV1 | undefined
        try {
          normalized = (await store.addObservationResult(observation, stillAuthorized)).normalized
          if (normalized && (normalized.source.variantIndex ?? 0) === 0) countChanged = true
        } catch (error) {
          await this.rejectedObservation(observation, error, stillAuthorized)
          throw error
        }
        if (
          normalized ||
          (settings.automation.remote.enabled && settings.automation.remote.mode === 'local-and-remote')
        )
          this.queueCommitted(observation, stillAuthorized, settings, normalized)
      }
    }
    if (remoteOnly) {
      // Messages have their own complete source envelopes. Preserve all other
      // original page metadata without duplicating the message batch.
      const { messages: _messages, ...payload } = page.payload
      this.queueRemote(
        {
          scope: { productId: 'chatgpt-booster', ...this.identity, ownerId: owner },
          page: { ...page, payload },
        },
        stillAuthorized,
        settings,
      )
      return
    }
    if (!store) return
    const info = page.payload.page_info as Record<string, unknown> | undefined
    await store.recordPageEvidence(
      page.conversationId,
      {
        readId: page.readId,
        readStartedAt: page.readStartedAt,
        isInitial: page.isInitial,
        requestedBefore: page.requestedBefore,
        startCursor: typeof info?.start_cursor === 'string' ? info.start_cursor : null,
        endCursor: typeof info?.end_cursor === 'string' ? info.end_cursor : null,
        hasPreviousPage: typeof info?.has_previous_page === 'boolean' ? info.has_previous_page : null,
        hasNextPage: typeof info?.has_next_page === 'boolean' ? info.has_next_page : null,
        observedAt: page.timestamp,
        captureRun: manual && session ? JSON.stringify([session.id, session.startedAt]) : undefined,
      },
      typeof page.payload.current_node === 'string' ? page.payload.current_node : null,
      stillAuthorized,
      { projectId: header?.projectId ?? null, title: header?.title ?? null },
    )
    if (stillAuthorized()) this.saved(page.conversationId, countChanged)
  }
  currentConversationId() {
    return currentConversationId() ?? null
  }
  currentScope() {
    const ownerId = this.state.verifiedAccountId()
    return ownerId ? { productId: 'chatgpt-booster' as const, ...this.identity, ownerId } : null
  }
  /** Source mirror consumers run after the native archive transaction commits. */
  subscribeCommitted(
    listener: (source: ChatGptCommittedSource) => ChatGptCommitReceipt | Promise<ChatGptCommitReceipt>,
  ) {
    this.committedListeners.add(listener)
    return () => this.committedListeners.delete(listener)
  }
  subscribeRemoteSource(listener: (source: ChatGptRemoteSource) => Promise<{ accepted: boolean }>) {
    this.remoteSourceListeners.add(listener)
    return () => this.remoteSourceListeners.delete(listener)
  }
  subscribeRejectedSource(listener: (source: ChatGptRejectedSource) => Promise<{ accepted: boolean }>) {
    this.rejectedSourceListeners.add(listener)
    return () => this.rejectedSourceListeners.delete(listener)
  }
  private async rejectedObservation(
    observation: SourceObservation,
    error: unknown,
    authorized: () => boolean,
  ) {
    const name = error instanceof Error ? error.name : ''
    await this.rejectedSource(
      {
        conversationId: observation.conversationId,
        accountId: observation.accountId,
        observedAt: observation.observedAtMs,
        sourceKind: observation.sourceKind === 'native-stream' ? 'stream' : 'page',
        raw: observation.raw,
        ...(observation.sourceEvents ? { evidence: observation.sourceEvents } : {}),
      },
      /Quota|Database|Transaction|Abort|UnknownError/.test(name) ? 'storage' : 'validation',
      authorized,
    )
  }
  private async rejectedSource(
    source: RejectedConversationSource,
    reason: ChatGptRejectedSource['reason'],
    authorized: () => boolean,
  ) {
    if (!authorized()) return
    for (const listener of this.rejectedSourceListeners) {
      if (!authorized()) return
      try {
        await listener({
          scope: { productId: 'chatgpt-booster', ...this.identity, ownerId: source.accountId },
          source,
          reason,
        })
      } catch {
        /* Rejected raw delivery never repairs canonical proof. */
      }
    }
  }
  private async remoteKey(source: ChatGptRemoteSource, settings: BoosterSettings) {
    const raw = 'observation' in source ? source.observation.raw : source.page.payload
    const evidence = 'observation' in source ? source.observation.sourceEvents : undefined
    return JSON.stringify([
      source.scope.ownerId,
      this.state.accountEpoch(),
      settings.automation.remote.endpoint,
      settings.automation.remote.rawEvents,
      'observation' in source ? source.observation.conversationId : source.page.conversationId,
      'observation' in source ? source.observation.projectId : null,
      (await sourceCloneDigest(raw)).hash,
      (await sourceCloneDigest(evidence ?? null)).hash,
    ])
  }
  private async observedRemotely(
    source: ChatGptRemoteSource,
    authorized: () => boolean,
    settings: BoosterSettings,
  ) {
    if (!authorized() || this.remoteSourceListeners.size === 0) throw Error('remote.sourceUnavailable')
    const key = await this.remoteKey(source, settings)
    for (const listener of this.remoteSourceListeners) {
      if (!authorized()) throw Error('remote.sourceAuthorizationExpired')
      const delivered = this.remoteDelivered.get(listener) ?? new Set<string>()
      if (delivered.has(key)) continue
      const receipt = await listener(source)
      if (!authorized()) throw Error('remote.sourceAuthorizationExpired')
      if (!receipt.accepted) throw Error('remote.sourceRejected')
      delivered.add(key)
      this.remoteDelivered.set(listener, delivered)
    }
  }
  private queueCommitted(
    observation: SourceObservation,
    authorized: () => boolean,
    settings: BoosterSettings,
    normalized?: ArchiveMessageV1,
  ) {
    this.deliveryPending = this.deliveryPending
      .then(() => this.committed(observation, authorized, settings, normalized))
      .catch(() => undefined)
  }
  private queueRemote(
    source: ChatGptRemoteSource,
    authorized: () => boolean,
    settings: BoosterSettings,
  ) {
    this.deliveryPending = this.deliveryPending
      .then(async () => {
        if (authorized()) await this.observedRemotely(source, authorized, settings)
      })
      .catch((error) => {
        if (authorized())
          this.failure = error instanceof Error ? error : Error('Remote source unavailable')
      })
  }
  private async committed(
    observation: SourceObservation,
    authorized: () => boolean,
    settings: BoosterSettings,
    normalized?: ArchiveMessageV1,
  ) {
    if (!authorized() || !this.committedListeners.size) return
    const source: ChatGptCommittedSource = {
      scope: { productId: 'chatgpt-booster', ...this.identity, ownerId: observation.accountId },
      observation,
      ...(normalized ? { normalized } : {}),
    }
    const key = await this.remoteKey(source, settings)
    for (const listener of this.committedListeners) {
      if (!authorized()) return
      const delivered = this.remoteDelivered.get(listener) ?? new Set<string>()
      if (delivered.has(key)) continue
      try {
        const receipt = await listener(source)
        if (authorized() && receipt.accepted) {
          delivered.add(key)
          this.remoteDelivered.set(listener, delivered)
        }
      } catch {
        // Delivery failure cannot undo or invalidate an already committed local source.
        console.warn('[ChatGPT Booster] Remote source delivery deferred')
      }
    }
  }
  async collectCurrent() {
    const account = this.state.verifiedAccountId()
    const epoch = this.state.accountEpoch()
    const id = this.currentConversationId()
    if (!account || !id || this.stopped) throw Error('Verified current conversation required')
    const settings = await this.settings.get()
    if (
      this.stopped ||
      this.state.accountEpoch() !== epoch ||
      this.state.verifiedAccountId() !== account ||
      this.currentConversationId() !== id
    )
      throw Error('archive.error.sourceChanged')
    this.state.sourceGate.assertCompatible(id)
    if (
      !settings.enabled ||
      hasConversationDraft() ||
      hasPendingComposerAttachments() ||
      ['in_progress', 'stop_requested'].includes(this.state.lifecycle(id)?.state ?? '') ||
      (typeof document !== 'undefined' && document.hidden)
    )
      throw Error('Manual archive collection is currently blocked')
    const header = this.state.header(id)
    const pages = this.state.observations
      .sources(id)
      .flatMap((entry) =>
        entry.source?.kind === 'page' && entry.source.detail.accountId === account
          ? [entry.source.detail]
          : [],
      )
    const evidence = historyCoverage(pages.map(nativePageEvidence))
    if (pages.length && !evidence.readId) throw Error('archive.error.freshReadRequired')
    const run = this.collectionSession.begin({
      accountId: account,
      conversationId: id,
      projectId: header?.projectId ?? null,
      selectedTipId: header?.currentNodeId ?? null,
      sourceReadId: evidence.readId,
      sourceReadStartedAt: evidence.readStartedAt,
    })
    this.failure = undefined
    this.collectionSession.requireCurrent(run)
    for (const page of pages.filter((page) => page.readId === evidence.readId)) {
      if (this.collectionSession.permits(run, account, id)) this.enqueuePage?.(page)
    }
  }
  private enqueuePage?: (page: ConversationArchiveEventDetail) => void
  stopCollection() {
    this.collectionSession.pause('user')
  }
  async completeCollection(run: ArchiveCollectionRun) {
    const epoch = this.state.accountEpoch()
    this.collectionSession.requireCurrent(run)
    this.state.sourceGate.assertCompatible(run.conversationId)
    this.collectionSession.update(run, { phase: 'saving', hasOlderServerHistory: false })
    await this.collectionSession.waitFor(run, this.pending)
    this.collectionSession.requireCurrent(run)
    this.state.sourceGate.assertCompatible(run.conversationId)
    if (this.failure) {
      this.collectionSession.fail(run, 'archive.error.unknown')
      throw Error('Fixed Dexie capture has unresolved source conflicts')
    }
    const settings = await this.settings.get()
    this.collectionSession.requireCurrent(run)
    this.state.sourceGate.assertCompatible(run.conversationId)
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== run.accountId)
      throw Error('archive.error.sourceChanged')
    if (settings.automation.remote.enabled && settings.automation.remote.mode === 'remote-only') {
      const policy = this.policyEpoch
      await this.collectionSession.waitFor(run, this.deliveryPending)
      this.collectionSession.requireCurrent(run)
      if (
        this.policyEpoch !== policy ||
        this.state.accountEpoch() !== epoch ||
        this.state.verifiedAccountId() !== run.accountId
      )
        throw Error('archive.error.sourceChanged')
      this.state.sourceGate.assertCompatible(run.conversationId)
      if (this.failure) throw Error('Remote source distribution failed')
    }
    if (!(settings.automation.remote.enabled && settings.automation.remote.mode === 'remote-only')) {
      const saved = await this.repo(run.accountId).getConversation(run.conversationId)
      this.collectionSession.requireCurrent(run)
      this.state.sourceGate.assertCompatible(run.conversationId)
      const proof = checkpointHistoryCoverage(saved?.pageCoverage)
      if (
        this.state.accountEpoch() !== epoch ||
        this.state.verifiedAccountId() !== run.accountId ||
        !proof.verified ||
        (run.sourceReadId
          ? proof.readId !== run.sourceReadId || proof.readStartedAt !== run.sourceReadStartedAt
          : (proof.readStartedAt ?? 0) < run.startedAt) ||
        saved?.pageCoverage?.initial.captureRun !== JSON.stringify([run.id, run.startedAt])
      )
        throw Error('archive.error.sourceChanged')
      const integrity = await this.repo(run.accountId).integrity(run.conversationId)
      const current = await this.repo(run.accountId).getConversation(run.conversationId)
      this.collectionSession.requireCurrent(run)
      this.state.sourceGate.assertCompatible(run.conversationId)
      if (
        this.state.accountEpoch() !== epoch ||
        this.state.verifiedAccountId() !== run.accountId ||
        fixedConversationStamp(current) !== fixedConversationStamp(saved)
      )
        throw Error('archive.error.sourceChanged')
      if (integrity.chain === 'gaps') throw Error('archive.error.incompleteSource')
    }
    this.collectionSession.complete(run)
  }
  async listSavedConversations() {
    const owner = this.state.verifiedAccountId()
    const epoch = this.state.accountEpoch()
    if (!owner) throw Error('Unverified owner')
    const items = await this.repo(owner).listConversations()
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Account changed during conversation read')
    return items.map(({ conversationId, projectId, title }) => ({ conversationId, projectId, title }))
  }
  async listSavedProjects() {
    const owner = this.state.verifiedAccountId()
    const epoch = this.state.accountEpoch()
    if (!owner) throw Error('Unverified owner')
    await this.pending
    const items = await this.repo(owner).listProjects()
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Account changed during project read')
    return items.map(({ projectId, title }) => ({ projectId, title }))
  }
  async savedBranchOrigin(id: string) {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner || this.stopped) throw Error('Verified active branch owner required')
    const repo = this.repo(owner),
      header = await repo.getConversation(id),
      key = JSON.stringify([owner, id]),
      feedRevision = this.changeFeed?.revision() ?? 0
    const guard = () => {
      if (
        this.stopped ||
        this.state.accountEpoch() !== epoch ||
        this.state.verifiedAccountId() !== owner ||
        (this.changeFeed?.revision() ?? 0) !== feedRevision
      )
        throw Error('Owner changed during saved branch read')
    }
    guard()
    const cached = this.branchOrigins.get(key)
    if (
      cached &&
      cached.stamp === fixedConversationStamp(header) &&
      cached.feedRevision === feedRevision
    )
      return { ...cached.value }
    const value = await repo.branchOrigin(id)
    if (fixedConversationStamp(await repo.getConversation(id)) !== fixedConversationStamp(header))
      throw Error('archive.error.sourceChanged')
    guard()
    this.branchOrigins.set(key, { stamp: fixedConversationStamp(header), feedRevision, value })
    if (this.branchOrigins.size > 128) {
      const oldest = this.branchOrigins.keys().next().value
      if (oldest) this.branchOrigins.delete(oldest)
    }
    return { ...value }
  }
  /** Catalog presentation never scans source payloads. Selected reads populate this bounded cache. */
  cachedSavedBranchOrigin(id: string): { conversationId: string | null; title: string | null } {
    const owner = this.state.verifiedAccountId()
    if (!owner || this.stopped) return { conversationId: null, title: null }
    const cached = this.branchOrigins.get(JSON.stringify([owner, id]))
    return cached && cached.feedRevision === (this.changeFeed?.revision() ?? 0)
      ? { ...cached.value }
      : { conversationId: null, title: null }
  }
  /** Narrow legacy-normalization context lookup; never scans all projects/chats. */
  async readSavedProjectId(conversationId: string): Promise<string | null> {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner || !conversationId) throw Error('Verified saved context required')
    const header = await this.repo(owner).getConversation(conversationId)
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Owner changed during saved project context read')
    return header?.projectId ?? null
  }
  async hasMessagesBefore(id: string, cursor: string) {
    return this.boundary(id, cursor, 'before')
  }
  async hasMessagesAfter(id: string, cursor: string) {
    return this.boundary(id, cursor, 'after')
  }
  private async boundary(id: string, cursor: string, side: 'before' | 'after') {
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('Unverified owner')
    const result = await this.repo(owner).hasMessageBoundary(id, cursor, side)
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Owner changed during saved pagination')
    return result
  }
  async savedCount(id: string) {
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner || !id) throw Error('Unverified owner or conversation')
    const count = await this.repo(owner).countConversation(id)
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Account changed during saved count')
    return count
  }
  async workspaceChunk(id: string, afterId?: string) {
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner || this.stopped) throw Error('Verified active workspace required')
    const result = await this.repo(owner).workspaceChunk(id, afterId)
    if (this.stopped || owner !== this.state.verifiedAccountId() || epoch !== this.state.accountEpoch())
      throw Error('Owner changed during workspace hydration')
    return result
  }
  async windowConversation(
    id: string,
    direction: 'older' | 'newer' | 'first' | 'middle',
    cursorId?: string,
  ) {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner || !id) throw Error('Unverified owner or conversation')
    const repo = this.repo(owner)
    const revision = fixedConversationStamp(await repo.getConversation(id))
    const rows = await repo.windowMessages(id, direction, cursorId)
    const result = []
    for (const row of rows) {
      const snapshot = await repo.getSourceSnapshot(id, row.messageId)
      if (!snapshot) throw Error('Missing immutable source snapshot')
      result.push({
        id: row.messageId,
        raw: snapshot.raw,
        normalized: snapshot.normalized,
        observedAtMs: snapshot.observedAtMs,
      })
    }
    if (fixedConversationStamp(await repo.getConversation(id)) !== revision)
      throw Error('archive.error.sourceChanged')
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Owner changed during saved window')
    return result
  }
  async readConversation(id: string, limit = 500) {
    await this.pending
    const owner = this.state.verifiedAccountId()
    const epoch = this.state.accountEpoch()
    if (!owner || !id) throw Error('Verified owner and conversation required')
    const repo = this.repo(owner),
      before = fixedConversationStamp(await repo.getConversation(id))
    const rows = await repo.listMessages(id, limit)
    const result = []
    for (const row of rows) {
      const source = await repo.getSourceSnapshot(id, row.messageId)
      if (!source) throw Error('Canonical source missing')
      result.push({
        id: row.messageId,
        raw: source.raw,
        normalized: source.normalized,
        canonical: row.projection,
        observedAtMs: source.observedAtMs,
      })
    }
    if (fixedConversationStamp(await repo.getConversation(id)) !== before)
      throw Error('archive.error.sourceChanged')
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Account changed during canonical read')
    return result
  }

  captureFailed() {
    return Boolean(this.failure)
  }
  async sourceRevision(id: string) {
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('Verified owner required')
    const revision = (await this.repo(owner).getConversation(id))?.revision ?? 0
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Owner changed during revision read')
    return revision
  }
  async sourceInstanceId(id: string) {
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('Verified owner required')
    const header = await this.repo(owner).getConversation(id)
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Owner changed during source instance read')
    return header?.instanceId ?? 'canonical-v1-legacy'
  }
  async branchPath(id: string, tipId: string) {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('Verified owner required')
    const repo = this.repo(owner),
      before = fixedConversationStamp(await repo.getConversation(id))
    const path = await repo.branchPath(id, tipId)
    if (
      fixedConversationStamp(await repo.getConversation(id)) !== before ||
      this.state.accountEpoch() !== epoch ||
      this.state.verifiedAccountId() !== owner
    )
      throw Error('archive.error.sourceChanged')
    return path
  }
  async rangeMessageIds(id: string, firstId: string, lastId: string) {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('archive.error.auth')
    const repository = this.repo(owner),
      revision = fixedConversationStamp(await repository.getConversation(id))
    const ids = await repository.messageRangeIds(id, firstId, lastId)
    if (
      fixedConversationStamp(await repository.getConversation(id)) !== revision ||
      this.state.accountEpoch() !== epoch ||
      this.state.verifiedAccountId() !== owner
    )
      throw Error('archive.error.sourceChanged')
    return ids
  }
  async timelineMessages(id: string) {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('archive.error.auth')
    const repository = this.repo(owner),
      revision = fixedConversationStamp(await repository.getConversation(id))
    const metadata = await repository.timelineMessages(id)
    if (
      fixedConversationStamp(await repository.getConversation(id)) !== revision ||
      this.state.accountEpoch() !== epoch ||
      this.state.verifiedAccountId() !== owner
    )
      throw Error('archive.error.sourceChanged')
    return metadata
  }
  async integrity(id: string) {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('Verified owner required')
    const repo = this.repo(owner),
      before = fixedConversationStamp(await repo.getConversation(id))
    const integrity = await repo.integrity(id)
    if (fixedConversationStamp(await repo.getConversation(id)) !== before)
      throw Error('archive.error.sourceChanged')
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Owner changed during integrity inspection')
    return integrity
  }
  async windowAroundMessage(id: string, messageId: string) {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('Verified owner required')
    const repo = this.repo(owner)
    const revision = fixedConversationStamp(await repo.getConversation(id))
    const rows = await repo.messageWindow(id, messageId)
    const result = []
    for (const row of rows) {
      const snapshot = await repo.getSourceSnapshot(id, row.messageId)
      if (!snapshot) throw Error('Source evidence missing')
      result.push({
        id: row.messageId,
        raw: snapshot.raw,
        normalized: snapshot.normalized,
        observedAtMs: snapshot.observedAtMs,
      })
    }
    if (fixedConversationStamp(await repo.getConversation(id)) !== revision)
      throw Error('archive.error.sourceChanged')
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Owner changed during navigation')
    return result
  }
  subscribeSaved(listener: (conversationId: string | null) => void) {
    this.savedListeners.add(listener)
    return () => this.savedListeners.delete(listener)
  }
  subscribeCounts(listener: () => void) {
    this.countListeners.add(listener)
    return () => this.countListeners.delete(listener)
  }
  private saved(conversationId: string, countChanged = false) {
    this.changedConversation = conversationId
    this.changeFeed?.publish()
    this.changedConversation = null
    if (countChanged)
      for (const listener of this.countListeners) {
        try {
          listener()
        } catch {}
      }
  }
  async messageVersions(id: string, messageId: string) {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('Verified owner required')
    const versions = await this.repo(owner).messageVersions(id, messageId)
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Owner changed during source revision read')
    return versions
  }
  backupPort(): PortableBackupIndexedPort {
    const owner = this.state.verifiedAccountId()
    if (!owner || this.stopped) throw Error('Verified active owner required for backup')
    const epoch = this.state.accountEpoch(),
      capture = this
    const guard = () => {
      if (
        capture.stopped ||
        capture.state.accountEpoch() !== epoch ||
        capture.state.verifiedAccountId() !== owner
      )
        throw Error('Owner changed during archive backup/recovery')
    }
    const validatedStages = new WeakMap<PortableBackupReader, number>()
    const validatedArrays = new WeakMap<readonly PortableBackupRow[], number>()
    let activationRevision: number | null = null
    let exportRevision: number | undefined
    let exportComplete = false
    const feedRevision = () => capture.changeFeed?.revision() ?? 0
    const assertPeerRevision = (revision: number) => {
      guard()
      if (feedRevision() !== revision) throw Error('Archive peer changed during backup/recovery')
    }
    const port = this.repo(owner).backupPort(guard, {
      beforeCommit() {
        guard()
        if (activationRevision !== null) assertPeerRevision(activationRevision)
      },
    })
    return {
      ...port,
      async *readRows(size) {
        await capture.pending
        guard()
        exportComplete = false
        const revision = feedRevision()
        if (exportRevision !== undefined) assertPeerRevision(exportRevision)
        exportRevision ??= revision
        for await (const row of port.readRows(size)) {
          assertPeerRevision(revision)
          yield row
        }
        assertPeerRevision(revision)
        exportComplete = true
      },
      async assertSnapshotCurrent() {
        await capture.pending
        guard()
        if (!exportComplete || exportRevision === undefined || !port.assertSnapshotCurrent)
          throw Error('Canonical export snapshot guard unavailable')
        assertPeerRevision(exportRevision)
        await port.assertSnapshotCurrent()
        assertPeerRevision(exportRevision)
      },
      async validateRows(rows) {
        await capture.pending
        guard()
        const revision = feedRevision()
        await port.validateRows?.(rows)
        assertPeerRevision(revision)
        validatedArrays.set(rows, revision)
      },
      async validateStagedRows(reader) {
        await capture.pending
        guard()
        if (!port.validateStagedRows) throw Error('Canonical staged validation unavailable')
        const revision = feedRevision()
        const previous = validatedStages.get(reader)
        if (previous !== undefined) assertPeerRevision(previous)
        await port.validateStagedRows(reader)
        assertPeerRevision(revision)
        validatedStages.set(reader, revision)
      },
      async restoreStagedAtomically(reader) {
        await capture.pending
        guard()
        if (!port.restoreStagedAtomically) throw Error('Canonical staged recovery unavailable')
        activationRevision = validatedStages.get(reader) ?? feedRevision()
        try {
          assertPeerRevision(activationRevision)
          await port.restoreStagedAtomically(reader)
          assertPeerRevision(activationRevision)
          validatedStages.delete(reader)
          // Generic invalidation carries no owner or record IDs and needs no
          // whole-archive conversation list merely to notify mounted readers.
          capture.changeFeed?.publish()
        } finally {
          activationRevision = null
        }
      },
      async restoreAtomically(rows) {
        await capture.pending
        guard()
        activationRevision = validatedArrays.get(rows) ?? feedRevision()
        try {
          assertPeerRevision(activationRevision)
          await port.restoreAtomically(rows)
          assertPeerRevision(activationRevision)
          validatedArrays.delete(rows)
          capture.changeFeed?.publish()
        } finally {
          activationRevision = null
        }
      },
    }
  }
  async savedCurrentSummary() {
    await this.pending
    const owner = this.state.verifiedAccountId()
    const epoch = this.state.accountEpoch()
    const id = this.currentConversationId()
    if (!owner || !id) throw Error('Verified ChatGPT conversation required for metrics')
    const stats = await this.repo(owner).savedConversationStats(id)
    if (
      this.state.accountEpoch() !== epoch ||
      this.state.verifiedAccountId() !== owner ||
      this.currentConversationId() !== id
    )
      throw Error('ChatGPT context changed while reading metrics')
    return stats
  }
  async savedCurrent(): Promise<number> {
    await this.pending
    const owner = this.state.verifiedAccountId()
    const id = this.currentConversationId()
    if (!owner || !id) throw Error('Verified account and current conversation required')
    const epoch = this.state.accountEpoch()
    const count = await this.repo(owner).countConversation(id)
    if (
      this.state.accountEpoch() !== epoch ||
      this.state.verifiedAccountId() !== owner ||
      this.currentConversationId() !== id
    )
      throw Error('Account or conversation changed during fixed archive count')
    return count
  }
  async listCurrent(limit = 80): Promise<readonly { id: string; text: string; coverage: string }[]> {
    await this.pending
    const owner = this.state.verifiedAccountId()
    const id = this.currentConversationId()
    if (!owner || !id) throw Error('Verified account and current conversation required')
    const epoch = this.state.accountEpoch()
    const messages = await this.repo(owner).listMessages(id, limit)
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Account changed during fixed Dexie read')
    return messages.map((row) => ({
      id: row.messageId,
      text: row.projection.elements
        .filter((element) => element.kind === 'text')
        .map((element) => element.text ?? '')
        .join('\n')
        .slice(0, 600),
      coverage: row.projection.renderCoverage,
    }))
  }
  async exportCurrent(): Promise<Blob> {
    const id = this.currentConversationId()
    if (!id) throw Error('No current conversation')
    return this.exportConversation(id)
  }
  async exportUserConversation(
    id: string,
    options: ArchiveExportOptions,
    signal?: AbortSignal,
    progress?: ArchiveExportProgressListener,
  ) {
    await this.pending
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch()
    if (!owner) throw Error('Verified owner required')
    const assertOwner = () => {
      if (
        this.stopped ||
        this.state.accountEpoch() !== epoch ||
        this.state.verifiedAccountId() !== owner
      )
        throw Error('Account changed during user export')
    }
    return exportFixedConversation(this.repo(owner), id, options, assertOwner, signal, progress)
  }
  async exportConversation(id: string): Promise<Blob> {
    await this.pending
    const owner = this.state.verifiedAccountId()
    if (!owner || !id) throw Error('Verified account and conversation required')
    const epoch = this.state.accountEpoch()
    const store = this.repo(owner)
    const sourceRevision = fixedConversationStamp(await store.getConversation(id))
    const assertOwner = () => {
      if (
        this.stopped ||
        this.state.accountEpoch() !== epoch ||
        this.state.verifiedAccountId() !== owner
      )
        throw Error('Account changed during export')
    }
    let digest = 'start'
    let count = 0
    const source = async function* () {
      const encode = async (row: Record<string, unknown>, footer = false) => {
        const line = JSON.stringify(row)
        if (!footer) digest = await archiveSha256Hex(digest + '\n' + line)
        return new TextEncoder().encode(line + '\n')
      }
      const integrity = await store.integrity(id)
      yield await encode({
        kind: 'header',
        schema: 'koba-fixed-chatgpt-v1',
        owner,
        conversationId: id,
        completeness: integrity.chain,
        integrity,
        sourceEncoding: 'archive-structured-clone',
      })
      let cursor: string | undefined
      while (true) {
        assertOwner()
        if (fixedConversationStamp(await store.getConversation(id)) !== sourceRevision)
          throw Error('archive.error.sourceChanged')
        const records = await store.listMessages(id, 128, cursor)
        if (!records.length) break
        for (const item of records) {
          assertOwner()
          const snapshot = await store.getSourceSnapshot(id, item.messageId)
          if (!snapshot) throw Error('Missing immutable source snapshot')
          yield await encode({
            kind: 'message',
            canonical: item,
            snapshot: await encodeArchiveClone(detachSourceSnapshot(snapshot)),
          })
          count++
        }
        cursor = records.at(-1)?.messageId
        if (records.length < 128) break
      }
      assertOwner()
      if (fixedConversationStamp(await store.getConversation(id)) !== sourceRevision)
        throw Error('archive.error.sourceChanged')
      yield await encode({ kind: 'footer', count, digest }, true)
    }
    const result = await createGzipFromChunks(source())
    assertOwner()
    if (fixedConversationStamp(await store.getConversation(id)) !== sourceRevision)
      throw Error('archive.error.sourceChanged')
    return result
  }
  async stop() {
    this.stopped = true
    this.generation++
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.enqueuePage = undefined
    this.enqueueStream = undefined
    this.routingSignature = undefined
    this.unsubscribeSettings?.()
    this.unsubscribeSettings = undefined
    this.unsubscribeRejected?.()
    this.unsubscribeRejected = undefined
    this.unsubscribeCatalog?.()
    this.unsubscribeCatalog = undefined
    this.unsubscribeChanges?.()
    this.unsubscribeChanges = undefined
    this.changeFeed?.close()
    this.changeFeed = undefined
    this.savedListeners.clear()
    this.countListeners.clear()
    this.committedListeners.clear()
    this.remoteSourceListeners.clear()
    this.rejectedSourceListeners.clear()
    await this.pending
    await this.deliveryPending
    this.remoteDelivered.clear()
    for (const store of this.repositories.values()) store.close()
    this.repositories.clear()
  }
}
