/** VK-only normalized, credential-free local archive schema. */
export interface VkAttachment {
  id: string
  peerId: number
  messageId: number
  index: number
  type: string
  originalName: string
  sourceId: number | null
  byteSize: number | null
}
export interface VkMessage {
  peerId: number
  id: number
  date: number
  fromId: number | null
  out: boolean
  text: string
  attachments: VkAttachment[]
}
export interface VkConversation {
  peerId: number
  messageCount: number
  complete: boolean
  updatedAt: number
}
export interface VkFileReceipt {
  key: string
  attachmentId: string
  exportId: string
  peerId: number
  filename: string
  sha256: string
  bytes: number
  savedAt: number
}
export interface VkArchiveBackup {
  format: 'koba-vk-native-archive'
  schema: 1
  scope: string
  exportedAt: number
  conversations: VkConversation[]
  messages: VkMessage[]
  receipts: VkFileReceipt[]
}
export interface VkArchiveRepository {
  listConversations(): Promise<VkConversation[]>
  getConversation(peerId: number): Promise<VkConversation | null>
  storePage(peerId: number, messages: readonly VkMessage[]): Promise<void>
  markComplete(peerId: number): Promise<void>
  listMessages(peerId: number): Promise<VkMessage[]>
  listReceipts(peerId: number, exportId: string): Promise<VkFileReceipt[]>
  putReceipt(receipt: VkFileReceipt): Promise<void>
  backup(): Promise<VkArchiveBackup>
  restore(backup: VkArchiveBackup): Promise<void>
}
export interface VkMessageSource {
  history(
    peerId: number,
    offset: number,
    pageSize: number,
  ): Promise<{
    total: number
    messages: VkMessage[]
  }>
  attachmentBytes?(item: VkAttachment): Promise<Uint8Array>
}
export type CaptureProgress = {
  peerId: number
  pages: number
  seen: number
  stored: number
  complete: boolean
}
export interface ExportOptions {
  from: string
  through: string
  includeText: boolean
  includeFiles: boolean
  types: string[]
  maxBytes: number
}
export interface ExportFileStatus {
  attachmentId: string
  filename: string
  sha256: string
  bytes: number
  path: string
}
export interface VkExportManifest {
  format: 'koba-vk-export'
  schema: 1
  scope: string
  peerId: number
  exportId: string
  exportedAt: number
  files: ExportFileStatus[]
}
export interface ExportFolder {
  name: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>
}
export type FolderAudit = { ok: string[]; missing: string[]; renamed: string[]; modified: string[] }
export function validPeerId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
export function scopedVkDatabaseName(scope: string): string {
  if (!/^(vk-booster|all-in-one):(dev|prod)$/.test(scope)) throw Error('Invalid VK archive scope')
  return 'koba-vk-native-v1:' + scope
}
export function validateBackup(value: unknown, scope: string): asserts value is VkArchiveBackup {
  if (!value || typeof value !== 'object') throw Error('Invalid archive backup')
  const b = value as Partial<VkArchiveBackup>
  if (
    b.format !== 'koba-vk-native-archive' ||
    b.schema !== 1 ||
    b.scope !== scope ||
    !Array.isArray(b.conversations) ||
    !Array.isArray(b.messages) ||
    !Array.isArray(b.receipts) ||
    b.conversations.some((c) => !validPeerId(c.peerId) || !Number.isSafeInteger(c.messageCount)) ||
    b.messages.some(
      (m) =>
        !validPeerId(m.peerId) ||
        !Number.isSafeInteger(m.id) ||
        !Number.isFinite(m.date) ||
        typeof m.text !== 'string' ||
        !Array.isArray(m.attachments) ||
        m.attachments.some(
          (a) => typeof a.id !== 'string' || a.peerId !== m.peerId || a.messageId !== m.id,
        ),
    ) ||
    b.receipts.some(
      (r) =>
        typeof r.key !== 'string' || typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256),
    )
  )
    throw Error('Invalid or cross-instance archive backup')
}
