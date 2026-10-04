import {
  archiveRecordAttachments,
  buildArchiveThread,
  currentConversationId,
  currentConversationMessageBounds,
  currentConversationTitle,
  currentProjectId,
  currentProjectTitle,
  currentResolvedAssetUrls,
} from '@chatgpt-booster/chatgpt'
import type { ArchiveExportOptions } from '@chatgpt-booster/core'
import { serializeArchiveExport } from './archive-export'
import { createArchivePackage } from './archive-package'
import type { ConversationArchiveStore } from './archive-store'
import type { ConversationArchiveModule } from './conversation-archive'

export function createArchiveUiAdapter(
  store: ConversationArchiveStore,
  capture: ConversationArchiveModule,
) {
  async function observedProjectTitle(projectId: string, stored: string | null) {
    const observed = currentProjectTitle(projectId)?.trim() || null
    if (observed && observed !== stored) await store.upsertProject(projectId, observed)
    return observed ?? stored
  }

  return {
    getCurrentContext: async () => {
      const conversationId = currentConversationId() ?? null
      const conversation = conversationId ? await store.getConversation(conversationId) : undefined
      const projectId = currentProjectId() ?? conversation?.projectId ?? null
      const projects = projectId ? await store.listProjects() : []
      const storedTitle = projectId
        ? (projects.find((project) => project.projectId === projectId)?.title ?? null)
        : null
      return {
        conversationId,
        conversationTitle: conversation?.title ?? currentConversationTitle() ?? null,
        projectId,
        projectTitle: projectId ? await observedProjectTitle(projectId, storedTitle) : null,
      }
    },
    currentConversationId: () => currentConversationId() ?? null,
    currentProjectId: () => currentProjectId() ?? null,
    listProjects: async () =>
      await Promise.all(
        (await store.listProjects()).map(async (project) => ({
          ...project,
          title: await observedProjectTitle(project.projectId, project.title),
        })),
      ),
    getConversation: (conversationId: string) => store.getConversation(conversationId),
    getCoverage: async (conversationId: string) => {
      const [coverage, records, preload] = await Promise.all([
        store.getCoverage(conversationId),
        store.listMessages(conversationId),
        store.getPreloadSnapshot(conversationId),
      ])
      const effective = coverage ?? preload?.coverage
      if (!effective) return undefined
      const merged = new Map(records.map((record) => [record.messageKey, record]))
      for (const record of preload?.records ?? []) merged.set(record.messageKey, record)
      const thread = buildArchiveThread([...merged.values()])
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
    listConversations: () => store.listConversations(),
    listMessages: (conversationId: string) => store.listMessages(conversationId),
    getThread: async (conversationId: string) =>
      buildArchiveThread(await store.listMessages(conversationId)),
    collectCurrent: () => capture.collectCurrent(),
    exportConversation: async (conversationId: string, options: ArchiveExportOptions) => {
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
        const result = serializeArchiveExport(conversation, thread, options, evidence)
        return {
          packaged: false,
          complete: evidence.verified && captureEvidence.verified,
          includedAssets: 0,
          missingAssets: 0,
          blob: new Blob([result.text], { type: `${result.mime};charset=utf-8` }),
          extension: result.extension as 'json' | 'md',
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
      const result = await createArchivePackage(conversation, thread, options, evidence, assets)
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
