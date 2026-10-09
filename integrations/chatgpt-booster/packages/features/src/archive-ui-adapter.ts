import {
  archiveRecordAttachments,
  buildArchiveThread,
  currentConversationId,
  currentConversationMessageBounds,
  currentConversationTitle,
  currentProjectId,
  currentProjectTitle,
  currentResolvedAssetUrls,
  observeChatGptNavigation,
} from '@chatgpt-booster/chatgpt'
import type { ArchiveExportOptions, ArchiveRecordView } from '@chatgpt-booster/core'
import { fetchArchiveAssetBytes } from '@chatgpt-booster/observer'
import { type HistoryPageEvidence, historyCoverage } from './archive-coverage'
import { type ArchiveExportPipeline, DEFAULT_ARCHIVE_EXPORT_PIPELINE } from './archive-export'
import { createArchivePackage } from './archive-package'
import type {
  ArchivedConversation,
  ArchivedMessage,
  ConversationArchiveStore,
  ConversationCoverage,
} from './archive-store'
import type { ConversationArchiveModule } from './conversation-archive'
import { ConversationStateStore } from './conversation-state'

export interface ArchiveUiAdapterOptions {
  exportPipeline?: ArchiveExportPipeline
  assetFetchTarget?: Window
  stateStore?: ConversationStateStore
}

