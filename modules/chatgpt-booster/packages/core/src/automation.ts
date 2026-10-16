import type {
  AutomationTriggerDraftState,
  RemoteCommandKind,
  RemoteCommandPayloadMap,
  RemoteSessionProbeResult,
  RemoteSessionStatus,
} from '@kobaproduction/browser-core'

/** Provider presentation/control ports shared by UI and runtime implementations. */
export interface ChatGptAutomationStatus {
  enabled: boolean
  domEvents: boolean
  verifiedOwner: boolean
  remote: RemoteSessionStatus | null
  sync: ChatGptArchiveSyncStatus
  triggers: AutomationTriggerDraftState
  lastError?: string
}
export interface ChatGptArchiveSyncStatus {
  state: 'idle' | 'preparing' | 'queuing' | 'queued' | 'cancelled' | 'failed'
  queuedRows: number
  totalRows: number | null
  generationId?: string
  errorCode?: string
}
export interface ChatGptAutomationControl {
  status(): ChatGptAutomationStatus
  subscribe(listener: () => void): () => void
  reconnect(): Promise<void>
  retryPending(): Promise<void>
  syncArchive(): Promise<{ queuedRows: number }>
  cancelSync(): void
  triggerState(): AutomationTriggerDraftState
  probe(candidate: {
    endpoint: string
    token: string
    signal?: AbortSignal
  }): Promise<RemoteSessionProbeResult>
  dispatch<K extends RemoteCommandKind>(kind: K, payload: RemoteCommandPayloadMap[K]): Promise<unknown>
}
