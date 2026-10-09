import type { ArchiveManagerOptions } from '@kobaproduction/browser-widgets'

export type ArchiveMode = 'recent' | 'incremental' | 'backfill'
export interface ArchiveOptions extends ArchiveManagerOptions {
  peerId: number
  mode: ArchiveMode
}
export interface VkAttachment {
  type: string
  [key: string]: unknown
}
export interface VkMessage {
  id: number
  date: number
  from_id?: number
  peer_id?: number
  out?: number | boolean
  text?: string
  attachments?: VkAttachment[]
  reply_message?: VkMessage
  fwd_messages?: VkMessage[]
  [key: string]: unknown
}
export interface VkHistoryResponse {
  count: number
  items: VkMessage[]
}
export interface VkMediaChoice {
  url: string
  name: string
  size: number | null
}
export interface VkAsset {
  key: string
  rootId: number
  type: string
  choices: VkMediaChoice[]
  sourceId: number | null
  context: string
  external: string | null
  transcript: string | null
}
export interface VkStoredFile {
  type: string
  message_id: number
  source_id: number | null
  status: 'unavailable' | 'link' | 'saved' | 'failed'
  name?: string
  size?: number
  sha256?: string
  path?: string
  mime?: string
}
export interface VkAttachmentView {
  type: string
  key: string
  media: string | null
  status: VkStoredFile['status'] | 'missing'
  external: string | null
  transcript: string | null
  name: string
}
export interface VkCheckpoint {
  mode: ArchiveMode
  target: number
  offset: number
  matched: number
  scanned: number
  newCount: number
  phase: 'messages' | 'media' | 'done'
  fileCursor: number
  status: 'running' | 'paused' | 'done'
  totalVK: number | null
  started: string
  settings: ArchiveOptions
  shifted?: number
  finished?: string
  error?: string
}
export interface VkArchiveMeta {
  schema: 2
  version: string
  peer_id: number
  updated: string
  total: number
  checkpoint: VkCheckpoint | null
  files: Record<string, VkStoredFile>
  runs: Array<{ mode: ArchiveMode; target: number; matched: number; newCount: number; finished: string }>
  conversation: unknown
  backfillOffset?: number
  lastMessageDate?: string | null
}
export interface ArchiveProgress {
  phase: string
  done: number
  total: number
  newCount?: number
  scanned?: number
  downloaded?: number
  failed?: number
  error?: string
}
export interface ArchiveStatus {
  version: string
  folder: string | null
  busy: boolean
  options: ArchiveOptions
  progress: ArchiveProgress
  messages: number
  checkpoint: VkCheckpoint | null
}
export type ArchiveRunResult =
  | { paused: true; progress: ArchiveProgress }
  | { matched: number; newCount: number; saved: number; files: number; folder: string }

export interface ArchiveApi {
  readonly version: string
  configure(options?: Partial<ArchiveOptions>): ArchiveStatus
  status(): ArchiveStatus
  subscribe(listener: (status: ArchiveStatus) => void): () => void
  selectFolder(): Promise<ArchiveStatus>
  useFolder(handle: FileSystemDirectoryHandle): Promise<ArchiveStatus>
  run(options?: Partial<ArchiveOptions>): Promise<ArchiveRunResult>
  resume(): Promise<ArchiveRunResult>
  stop(): void
  show(): void
  hide(): void
  buildViewer(): Promise<{ messages: number }>
  getMessages(): VkMessage[]
  previewMessages(options: { limit: number; query?: string }): {
    messages: VkMessage[]
    matching: number
  }
  destroy(): void
}
export interface LegacyVkArchive {
  state(): { authenticated: boolean; peer_id: number }
  getPart(
    from: string,
    through: string,
  ): {
    next_offset: number
    complete: boolean
    conversation_total?: number
    messages: VkMessage[]
  }
  captureRange(options: {
    from: string
    through: string
    maxPages: number
    pageSize: number
    delayMs: number
  }): Promise<unknown>
}
declare global {
  interface Window {
    VKExport?: ArchiveApi
    VKArchive?: LegacyVkArchive
  }
  // Browser tests and legacy bridge may use the same globals outside Window.
  var VKExport: ArchiveApi | undefined
  var VKArchive: LegacyVkArchive | undefined
  var __VK_EXPORT_TEST_MODE: boolean | undefined
  var showDirectoryPicker:
    | ((options: { id: string; mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>)
    | undefined
}
export function archiveApi(): ArchiveApi | undefined {
  return globalThis.VKExport
}
