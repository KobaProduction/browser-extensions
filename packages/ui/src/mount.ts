import type {
  ArchiveCurrentContext,
  ArchiveExportFormatDescriptor,
  ArchiveExportOptions,
  ArchiveExportOutcome,
  ArchiveExportProgressListener,
  ArchiveExportReadiness,
  ArchiveMessageLocation,
  ArchiveThreadView,
  ArchiveWindowRequest,
  DiagnosticsAdapter,
  HistoryLoaderState,
  HistoryLoaderStopRequest,
  PersistentDiagnosticsAdapter,
  SecretAdapter,
  SettingsAdapter,
  TelemetryControlAdapter,
} from '@chatgpt-booster/core'
import { type App, createApp } from 'vue'
import BoosterOverlay from './BoosterOverlay.vue'
import ControlCenterPanel from './ControlCenterPanel.vue'
import { installBoosterShadowStyles } from './shadow-styles'

const ROOT_ID = 'chatgpt-booster-root'

export interface ArchiveProjectView {
  projectId: string
  title: string | null
}

export interface ArchiveConversationView {
  conversationId: string
  projectId: string | null
  title: string | null
  updatedAt: number | null
  lastSeenAt: number
  archiveState: 'unknown' | 'partial' | 'complete' | 'stale'
  branchSourceConversationId: string | null
  branchSourceTitle: string | null
}

export interface ArchiveMessageView {
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
  createTime: number | null
  raw: Record<string, unknown>
}

export interface ArchiveCoverageView {
  evidenceVersion?: number
  verifiedAt?: number | null
  historyPageCount?: number
  visibleMessageCount?: number
  internalRecordCount?: number
  conversationId: string
  knownMessageCount: number
  oldestKnownVisibleMessageId?: string | null
  newestKnownVisibleMessageId?: string | null
  currentFirstMessageId?: string | null
  currentLastMessageId?: string | null
  storedStartMatchesCurrent?: boolean
  storedLatestMatchesCurrent?: boolean
  hasOlderServerHistory: boolean | null
  completeAtLastRead: boolean
  lastFullReadAt: number | null
}

export interface ArchiveWindowCursor {
  sourceCreateTime: number | null
  messageId: string
}

export interface ArchiveThreadWindow {
  thread: ArchiveThreadView
  olderCursor: ArchiveWindowCursor | null
  newerCursor: ArchiveWindowCursor | null
  hasOlderStored: boolean
  hasNewerStored: boolean
  loadedRecordCount: number
  totalKnownRecordCount: number
  hasUnsequencedRecords: boolean
  source?: 'live' | 'saved'
  sourceRevision?: number | null
  sourceInstanceId?: string | null
  accountId?: string
  focusedMessageId?: string
  unsequencedTarget?: boolean
}

/** Lightweight source facts. Neither endpoint is automatically a verified branch root. */
export interface ArchiveExportPreviewMessage {
  location?: ArchiveMessageLocation
  messageId: string
  role: string | null
  text: string
}
export interface ArchiveExportPreview {
  earliest: ArchiveExportPreviewMessage[]
  latest: ArchiveExportPreviewMessage[]
  hiddenKnownCount: number
  knownCount: number
  hasUnsequencedMessages: boolean
  selectedTipId: string | null
  sourcePageContinuity: 'verified' | 'partial' | 'unknown'
  captureCoverage: 'complete' | 'omitted' | 'unknown'
  latestHeadMatches: boolean | null
}

/** Read-only source evidence; original ChatGPT owner identifiers are not returned. */
export interface ArchiveSkippedOwnerEntry {
  conversationId: string
  title: string | null
  reason: 'missing_owner' | 'owner_mismatch'
  messages: number
  messageIds: readonly string[]
}

