import {
  buildArchiveThread,
  currentConversationId,
  currentConversationTitle,
  currentProjectId,
  currentProjectTitle,
} from '@chatgpt-booster/chatgpt'
import type { ArchiveExportOptions } from '@chatgpt-booster/core'
import { downloadArchiveExport, serializeArchiveExport } from './archive-export'
import type { ConversationArchiveStore } from './archive-store'
import type { ConversationArchiveModule } from './conversation-archive'

export function createArchiveUiAdapter(
  store: ConversationArchiveStore,
  capture: ConversationArchiveModule,
) {
  return {
    getCurrentContext: async () => {
      const conversationId = currentConversationId() ?? null
      const conversation = conversationId ? await store.getConversation(conversationId) : undefined
      const projectId = currentProjectId() ?? conversation?.projectId ?? null
      const projects = projectId ? await store.listProjects() : []
      return {
        conversationId,
        conversationTitle: conversation?.title ?? currentConversationTitle() ?? null,
        projectId,
        projectTitle: projectId
          ? (currentProjectTitle(projectId) ??
            projects.find((p) => p.projectId === projectId)?.title ??
            null)
          : null,
      }
    },
    currentConversationId: () => currentConversationId() ?? null,
    currentProjectId: () => currentProjectId() ?? null,
    listProjects: async () =>
      (await store.listProjects()).map((project) => ({
        ...project,
        title: currentProjectTitle(project.projectId) ?? project.title,
      })),
    getConversation: (conversationId: string) => store.getConversation(conversationId),
    getCoverage: async (conversationId: string) => {
      const [coverage, records] = await Promise.all([
        store.getCoverage(conversationId),
        store.listMessages(conversationId),
      ])
      if (!coverage) return undefined
      const thread = buildArchiveThread(records)
      return {
        ...coverage,
        completeAtLastRead: coverage.evidenceVersion === 1 && coverage.completeAtLastRead,
        visibleMessageCount: thread.messageCount,
        internalRecordCount: thread.detailCount,
        knownMessageCount: thread.recordCount,
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
      const evidence = {
        verified: coverage?.evidenceVersion === 1 && coverage.completeAtLastRead,
        verifiedAt: coverage?.verifiedAt ?? null,
        scope: 'observed history pages only; not all branches or attachment bytes',
        storedRecordCount: messages.length,
      }
      const result = serializeArchiveExport(
        conversation,
        buildArchiveThread(messages),
        options,
        evidence,
      )
      downloadArchiveExport(result, conversation.title)
    },
  }
}
