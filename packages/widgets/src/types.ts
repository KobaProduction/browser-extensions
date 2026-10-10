/** Archive-manager view contracts; no provider or storage assumptions. */
export type ArchiveManagerMode = 'recent' | 'incremental' | 'backfill'
export interface ArchiveManagerOptions {
  mode: ArchiveManagerMode
  limit: number
  from: string
  through: string
  pageSize: number
  delay: number
  media: boolean
}
export interface ArchiveManagerState {
  context: string
  folder: string | null
  messages: number
  busy: boolean
  folderPending?: boolean
  paused: boolean
  blockedReason?: string | null
  phase: string
  done: number
  total: number
  newCount: number
  downloaded: number
  failed: number
  error?: string
}
