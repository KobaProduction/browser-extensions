import type {
  ArchiveCurrentContext,
  ArchiveExportOptions,
  ArchiveExportOutcome,
  ArchiveThreadView,
  DiagnosticsAdapter,
  PersistentDiagnosticsAdapter,
  SecretAdapter,
  SettingsAdapter,
  TelemetryControlAdapter,
} from '@chatgpt-booster/core'
import { type App, createApp } from 'vue'
import BoosterOverlay from './BoosterOverlay.vue'
import ControlCenterPanel from './ControlCenterPanel.vue'
import styles from './styles.css?inline'

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
  hasOlderServerHistory: boolean | null
  completeAtLastRead: boolean
  lastFullReadAt: number | null
}

export interface ArchiveDataAdapter {
  getCurrentContext(): Promise<ArchiveCurrentContext>
  currentConversationId(): string | null
  currentProjectId(): string | null
  getThread(conversationId: string): Promise<ArchiveThreadView>
  collectCurrent(): Promise<void>
  exportConversation(
    conversationId: string,
    options: ArchiveExportOptions,
  ): Promise<ArchiveExportOutcome>
  listProjects(): Promise<ArchiveProjectView[]>
  getConversation(conversationId: string): Promise<ArchiveConversationView | undefined>
  getCoverage(conversationId: string): Promise<ArchiveCoverageView | undefined>
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
  target: 'extension' | 'userscript'
}

function createIsolatedMount(host: HTMLElement) {
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)

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