export interface ArchiveDataAdapter {
  getCurrentContext(): Promise<ArchiveCurrentContext>
  currentConversationId(): string | null
  currentProjectId(): string | null
  currentAccountId?(): string | null
  hasIncompatibleSource?(conversationId: string): boolean
  /** Only the Export modal may start native collection in v4. */
  collectionInsideExportOnly?: boolean
  archiveGeneration?: 4
  /** Canonical archive recovery is explicit and does not mutate native ChatGPT. */
  getArchiveMigrationOverview?(): Promise<{
    status: string
    legacyConversations: number
    unboundConversations: number
    conflictingConversations: number
    migratedConversations: number
  }>
  startArchiveMigration?(bindUnowned: boolean): Promise<void>
  reconcileArchiveRecent?(
    hours: 48 | 168,
    approvedLegacy: boolean | readonly string[],
  ): Promise<{
    examined: number
    inserted: number
    changed: number
    unchanged: number
    skippedOwnership: number
    skippedConversations: readonly ArchiveSkippedOwnerEntry[]
    conversationsTouched: number
  }>
  inspectSkippedOwnership?(hours: 48 | 168): Promise<{
    examined: number
    skippedMessages: number
    skippedConversations: readonly ArchiveSkippedOwnerEntry[]
    sinceMs: number
  }>
  auditArchiveCoverage?(): Promise<{
    legacyConversations: number
    canonicalConversations: number
    conversationCountShortfall: number
    conversationsWithMessageShortfall: number
    sourceMessageCount: number
    canonicalMessageCount: number
  }>
  subscribeArchiveMigration?(listener: () => void): () => void
  exportRecoveredConversation?(
    conversationId: string,
    format?: 'json' | 'markdown',
  ): Promise<Blob | null>
  isRecoveredConversation?(conversationId: string): Promise<boolean>
  archiveMigrationProgress?(): { status: string; conversations: number; messages: number }
  subscribeContextChange?(listener: () => void): () => void
  getThread(conversationId: string): Promise<ArchiveThreadView>
  /** v4 only: progressively materialize bounded IndexedDB windows. */
  getThreadWindow?(
    conversationId: string,
    before?: ArchiveWindowCursor | null,
    direction?: 'older' | 'newer' | 'first',
    request?: ArchiveWindowRequest,
  ): Promise<ArchiveThreadWindow>
  getMessageWindow?(
    conversationId: string,
    messageId: string,
    request?: ArchiveWindowRequest,
  ): Promise<ArchiveThreadWindow>
  collectCurrent(): Promise<void>
  getCollectionState?(): Readonly<HistoryLoaderState>
  stopCollection?(request: HistoryLoaderStopRequest): void
  clearAll(): Promise<void>
  listExportFormats(): ArchiveExportFormatDescriptor[]
  exportConversation(
    conversationId: string,
    options: ArchiveExportOptions,
    signal?: AbortSignal,
    onProgress?: ArchiveExportProgressListener,
  ): Promise<ArchiveExportOutcome>
  listProjects(): Promise<ArchiveProjectView[]>
  getConversation(conversationId: string): Promise<ArchiveConversationView | undefined>
  getCoverage(
    conversationId: string,
    request?: ArchiveWindowRequest,
  ): Promise<ArchiveCoverageView | undefined>
  getExportPreview?(conversationId: string): Promise<ArchiveExportPreview>
  /** Passive saved-copy diagnostics; selected ancestry is still verified at Prepare. */
  getExportReadiness?(
    conversationId: string,
    options: ArchiveExportOptions,
    signal?: AbortSignal,
  ): Promise<ArchiveExportReadiness>
  subscribeExportChanges?(conversationId: string, listener: () => void): () => void
  getExportPreferences?(
    conversationId: string,
    scope?: 'global' | 'project' | 'conversation',
  ): Promise<{
    options: ArchiveExportOptions
    source: 'global' | 'project' | 'conversation'
    projectId: string | null
    accountId: string
  }>
  saveExportPreferences?(
    conversationId: string,
    scope: 'global' | 'project' | 'conversation',
    options: ArchiveExportOptions | null,
    context: { accountId: string; projectId: string | null },
  ): Promise<void>
  listConversations(): Promise<ArchiveConversationView[]>
  listMessages(conversationId: string): Promise<ArchiveMessageView[]>
}

export interface MountedBoosterUi {
  unmount(): void
}

export interface BoosterUiOptions {
  settingsAdapter: SettingsAdapter
  diagnosticsAdapter?: DiagnosticsAdapter | undefined
  persistentDiagnosticsAdapter?: PersistentDiagnosticsAdapter | undefined
  secretAdapter?: SecretAdapter | undefined
  telemetryControlAdapter?: TelemetryControlAdapter | undefined
  archiveAdapter?: ArchiveDataAdapter | undefined
  targetLabel: string
}

function createIsolatedMount(host: HTMLElement) {
  const shadow = host.attachShadow({ mode: 'open' })
  installBoosterShadowStyles(shadow)

  const mountPoint = document.createElement('div')
  shadow.append(mountPoint)
  return mountPoint
}

export function mountBoosterUi(options: BoosterUiOptions): MountedBoosterUi {
  document.getElementById(ROOT_ID)?.remove()

  const host = document.createElement('div')
  host.id = ROOT_ID
  host.style.cssText =
    'position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;overflow:visible!important;'
  document.documentElement.append(host)

  const mountPoint = createIsolatedMount(host)
  const app: App = createApp(BoosterOverlay, { ...options })
  app.mount(mountPoint)

  return {
    unmount() {
      app.unmount()
      host.remove()
    },
  }
}

export function mountControlCenter(host: HTMLElement, options: BoosterUiOptions): MountedBoosterUi {
  const mountPoint = createIsolatedMount(host)
  const app: App = createApp(ControlCenterPanel, {
    ...options,
    showClose: false,
  })
  app.mount(mountPoint)

  return {
    unmount() {
      app.unmount()
      host.replaceChildren()
    },
  }
}
