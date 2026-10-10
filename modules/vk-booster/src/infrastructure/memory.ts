import {
  type VkArchiveBackup,
  type VkArchiveRepository,
  type VkConversation,
  type VkFileReceipt,
  type VkMessage,
  validateBackup,
} from '../model/types'

/** Isolated in-memory repository for repeatable tests and offline dev UI. */
export function createMemoryVkArchive(scope: string): VkArchiveRepository {
  let chats = new Map<number, VkConversation>()
  let rows = new Map<string, VkMessage>()
  let receipts = new Map<string, VkFileReceipt>()
  const key = (m: VkMessage) => JSON.stringify([m.peerId, m.id])
  return {
    async listConversations() {
      return [...chats.values()].map((c) => ({ ...c }))
    },
    async getConversation(peerId) {
      const row = chats.get(peerId)
      return row ? { ...row } : null
    },
    async storePage(peerId, messages) {
      for (const message of messages) {
        if (message.peerId !== peerId) throw Error('Cross-conversation page rejected')
        rows.set(key(message), structuredClone(message))
      }
      chats.set(peerId, {
        peerId,
        complete: false,
        messageCount: [...rows.values()].filter((m) => m.peerId === peerId).length,
        updatedAt: Date.now(),
      })
    },
    async markComplete(peerId) {
      const old = chats.get(peerId)
      if (!old) throw Error('No messages saved for conversation')
      chats.set(peerId, { ...old, complete: true, updatedAt: Date.now() })
    },
    async listMessages(peerId) {
      return [...rows.values()]
        .filter((m) => m.peerId === peerId)
        .sort((a, b) => a.date - b.date || a.id - b.id)
        .map((m) => structuredClone(m))
    },
    async listReceipts(peerId, exportId) {
      return [...receipts.values()]
        .filter((r) => r.peerId === peerId && r.exportId === exportId)
        .map((r) => ({ ...r }))
    },
    async putReceipt(receipt) {
      receipts.set(receipt.key, { ...receipt })
    },
    async backup() {
      return {
        format: 'koba-vk-native-archive',
        schema: 1,
        scope,
        exportedAt: Date.now(),
        conversations: [...chats.values()].map((x) => ({ ...x })),
        messages: [...rows.values()].map((x) => structuredClone(x)),
        receipts: [...receipts.values()].map((x) => ({ ...x })),
      }
    },
    async restore(backup: VkArchiveBackup) {
      validateBackup(backup, scope)
      const nextChats = new Map(backup.conversations.map((c) => [c.peerId, { ...c }]))
      const nextRows = new Map(backup.messages.map((m) => [key(m), structuredClone(m)]))
      const nextReceipts = new Map(backup.receipts.map((r) => [r.key, { ...r }]))
      chats = nextChats
      rows = nextRows
      receipts = nextReceipts
    },
  }
}
