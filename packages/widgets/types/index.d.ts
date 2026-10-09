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

export interface ArchiveConversationRow {
  id: string
  title: string
  depth: number
  branched: boolean
  sourceMissing: boolean
}
export interface ArchiveConversationGroup {
  id: string
  label: string
  count: number
  rows: readonly ArchiveConversationRow[]
}
export interface ArchiveConversationListCopy {
  search: string
  loading: string
  empty: string
  noResults: string
  untitled: string
  missingBranch: string
}
export declare const ArchiveConversationList: DefineComponent<{
  groups: readonly ArchiveConversationGroup[]
  search: string
  selectedId: string | null
  expandedIds: ReadonlySet<string>
  conversationCount: number
  loading: boolean
  copy: ArchiveConversationListCopy
}>

export interface Viewport {
  width: number
  height: number
}
export interface WorkspaceRect {
  x: number
  y: number
  width: number
  height: number
}
export interface WorkspaceRatios {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
}
export interface WorkspaceDockRatios {
  minimizedSide: 'left' | 'right'
  minimizedHeightRatio: number
}
export declare function clamp(value: number, min: number, max: number): number
export declare function workspaceRect(value: WorkspaceRatios, viewport: Viewport): WorkspaceRect
export declare function workspaceRatios(value: WorkspaceRect, viewport: Viewport): WorkspaceRatios
export declare function dockedIconStyle(
  value: WorkspaceDockRatios | undefined,
  viewport: Viewport,
): { left: string; top: string }
export declare function dockedIconRatios(x: number, y: number, viewport: Viewport): WorkspaceDockRatios

export declare const ArchiveProgressBar: DefineComponent<{
  label: string
  percent: number | null
  counter?: string
  percentLabel?: string
  compact?: boolean
}>

export interface ArchiveTranscriptRecord {
  key: string
  messageId: string
}
export interface ArchiveTranscriptTurn {
  id: string
  association: 'linked' | 'adjacency' | 'unassigned'
  users: readonly ArchiveTranscriptRecord[]
  details: readonly ArchiveTranscriptRecord[]
  replies: readonly ArchiveTranscriptRecord[]
}
export interface ArchiveTranscriptCopy {
  empty: string
  unassigned: string
  adjacency: string
  details: string
}
export declare const ArchiveTranscript: DefineComponent<{
  turns: readonly ArchiveTranscriptTurn[]
  isEmpty: boolean
  targetMessageId: string | null
  copy: ArchiveTranscriptCopy
}> & {
  new (): { $slots: { record(props: { record: ArchiveTranscriptRecord }): unknown } }
}
