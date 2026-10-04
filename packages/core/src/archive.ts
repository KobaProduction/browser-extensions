export type ArchiveRecordKind =
  | 'user'
  | 'answer'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'internal'
export interface ArchiveRecordView {
  messageKey: string
  messageId: string
  conversationId: string
  role: string | null
  channel: string | null
  contentType: string | null
  messageType: string | null
  recipient: string | null
  status: string | null
  modelSlug: string | null
  parentId: string | null
  turnExchangeId: string | null
  workingTurnId?: string | null
  authorName?: string | null
  createTime: number | null
  firstSeenAt?: number
  raw: Record<string, unknown>
}
export interface ArchiveAttachmentView {
  assetId: string
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  kind: 'image' | 'file'
}
export interface ArchiveItemView {
  record: ArchiveRecordView
  kind: ArchiveRecordKind
  text: string
}
export interface ArchiveTurnView {
  id: string
  association: 'parent' | 'turn' | 'adjacency' | 'unassigned'
  messages: ArchiveItemView[]
  details: ArchiveItemView[]
}
export interface ArchiveThreadView {
  turns: ArchiveTurnView[]
  messageCount: number
  recordCount: number
  detailCount: number
}
export interface CaptureRule {
  enabled: boolean
  reasoning: boolean
  tools: boolean
  internal: boolean
}
export interface ArchiveSettings {
  defaultRule: CaptureRule
  projects: Record<string, CaptureRule>
  conversations: Record<string, CaptureRule>
}
export interface ArchiveExportOutcome {
  packaged: boolean
  complete: boolean
  includedAssets: number
  missingAssets: number
  blob: Blob
  extension: 'json' | 'md' | 'zip'
}
export interface ArchiveExportOptions {
  format: 'json' | 'markdown'
  level: 'conversation' | 'custom' | 'full'
  reasoning: boolean
  tools: boolean
  internal: boolean
  images: boolean
  files: boolean
}
export const DEFAULT_CAPTURE_RULE: CaptureRule = {
  enabled: false,
  reasoning: true,
  tools: true,
  internal: true,
}
export const DEFAULT_EXPORT_OPTIONS: ArchiveExportOptions = {
  format: 'json',
  level: 'conversation',
  reasoning: true,
  tools: true,
  internal: false,
  images: false,
  files: false,
}
export function captureRuleFor(
  settings: ArchiveSettings,
  conversationId: string,
  projectId: string | null,
): CaptureRule {
  return (
    settings.conversations[conversationId] ??
    (projectId ? settings.projects[projectId] : undefined) ??
    settings.defaultRule
  )
}
export type CaptureRuleSource = 'conversation' | 'project' | 'default'
export function resolveCaptureRule(
  settings: ArchiveSettings,
  conversationId: string,
  projectId: string | null,
): { rule: CaptureRule; source: CaptureRuleSource } {
  const conversation = settings.conversations[conversationId]
  if (conversation) return { rule: conversation, source: 'conversation' }
  const project = projectId ? settings.projects[projectId] : undefined
  if (project) return { rule: project, source: 'project' }
  return { rule: settings.defaultRule, source: 'default' }
}
/** Manual consent bypasses only automatic enablement, never the chosen record categories. */
export function captureRuleForOperation(
  settings: ArchiveSettings,
  conversationId: string,
  projectId: string | null,
  manual: boolean,
  masterEnabled: boolean,
): CaptureRule {
  const rule = captureRuleFor(settings, conversationId, projectId)
  return { ...rule, enabled: manual || (masterEnabled && rule.enabled) }
}
export function serverTimeMs(value: number | null | undefined, observedAt = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.abs(value) < 1e11
      ? value * 1000
      : value
    : observedAt
}
export const ARCHIVE_UPDATED_EVENT = 'chatgpt-booster:archive-updated'
export const OPEN_ARCHIVE_EVENT = 'chatgpt-booster:open-archive'
export const OPEN_CAPTURE_SETTINGS_EVENT = 'chatgpt-booster:open-capture-settings'
export const HISTORY_LOADER_STATE_EVENT = 'chatgpt-booster:history-loader-state'
export const HISTORY_LOADER_START_EVENT = 'chatgpt-booster:history-loader-start'
export const HISTORY_LOADER_STOP_EVENT = 'chatgpt-booster:history-loader-stop'
export type HistoryLoaderPhase =
  | 'idle'
  | 'preparing'
  | 'scrolling'
  | 'waiting_for_load'
  | 'backoff'
  | 'complete'
  | 'cancelled'
  | 'error'
export interface HistoryLoaderState {
  phase: HistoryLoaderPhase
  conversationId: string | null
  knownMessageCount: number
  hasOlderServerHistory: boolean | null
  pagesLoaded: number
  consecutiveErrors: number
  message?: string | undefined
}

export interface ArchiveCaptureContext {
  scope: 'project' | 'conversation'
  id: string
  title: string | null
  projectId?: string | null
}
export interface ArchiveCurrentContext {
  conversationId: string | null
  conversationTitle: string | null
  projectId: string | null
  projectTitle: string | null
}
export function normalizeCaptureRule(value: Partial<CaptureRule> | null | undefined): CaptureRule {
  return {
    enabled: value?.enabled === true,
    reasoning: typeof value?.reasoning === 'boolean' ? value.reasoning : true,
    tools: typeof value?.tools === 'boolean' ? value.tools : true,
    internal: typeof value?.internal === 'boolean' ? value.internal : true,
  }
}
export function normalizeExportOptions(
  value?: Partial<ArchiveExportOptions>,
): ArchiveExportOptions {
  return {
    format: value?.format === 'markdown' ? 'markdown' : 'json',
    level: value?.level === 'custom' || value?.level === 'full' ? value.level : 'conversation',
    reasoning: typeof value?.reasoning === 'boolean' ? value.reasoning : true,
    tools: typeof value?.tools === 'boolean' ? value.tools : true,
    internal: value?.internal === true,
    images: value?.images === true,
    files: value?.files === true,
  }
}
