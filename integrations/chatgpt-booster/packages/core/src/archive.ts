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
  updateTime?: number | null
  resolvedModelSlug?: string | null
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
export interface ConversationItemMetadataView {
  sentAt: number | null
  editedAt: number | null
  edited: boolean
  model: string | null
  thinking: string | null
}
export interface ToolInvocationView {
  kind: 'mcp' | 'tool'
  provider: string | null
  action: string | null
  label: string
  recipient: string | null
  timestamp: number | null
  finishedAt: number | null
  durationMs: number | null
  payload: unknown
  result: unknown
  path: string | null
  link: string | null
  iconUrl: string | null
  iconKey: string | null
}
export interface ArchiveItemView {
  record: ArchiveRecordView
  kind: ArchiveRecordKind
  text: string
  metadata: ConversationItemMetadataView
  tool?: ToolInvocationView | undefined
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
export interface ArchiveExportFormatDescriptor {
  id: string
  label: string
  mimeType: string
  fileExtension: string
  isDefault: boolean
}
/** A saved preview location is tied to its owner and revision, not just a chat ID. */
export interface ArchiveMessageLocation {
  accountId: string
  conversationId: string
  messageId: string
  source: 'saved'
  sourceRevision: number
  sourceInstanceId?: string | null
}

/** Explicit saved inspection must not silently switch to current-chat RAM. */
export interface ArchiveWindowRequest {
  source?: 'auto' | 'saved'
  expectedAccountId?: string
  expectedRevision?: number
  expectedInstanceId?: string | null
  signal?: AbortSignal
}

/** Diagnostic snapshots describe the saved copy; they never authorize export. */
export type ArchiveExportBlocker =
  | 'account_unverified'
  | 'source_incompatible'
  | 'storage_unavailable'
  | 'conversation_missing'
  | 'selection_missing'
  | 'page_unknown'
  | 'page_incomplete'
  | 'capture_unknown'
  | 'capture_omissions'
  | 'head_mismatch'
  | 'source_changed'
  | 'tip_missing'
  | 'missing_parent'
  | 'parent_unknown'
  | 'cyclic_parent'
  | 'depth_limit'
  | 'assets_unverified'
  | 'technical_requires_json'

export type ArchiveCollectionBlocker =
  | 'not_current'
  | 'disabled'
  | 'account_unverified'
  | 'source_incompatible'
  | 'draft'
  | 'attachments'
  | 'generating'
  | 'unavailable'

export interface ArchiveExportReadiness {
  scope: 'saved_copy'
  sourceAdapterVersion: string
  sourceAdapterRegistered: boolean
  conversationId: string
  projectId: string | null
  sourceRevision: number | null
  sourceInstanceId?: string | null
  selectedTipId: string | null
  knownRecordCount: number
  linkedPageCount: number
  pageContinuity: 'verified' | 'partial' | 'unknown'
  captureCoverage: 'complete' | 'omitted' | 'unknown'
  pathVerification: 'verified_checkpoint' | 'needs_verification' | 'unknown'
  latestHeadMatches: boolean | null
  blockers: ArchiveExportBlocker[]
  collectionBlocker: ArchiveCollectionBlocker | null
  captureCategories: Pick<CaptureRule, 'reasoning' | 'tools' | 'internal'> | null
}

/** Preserve the previous safe error message while exposing a precise local cause. */
export class ArchiveExportBlockedError extends Error {
  readonly name = 'ArchiveExportBlockedError'
  constructor(readonly reason: ArchiveExportBlocker) {
    super(
      reason === 'source_changed' ? 'archive.error.sourceChanged' : 'archive.error.unverifiedPath',
    )
  }
}

/** Ephemeral job counters only: never persist or export these as native source metadata. */
export type ArchiveExportProgress =
  | { phase: 'checking' | 'verifying'; unit: null; completed: null; total: null }
  | { phase: 'tracing'; unit: 'records'; completed: number; total: null }
  | { phase: 'serializing'; unit: 'records'; completed: number; total: number }
  | { phase: 'packaging' | 'ready'; unit: 'bytes'; completed: number; total: number }

export type ArchiveExportProgressListener = (progress: Readonly<ArchiveExportProgress>) => void

export interface ArchiveExportOutcome {
  packaged: boolean
  complete: boolean
  includedAssets: number
  missingAssets: number
  blob: Blob
  extension: string
}
export interface ArchiveExportOptions {
  format: string
  /** Packaging is separate from the human-readable/source-native output format. */
  packaging?: 'none' | 'zip'
  level: 'conversation' | 'custom' | 'full'
  reasoning: boolean
  tools: boolean
  internal: boolean
  /** Subcategories apply to selective v4 output only. */
  reasoningRecap?: boolean
  reasoningFull?: boolean
  toolCalls?: boolean
  toolResults?: boolean
  toolSourceContent?: boolean
  modelEvidence?: boolean
  dictationEditEvidence?: boolean
  sourceRevisions?: boolean
  attachmentMetadata?: boolean
  images: boolean
  files: boolean
}
/** Booster-only export preference overrides; never part of native ChatGPT records. */
export interface ArchiveExportOverrides {
  projects: Record<string, Partial<ArchiveExportOptions>>
  conversations: Record<string, Partial<ArchiveExportOptions>>
}

export type ArchiveExportPreferenceSource = 'global' | 'project' | 'conversation'

export function scopedExportPreferenceKey(accountId: string, id: string): string {
  if (!accountId || !id || accountId.trim() !== accountId || id.trim() !== id)
    throw new Error('Archive export preference requires a verified owner and ID')
  return JSON.stringify([accountId, id])
}

/** Reject unknown/invalid override properties rather than persisting free-form values. */
export function normalizeExportOverride(value: unknown): Partial<ArchiveExportOptions> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const result: Partial<ArchiveExportOptions> = {}
  if (typeof input.format === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(input.format.trim()))
    result.format = input.format.trim()
  if (input.level === 'conversation' || input.level === 'custom' || input.level === 'full')
    result.level = input.level
  if (input.packaging === 'none' || input.packaging === 'zip') result.packaging = input.packaging
  for (const field of [
    'reasoning',
    'tools',
    'internal',
    'reasoningRecap',
    'reasoningFull',
    'toolCalls',
    'toolResults',
    'toolSourceContent',
    'modelEvidence',
    'dictationEditEvidence',
    'sourceRevisions',
    'attachmentMetadata',
    'images',
    'files',
  ] as const)
    if (typeof input[field] === 'boolean') result[field] = input[field]
  return result
}