export function createArchiveUiAdapter(
  store: ConversationArchiveStore,
  capture: ConversationArchiveModule,
  options: ArchiveUiAdapterOptions = {},
) {
  const stateStore = options.stateStore ?? new ConversationStateStore()
  const exportPipeline = options.exportPipeline ?? DEFAULT_ARCHIVE_EXPORT_PIPELINE
  const assetFetchTarget = options.assetFetchTarget ?? window
  function memoryConversationView(conversationId: string): ArchivedConversation | undefined {
    const snapshot = stateStore.snapshot(conversationId)
    if (!snapshot) return undefined
    const records = snapshot.records
    const sourceTimes = records
      .map((record) => record.updateTime ?? record.createTime)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const firstSeenAt = records.length
      ? Math.min(...records.map((record) => record.firstSeenAt))
      : snapshot.lastObservedAt
    return {
      conversationId,
      projectId: snapshot.projectId,
      title: snapshot.title,
      conversationOrigin: null,
      conversationTemplateId: null,
      gizmoId: snapshot.projectId,
      gizmoType: snapshot.projectId ? 'snorlax' : null,
      defaultModelSlug: null,
      currentNodeId: snapshot.currentNodeId,
      createdAt: sourceTimes.length ? Math.min(...sourceTimes) : null,
      updatedAt: sourceTimes.length ? Math.max(...sourceTimes) : null,
      isArchived: null,
      isReadOnly: null,
      isTemporaryChat: null,
      isStarred: null,
      isStudyMode: null,
      isDoNotRemember: null,
      branchSourceConversationId: null,
      branchSourceTitle: null,
      firstSeenAt,
      lastSeenAt: snapshot.lastObservedAt,
      lastFullReadAt: null,
      archiveState: 'partial',
      raw: {},
    }
  }

  function memoryCoverage(conversationId: string): ConversationCoverage | undefined {
    const snapshot = stateStore.snapshot(conversationId)
    if (!snapshot) return undefined
    const thread = buildArchiveThread(snapshot.records)
    const visible = thread.turns.flatMap((turn) => turn.messages.map((item) => item.record))
    const pages: HistoryPageEvidence[] = snapshot.pages.map((page) => {
      const info =
        page.payload.page_info && typeof page.payload.page_info === 'object'
          ? (page.payload.page_info as Record<string, unknown>)
          : {}
      return {
        readId: page.readId,
        readStartedAt: page.readStartedAt,
        isInitial: page.isInitial,
        requestedBefore: page.requestedBefore,
        startCursor: typeof info.start_cursor === 'string' ? info.start_cursor : null,
        endCursor: typeof info.end_cursor === 'string' ? info.end_cursor : null,
        hasPreviousPage:
          typeof info.has_previous_page === 'boolean' ? info.has_previous_page : null,
        hasNextPage: typeof info.has_next_page === 'boolean' ? info.has_next_page : null,
        observedAt: page.timestamp,
      }
    })
    const evidence = historyCoverage(pages)
    const latestInitial = snapshot.pages
      .filter((page) => page.isInitial)
      .sort((a, b) => b.timestamp - a.timestamp)[0]
    const info =
      latestInitial?.payload.page_info && typeof latestInitial.payload.page_info === 'object'
        ? (latestInitial.payload.page_info as Record<string, unknown>)
        : {}
    return {
      evidenceVersion: 1,
      readId: evidence.readId,
      readStartedAt: evidence.readStartedAt,
      verifiedAt: evidence.verified ? evidence.observedAt : null,
      historyPageCount: evidence.pageCount,
      visibleMessageCount: thread.messageCount,
      internalRecordCount: thread.detailCount,
      conversationId,
      oldestKnownMessageId: snapshot.records[0]?.messageId ?? null,
      newestKnownMessageId: snapshot.records.at(-1)?.messageId ?? null,
      oldestKnownVisibleMessageId: visible[0]?.messageId ?? null,
      newestKnownVisibleMessageId: visible.at(-1)?.messageId ?? null,
      oldestKnownCursor: evidence.oldestCursor,
      newestKnownCursor: typeof info.end_cursor === 'string' ? info.end_cursor : null,
      hasOlderServerHistory: evidence.startReached ? false : evidence.pageCount ? true : null,
      hasNewerServerHistory: typeof info.has_next_page === 'boolean' ? info.has_next_page : null,
      knownMessageCount: snapshot.records.length,
      knownBranchConversationIds: [],
      lastObservedAt: snapshot.lastObservedAt,
      lastFullReadAt: evidence.verified ? evidence.observedAt : null,
      completeAtLastRead: evidence.verified,
    }
  }

  async function loadConversationView(conversationId: string) {
    const memory = memoryConversationView(conversationId)
    if (memory && currentConversationId() === conversationId) return memory
    return (await store.getConversation(conversationId)) ?? memory
  }

  const READ_CACHE_LIMIT = 24
  const effectiveRevision = (conversationId: string) =>
    store.conversationRevision(conversationId) * 1_000_000 + stateStore.revision(conversationId)
  const conversationReads = new Map<
    string,
    { revision: number; promise: ReturnType<typeof loadConversationView> }
  >()

  function cacheRead<T>(cache: Map<string, T>, conversationId: string, value: T): T {
    cache.delete(conversationId)
    cache.set(conversationId, value)
    while (cache.size > READ_CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (typeof oldest !== 'string') break
      cache.delete(oldest)
    }
    return value
  }

  function conversationView(conversationId: string): ReturnType<typeof loadConversationView> {
    const revision = effectiveRevision(conversationId)
    const cached = conversationReads.get(conversationId)
    if (cached?.revision === revision)
      return cacheRead(conversationReads, conversationId, cached).promise

    const pending = loadConversationView(conversationId).then(async (conversation) => {
      if (effectiveRevision(conversationId) !== revision)
        return await conversationView(conversationId)
      return conversation
    })
    cacheRead(conversationReads, conversationId, { revision, promise: pending })
    return pending
  }

  interface ConversationReadModel {
    records: ArchiveRecordView[]
    thread: ReturnType<typeof buildArchiveThread>
    persistedCoverage: Awaited<ReturnType<ConversationArchiveStore['getCoverage']>>
    preload: Awaited<ReturnType<ConversationArchiveStore['getPreloadSnapshot']>>
  }

  const readModels = new Map<
    string,
    { revision: number; promise: Promise<ConversationReadModel> }
  >()

  async function loadConversationReadModel(conversationId: string): Promise<ConversationReadModel> {
    const [stored, preload, persistedCoverage] = await Promise.all([
      store.listMessages(conversationId),
      store.getPreloadSnapshot(conversationId),
      store.getCoverage(conversationId),
    ])
    const merged = new Map<string, ArchiveRecordView>(
      stored.map((record) => [record.messageKey, record]),
    )
    for (const record of preload?.records ?? []) merged.set(record.messageKey, record)
    for (const record of stateStore.listMessages(conversationId))
      merged.set(record.messageKey, record)
    const records = [...merged.values()]
    return { records, thread: buildArchiveThread(records), persistedCoverage, preload }
  }

  function conversationReadModel(conversationId: string): Promise<ConversationReadModel> {
    const revision = effectiveRevision(conversationId)
    const cached = readModels.get(conversationId)
    if (cached?.revision === revision) return cacheRead(readModels, conversationId, cached).promise

    const pending = loadConversationReadModel(conversationId).then(async (model) => {
      if (effectiveRevision(conversationId) !== revision)
        return await conversationReadModel(conversationId)
      return model
    })
    cacheRead(readModels, conversationId, { revision, promise: pending })
    return pending
  }

  return {
    getCurrentContext: async () => {
      const conversationId = currentConversationId() ?? null
      const conversation = conversationId ? await conversationView(conversationId) : undefined
      const projectId = currentProjectId() ?? conversation?.projectId ?? null
      const observedTitle = projectId ? currentProjectTitle(projectId)?.trim() || null : null
      const project = projectId && !observedTitle ? await store.getProject(projectId) : undefined
      return {
        conversationId,
        conversationTitle: conversation?.title ?? currentConversationTitle() ?? null,
        projectId,
        projectTitle: observedTitle ?? project?.title ?? null,
      }
    },
    currentConversationId: () => currentConversationId() ?? null,
    currentProjectId: () => currentProjectId() ?? null,
    hasIncompatibleSource: (id: string) => !!store.sourceGate.get(id),
    subscribeContextChange: (listener: () => void) => observeChatGptNavigation(listener),
    listProjects: async () => {
      const stored = await store.listProjects().catch(() => [])
      const byId = new Map(stored.map((project) => [project.projectId, project]))
      for (const snapshot of stateStore.listSnapshots()) {
        if (!snapshot.projectId) continue
        const previous = byId.get(snapshot.projectId)
        byId.set(snapshot.projectId, {
          projectId: snapshot.projectId,
          title: currentProjectTitle(snapshot.projectId)?.trim() || previous?.title || null,
          firstSeenAt: previous?.firstSeenAt ?? snapshot.lastObservedAt,
          lastSeenAt: Math.max(previous?.lastSeenAt ?? 0, snapshot.lastObservedAt),
        })
      }
      return [...byId.values()].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
    },
    getConversation: (conversationId: string) => conversationView(conversationId),
    getCoverage: async (conversationId: string) => {
      const memory = memoryCoverage(conversationId)
      if (memory && currentConversationId() === conversationId) {
        const current = currentConversationMessageBounds()
        return {
          ...memory,
          currentFirstMessageId: current.firstMessageId,
          currentLastMessageId: current.lastMessageId,
          storedStartMatchesCurrent:
            !!current.firstMessageId &&
            memory.oldestKnownVisibleMessageId === current.firstMessageId,
          storedLatestMatchesCurrent:
            !!current.lastMessageId && memory.newestKnownVisibleMessageId === current.lastMessageId,
        }
      }
      const {
        persistedCoverage: coverage,
        preload,
        thread,
      } = await conversationReadModel(conversationId)
      const candidates = [coverage, preload?.coverage, memory].filter(
        (item): item is NonNullable<typeof coverage> => Boolean(item),
      )
      const effective = candidates.sort((a, b) => b.lastObservedAt - a.lastObservedAt)[0]
      if (!effective) return undefined
      const liveCoverage = memory ?? effective
      const current =
        currentConversationId() === conversationId
          ? currentConversationMessageBounds()
          : { firstMessageId: null, lastMessageId: null }
      return {
        ...effective,
        hasOlderServerHistory: liveCoverage.hasOlderServerHistory,
        hasNewerServerHistory: liveCoverage.hasNewerServerHistory,
        oldestKnownVisibleMessageId:
          liveCoverage.oldestKnownVisibleMessageId ?? effective.oldestKnownVisibleMessageId ?? null,
        newestKnownVisibleMessageId:
          liveCoverage.newestKnownVisibleMessageId ?? effective.newestKnownVisibleMessageId ?? null,
        completeAtLastRead:
          memory?.completeAtLastRead === true ||
          (coverage?.evidenceVersion === 1 && coverage.completeAtLastRead === true),
        visibleMessageCount: thread.messageCount,
        internalRecordCount: thread.detailCount,
        knownMessageCount: thread.recordCount,
        currentFirstMessageId: current.firstMessageId,
        currentLastMessageId: current.lastMessageId,
        storedStartMatchesCurrent:
          !!current.firstMessageId &&
          (liveCoverage.oldestKnownVisibleMessageId ?? effective.oldestKnownVisibleMessageId) ===
            current.firstMessageId,
        storedLatestMatchesCurrent:
          !!current.lastMessageId &&
          (liveCoverage.newestKnownVisibleMessageId ?? effective.newestKnownVisibleMessageId) ===
            current.lastMessageId,
      }
    },
    listConversations: async () => {
      const stored = await store.listConversations().catch(() => [])
      const byId = new Map(
        stored.map((conversation) => [conversation.conversationId, conversation]),
      )
      for (const snapshot of stateStore.listSnapshots()) {
        const memory = memoryConversationView(snapshot.conversationId)
        if (memory) byId.set(snapshot.conversationId, memory)
      }
      return [...byId.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    },
    listMessages: async (conversationId: string) => {
      const live = stateStore.listMessages(conversationId)
      if (live.length && currentConversationId() === conversationId) return live
      return (await conversationReadModel(conversationId)).records
    },
    getThread: async (conversationId: string) => {
      const live = stateStore.listMessages(conversationId)
      if (live.length && currentConversationId() === conversationId) return buildArchiveThread(live)
      return (await conversationReadModel(conversationId)).thread
    },
    collectCurrent: () => capture.collectCurrent(),
    clearAll: async () => {
      await store.clearAll()
      conversationReads.clear()
      readModels.clear()
    },
    listExportFormats: () => exportPipeline.listFormats(),
    exportConversation: async (
      conversationId: string,
      options: ArchiveExportOptions,
      signal?: AbortSignal,
    ) => {
      store.sourceGate.assertCompatible(conversationId)
      await stateStore.hydrate(conversationId, store).catch(() => undefined)
      const [storedConversation, storedMessages, coverage] = await Promise.all([
        store.getConversation(conversationId).catch(() => undefined),
        store.listMessages(conversationId).catch(() => []),
        store.getCoverage(conversationId).catch(() => undefined),
      ])
      const memoryConversation = memoryConversationView(conversationId)
      const conversation = storedConversation ?? memoryConversation
      const liveMessages = stateStore.listMessages(conversationId)
      const mergedMessages = new Map<string, ArchivedMessage>(
        storedMessages.map((record) => [record.messageKey, record]),
      )
      for (const record of liveMessages) mergedMessages.set(record.messageKey, record)
      const messages = [...mergedMessages.values()]
      if (!conversation) throw new Error('archive.error.noChat')
      const captureEvidence = await store.getCaptureEvidence(conversationId, coverage?.readId)
      const evidence = {
        verified: coverage?.evidenceVersion === 1 && coverage.completeAtLastRead,
        verifiedAt: coverage?.verifiedAt ?? null,
        capture: captureEvidence,
        scope: 'observed history pages only; not all branches or attachment bytes',
        storedRecordCount: messages.length,
      }
      store.sourceGate.assertCompatible(conversationId)
      const thread = buildArchiveThread(messages)
      const packageRequested = options.level === 'full' || options.images || options.files
      if (!packageRequested) {
        const result = exportPipeline.serialize(conversation, thread, options, evidence)
        store.sourceGate.assertCompatible(conversationId)
        return {
          packaged: false,
          complete: evidence.verified && captureEvidence.verified,
          includedAssets: 0,
          missingAssets: 0,
          blob: new Blob([result.text], { type: `${result.mime};charset=utf-8` }),
          extension: result.extension,
        }
      }

      await store.syncAssetMetadata(messages)
      const assetIds = messages.flatMap((message) =>
        archiveRecordAttachments(message).map((attachment) => attachment.assetId),
      )
      const assetIdSet = new Set(assetIds)
      if (currentConversationId() === conversationId)
        for (const resolution of currentResolvedAssetUrls()) {
          if (!assetIdSet.has(resolution.assetId)) continue
          await store.updateAssetResolution(
            {
              ...resolution,
              fileName: null,
              mimeType: null,
              fileSizeBytes: null,
              observedAt: Date.now(),
            },
            conversationId,
          )
        }
      const assets = await store.getAssets(assetIds)
      const result = await createArchivePackage(
        conversation,
        thread,
        options,
        evidence,
        assets,
        (url, assetId, exportSignal) =>
          fetchArchiveAssetBytes(url, assetId, assetFetchTarget, exportSignal),
        signal,
        exportPipeline,
      )
      store.sourceGate.assertCompatible(conversationId)
      const includedAssets = result.manifest.assets.filter(
        (asset) => asset.status === 'included',
      ).length
      return {
        packaged: true,
        complete: result.manifest.complete,
        includedAssets,
        missingAssets: result.manifest.assets.length - includedAssets,
        blob: result.blob,
        extension: result.extension,
      }
    },
  }
}
