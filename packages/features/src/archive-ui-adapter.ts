import { currentConversationId } from '@chatgpt-booster/chatgpt'
import type { ConversationArchiveStore } from './archive-store'

export function createArchiveUiAdapter(store: ConversationArchiveStore) {
  return {
    currentConversationId: () => currentConversationId() ?? null,
    listProjects: () => store.listProjects(),
    getConversation: (conversationId: string) => store.getConversation(conversationId),
    getCoverage: (conversationId: string) => store.getCoverage(conversationId),
    listConversations: () => store.listConversations(),
    listMessages: (conversationId: string) => store.listMessages(conversationId),
  }
}