export function normalizeExportOverrides(value: unknown): ArchiveExportOverrides {
  const incoming =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const parse = (source: unknown): Record<string, Partial<ArchiveExportOptions>> => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
    const accepted: [string, Partial<ArchiveExportOptions>][] = []
    for (const [key, override] of Object.entries(source)) {
      try {
        const identity = JSON.parse(key) as unknown
        if (
          !Array.isArray(identity) ||
          identity.length !== 2 ||
          identity.some((part) => typeof part !== 'string' || !part || part.trim() !== part)
        )
          continue
        const normalized = normalizeExportOverride(override)
        if (Object.keys(normalized).length) accepted.push([key, normalized])
      } catch {
        // Malformed or unowned namespace is ignored, never shared across accounts.
      }
    }
    return Object.fromEntries(accepted)
  }
  return { projects: parse(incoming.projects), conversations: parse(incoming.conversations) }
}

export function resolveExportPreferences(
  globalOptions: ArchiveExportOptions,
  overrides: ArchiveExportOverrides,
  accountId: string,
  projectId: string | null,
  conversationId: string,
): { options: ArchiveExportOptions; source: ArchiveExportPreferenceSource } {
  const project = projectId
    ? overrides.projects[scopedExportPreferenceKey(accountId, projectId)]
    : undefined
  const conversation = overrides.conversations[scopedExportPreferenceKey(accountId, conversationId)]
  return {
    options: normalizeExportOptions({ ...globalOptions, ...project, ...conversation }),
    source: conversation ? 'conversation' : project ? 'project' : 'global',
  }
}

export const DEFAULT_CAPTURE_RULE: CaptureRule = {
  enabled: false,
  reasoning: true,
  tools: true,
  internal: true,
}
export const DEFAULT_EXPORT_OPTIONS: ArchiveExportOptions = {
  format: 'markdown',
  packaging: 'none',
  level: 'conversation',
  reasoning: true,
  tools: true,
  internal: false,
  reasoningRecap: true,
  reasoningFull: true,
  toolCalls: true,
  toolResults: true,
  toolSourceContent: false,
  modelEvidence: true,
  dictationEditEvidence: false,
  sourceRevisions: false,
  attachmentMetadata: false,
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
export const ARCHIVE_SOURCE_INCOMPATIBLE_EVENT = 'chatgpt-booster:archive-contract-error'
export const OPEN_ARCHIVE_EVENT = 'chatgpt-booster:open-archive'
export const OPEN_CAPTURE_SETTINGS_EVENT = 'chatgpt-booster:open-capture-settings'
export const HISTORY_LOADER_STATE_EVENT = 'chatgpt-booster:history-loader-state'
export const HISTORY_LOADER_START_EVENT = 'chatgpt-booster:history-loader-start'
export const HISTORY_LOADER_STOP_EVENT = 'chatgpt-booster:history-loader-stop'
export type HistoryCollectionStopReason =
  | 'user'
  | 'export_closed'
  | 'export_suspended'
  | 'tab_hidden'
  | 'user_takeover'
  | 'navigation'
  | 'account_changed'
  | 'selection_changed'
  | 'policy_changed'
  | 'source_incompatible'
  | 'superseded'
  | 'expired'
  | 'runtime_stopped'

export interface HistoryLoaderStopRequest {
  conversationId?: string
  sessionId?: number
  reason?: HistoryCollectionStopReason
}

export type HistoryLoaderPhase =
  | 'idle'
  | 'preparing'
  | 'scrolling'
  | 'waiting_for_load'
  | 'backoff'
  | 'saving'
  | 'complete'
  | 'cancelled'
  | 'error'
export interface HistoryLoaderState {
  phase: HistoryLoaderPhase
  sessionId?: number
  stopReason?: HistoryCollectionStopReason | undefined
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
    format:
      typeof value?.format === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value.format.trim())
        ? value.format.trim()
        : DEFAULT_EXPORT_OPTIONS.format,
    level: value?.level === 'custom' || value?.level === 'full' ? value.level : 'conversation',
    packaging: value?.packaging === 'zip' ? 'zip' : 'none',
    reasoning: typeof value?.reasoning === 'boolean' ? value.reasoning : true,
    tools: typeof value?.tools === 'boolean' ? value.tools : true,
    internal: value?.internal === true,
    reasoningRecap: value?.reasoningRecap !== false,
    reasoningFull: value?.reasoningFull !== false,
    toolCalls: value?.toolCalls !== false,
    toolResults: value?.toolResults !== false,
    toolSourceContent: value?.toolSourceContent === true,
    modelEvidence: value?.modelEvidence !== false,
    dictationEditEvidence: value?.dictationEditEvidence === true,
    sourceRevisions: value?.sourceRevisions === true,
    attachmentMetadata: value?.attachmentMetadata === true,
    images: value?.images === true,
    files: value?.files === true,
  }
}
