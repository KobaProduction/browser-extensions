import type { DefineComponent } from 'vue'
export declare const ApplicationBackupSettings: DefineComponent
export interface ArchiveExportChoice {
  id: string
  label: string
}
export declare const ArchiveExportFormatFields: DefineComponent<{
  format: string
  packaging: string
  formats: readonly ArchiveExportChoice[]
  packages: readonly ArchiveExportChoice[]
  formatLabel: string
  packagingLabel: string
  disabled?: boolean
  'onUpdate:format'?: (value: string) => void
  'onUpdate:packaging'?: (value: string) => void
}>
export declare const ArchiveReadingSurface: DefineComponent<{ timelineVisible: boolean }> & {
  new (): { $slots: { default(): unknown; timeline(): unknown; status(): unknown } }
}
export interface PortableBackupSelection {
  settings: boolean
  indexeddb: boolean
}
export interface PortableBackupExportOptions extends PortableBackupSelection {
  compression: 'gzip' | 'none'
  chunkRows: number
}
export declare const PortableBackupPanel: DefineComponent<{
  available: PortableBackupSelection
  pending: boolean
  inspected?: (PortableBackupSelection & { rows: number; createdAt: string }) | null
  error?: string
  success?: string
  progress?: { phase: string; completed: number; total: number; percent: number; entries: number } | null
  onExport?: (options: PortableBackupExportOptions) => void
  onInspect?: (file: File) => void
  onRestore?: (options: PortableBackupSelection) => void
}>
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
export declare const ArchiveManager: DefineComponent<{
  state: ArchiveManagerState
  initial: ArchiveManagerOptions
  error?: string
  title?: string
  onChooseFolder?: () => void
  onStart?: (options: ArchiveManagerOptions) => void
  onStop?: () => void
  onResume?: () => void
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
export interface ArchiveRecordListProps<T> {
  records: readonly T[]
  recordKey: (record: T) => string | number
  messageId: (record: T) => string | number
  targetMessageId?: string | number | null
  selectable?: boolean
  selectedIds?: ReadonlySet<string>
  selectionLabel?: (record: T) => string
  disabled?: boolean
  onSelect?: (messageId: string, checked: boolean) => void
}
export declare const ArchiveRecordList: {
  new <T>(
    props: ArchiveRecordListProps<T>,
  ): {
    $props: ArchiveRecordListProps<T>
    $slots: { record(props: { record: T; index: number }): unknown }
  }
}
export declare const ArchiveSelectionScope: DefineComponent<{
  modelValue: 'all' | 'selected'
  selectedCount: number
  disabled?: boolean
  label?: string
  allLabel?: string
  selectedLabel?: string
  emptyLabel?: string
}>

export interface ArchiveFocusRect {
  top: number
  bottom: number
  height: number
}
export interface ArchiveFocusNode {
  key: string
  top: number
  bottom: number
}
export interface ArchiveFocusResult {
  key: string | null
  retainsPin: boolean
}
export declare function selectArchiveFocus(
  bounds: ArchiveFocusRect,
  nodes: readonly ArchiveFocusNode[],
  pinned: string | null,
): ArchiveFocusResult
export declare function useArchiveFocusTracker(
  viewport: () => HTMLElement | null,
  canTrack: () => boolean,
): {
  activeMessageKey: import('vue').Ref<string | null>
  schedule: () => void
  pin: (key: string) => void
  reset: () => void
  dispose: () => void
}

export declare const ConversationCollectionAction: DefineComponent<{
  label: string
  busy: boolean
  disabled?: boolean
  processed?: number | null
  total?: number | null
  saved?: number | null
  stopLabel?: string
  savedLabel?: string
}>
export interface ArchiveTimelineNode {
  id: string
  parentId: string | null
  label: string
  preview?: string
  uncertain?: boolean
}
export interface ArchiveTimelineLayoutOptions {
  rowHeight?: number
  maxWidth?: number
}
export declare const ARCHIVE_TIMELINE_WINDOW_SIZE: 160
export declare function archiveTimelineWindowStart(count: number, index: number, size?: number): number
export declare const ArchiveTimeline: DefineComponent<{
  nodes: readonly ArchiveTimelineNode[]
  activeId?: string | null
  selectedIds?: ReadonlySet<string>
  label: string
  emptyLabel: string
  uncertainLabel?: string
  disabled?: boolean
  loading?: boolean
}>
export declare function archiveTimelineLayout(
  nodes: readonly ArchiveTimelineNode[],
  options?: ArchiveTimelineLayoutOptions,
): {
  points: { id: string; index: number; lane: number; x: number; y: number }[]
  edges: { childId: string; parentId: string; path: string; uncertain: boolean }[]
  width: number
  height: number
}
