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
import { type ArchiveExportPipeline, DEFAULT_ARCHIVE_EXPORT_PIPELINE } from './archive-export'
import { createArchivePackage } from './archive-package'
import type { ConversationArchiveStore } from './archive-store'
import type { ConversationArchiveModule } from './conversation-archive'

export interface ArchiveUiAdapterOptions {
  exportPipeline?: ArchiveExportPipeline
  assetFetchTarget?: Window
}

export function createArchiveUiAdapter(
  store: ConversationArchiveStore,
  capture: ConversationArchiveModule,
  options: ArchiveUiAdapterOptions = {},
) {
  const exportPipeline = options.exportPipeline ?? DEFAULT_ARCHIVE_EXPORT_PIPELINE
  const assetFetchTarget = options.assetFetchTarget ?? window
  async function observedProjectTitle(projectId: string, stored: string | null) {
    const observed = currentProjectTitle(projectId)?.trim() || null
    if (observed && observed !== stored) await store.upsertProject(projectId, observed)
    return observed ?? stored
  }

  function domConversationView(conversationId: string) {
    const snapshot = store.getDomSnapshot(conversationId)
    if (!snapshot) return undefined
    return {
      conversationId: snapshot.conversationId,
      projectId: snapshot.projectId,
      title: snapshot.title,
      updatedAt: null,
      lastSeenAt: snapshot.observedAt,
      archiveState: 'partial' as const,
      branchSourceConversationId: null,
      branchSourceTitle: null,
    }
  }

  async function loadConversationView(conversationId: string) {
    return (await store.getConversation(conversationId)) ?? domConversationView(conversationId)
  }

  const conversationReads = new Map<
    string,
    { revision: number; promise: ReturnType<typeof loadConversationView> }
  >()

  function conversationView(conversationId: string): ReturnType<typeof loadConversationView> {
    const revision = store.conversationRevision(conversationId)
    const cached = conversationReads.get(conversationId)
    if (cached?.revision === revision) return cached.promise

    const pending = loadConversationView(conversationId).then(async (conversation) => {
      if (store.conversationRevision(conversationId) !== revision)
        return await conversationView(conversationId)
      return conversation
    })
    conversationReads.set(conversationId, { revision, promise: pending })
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
    for (const record of store.getDomSnapshot(conversationId)?.records ?? [])
      if (!merged.has(record.messageKey)) merged.set(record.messageKey, record)
    const records = [...merged.values()]
    return { records, thread: buildArchiveThread(records), persistedCoverage, preload }
  }

  function conversationReadModel(conversationId: string): Promise<ConversationReadModel> {
    const revision = store.conversationRevision(conversationId)
    const cached = readModels.get(conversationId)
    if (cached?.revision === revision) return cached.promise

    const pending = loadConversationReadModel(conversationId).then(async (model) => {
      if (store.conversationRevision(conversationId) !== revision)
        return await conversationReadModel(conversationId)
      return model
    })
    readModels.set(conversationId, { revision, promise: pending })
    return pending
  }

  return {
    getCurrentContext: async () => {
      const conversationId = currentConversationId() ?? null
      const conversation = conversationId ? await conversationView(conversationId) : undefined
      const projectId = currentProjectId() ?? conversation?.projectId ?? null
      const project = projectId ? await store.getProject(projectId) : undefined
      return {
        conversationId,
        conversationTitle: conversation?.title ?? currentConversationTitle() ?? null,
        projectId,
        projectTitle: projectId
          ? await observedProjectTitle(projectId, project?.title ?? null)
          : null,
      }
    },
    currentConversationId: () => currentConversationId() ?? null,
    currentProjectId: () => currentProjectId() ?? null,
    subscribeContextChange: (listener: () => void) => observeChatGptNavigation(listener),
    listProjects: async () =>
      await Promise.all(
        (await store.listProjects()).map(async (project) => ({
          ...project,
          title: await observedProjectTitle(project.projectId, project.title),
        })),
      ),
    getConversation: (conversationId: string) => conversationView(conversationId),
    getCoverage: async (conversationId: string) => {
      const {
        persistedCoverage: coverage,
        preload,
        thread,
      } = await conversationReadModel(conversationId)
      const dom = store.getDomSnapshot(conversationId)
      const effective =
        coverage ??
        preload?.coverage ??
        (dom
          ? {
              conversationId,
              knownMessageCount: dom.records.length,
              oldestKnownMessageId: dom.records[0]?.messageId ?? null,
              newestKnownMessageId: dom.records.at(-1)?.messageId ?? null,
              oldestKnownVisibleMessageId: dom.records[0]?.messageId ?? null,
              newestKnownVisibleMessageId: dom.records.at(-1)?.messageId ?? null,
              oldestKnownCursor: null,
              newestKnownCursor: null,
              hasOlderServerHistory: null,
              hasNewerServerHistory: null,
              knownBranchConversationIds: [],
              lastObservedAt: dom.observedAt,
              lastFullReadAt: null,
              completeAtLastRead: false,
            }
          : undefined)
      if (!effective) return undefined
      const liveCoverage =
        preload && preload.coverage.lastObservedAt >= effective.lastObservedAt
          ? preload.coverage
          : effective
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
        completeAtLastRead: coverage?.evidenceVersion === 1 && coverage.completeAtLastRead === true,
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
      const conversations = await store.listConversations()
      const current = currentConversationId()
      if (!current || conversations.some((item) => item.conversationId === current))
        return conversations
      const dom = domConversationView(current)
      return dom ? [dom, ...conversations] : conversations
    },
    listMessages: async (conversationId: string) =>
      (await conversationReadModel(conversationId)).records,
    getThread: async (conversationId: string) =>
      (await conversationReadModel(conversationId)).thread,
    collectCurrent: () => capture.collectCurrent(),
    listExportFormats: () => exportPipeline.listFormats(),
    exportConversation: async (
      conversationId: string,
      options: ArchiveExportOptions,
      signal?: AbortSignal,
    ) => {
      const [conversation, messages, coverage] = await Promise.all([
        store.getConversation(conversationId),
        store.listMessages(conversationId),
        store.getCoverage(conversationId),
      ])
      if (!conversation) throw new Error('archive.error.noChat')
      const captureEvidence = await store.getCaptureEvidence(conversationId, coverage?.readId)
      const evidence = {
        verified: coverage?.evidenceVersion === 1 && coverage.completeAtLastRead,
        verifiedAt: coverage?.verifiedAt ?? null,
        capture: captureEvidence,
        scope: 'observed history pages only; not all branches or attachment bytes',
        storedRecordCount: messages.length,
      }
      const thread = buildArchiveThread(messages)
      const packageRequested = options.level === 'full' || options.images || options.files
      if (!packageRequested) {
        const result = exportPipeline.serialize(conversation, thread, options, evidence)
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
