import type { DefineComponent } from 'vue'
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
  paused: boolean
  phase: string
  done: number
  total: number
  newCount: number
  downloaded: number
  failed: number
  error?: string
}
export declare const ArchiveManager: DefineComponent<{
  state: ArchiveManagerState
  initial: ArchiveManagerOptions
  error?: string
  title?: string
}>
