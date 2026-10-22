import type { ConversationDomSnapshot } from '@chatgpt-booster/chatgpt'
import type { BoosterModule } from '@chatgpt-booster/core'
import { serverTimeMs } from '@chatgpt-booster/core'
import {
  ARCHIVE_CONTRACT_ERROR_EVENT,
  ARCHIVE_EVENT,
  ARCHIVE_PRELOAD_EVENT,
  CONVERSATION_ACCOUNT_EVENT,
  CONVERSATION_CATALOG_EVENT,
  CONVERSATION_REQUEST_EVENT,
  CONVERSATION_STOP_EVENT,
  CONVERSATION_STREAM_EVENT,
  CONVERSATION_STREAM_STATUS_EVENT,
  type ConversationAccountEventDetail,
  type ConversationArchiveEventDetail,
  type ConversationCatalogEventDetail,
  type ConversationRequestEventDetail,
  type ConversationStopEventDetail,
  type ConversationStreamEventDetail,
  type ConversationStreamStatusEventDetail,
  TRANSPORT_CHANNEL,
} from '@chatgpt-booster/observer'
import {
  advanceHistoryCoverage,
  checkpointHistoryCoverage,
  type HistoryCoverageCheckpoint,
  nativePageEvidence,
} from './archive-coverage'
import { compareSourceObservation } from './archive-observation-policy'
import {
  ArchiveContractError,
  ArchiveSourceGate,
  type ArchiveSubmissionSnapshot,
  sameSubmissionSelection,
} from './archive-source-contract'
import type { ArchivedMessage, ConversationArchiveStore } from './archive-store'
import { ConversationObservationGateway } from './conversation-observation-gateway'
import { normalizeConversationMessage, normalizeConversationProjectId } from './conversation-records'

export type ConversationRunState =
  | 'unknown'
  | 'idle'
  | 'in_progress'
  | 'stop_requested'
  | 'stopped'
  | 'complete'
  | 'cancelled'
  | 'failed'

export interface ConversationLifecycleSnapshot {
  requestId?: string | null
  requestObservedAt?: number | null
  transportHealth?: 'unknown' | 'healthy' | 'interrupted' | 'unavailable'
  state: ConversationRunState
  userMessageId: string | null
  startedAt: number | null
  completedAt: number | null
  stopRequestedAt: number | null
  terminalCause: string | null
  updatedAt: number
  lastActivityAt?: number | null
  lastSummaryAt?: number | null
  previousSummaryAt?: number | null
  lastSummaryKey?: string | null
  activityPhase?: 'thinking' | 'tool' | 'responding'
  phaseStartedAt?: number | null
  actionMessageId?: string | null
  source: 'initial' | 'request' | 'stop' | 'transport' | 'renderer' | 'hydrated' | 'unknown'
}

export type ConversationSubagentStatus = 'waiting' | 'working' | 'done' | 'failed' | 'interrupted'

export type ConversationSubagentActivityKind = 'started' | 'interacted' | 'completed' | 'interrupted'

export interface ConversationSubagentSnapshot {
  threadId: string
  agentPath: string | null
  displayName: string | null
  prompt: string | null
  status: ConversationSubagentStatus
  statusMessage: string | null
  activityKind: ConversationSubagentActivityKind | null
  lastObservedAt: number | null
}

export interface ConversationMemorySnapshot {
  conversationId: string
  projectId: string | null
  conversationOrigin: string | null
  title: string | null
  currentNodeId: string | null
  lastObservedAt: number
  revision: number
  lifecycle: ConversationLifecycleSnapshot
  subagents: ConversationSubagentSnapshot[]
  records: ArchivedMessage[]
  pages: ConversationArchiveEventDetail[]
}

export interface ConversationStateChange {
  conversationId: string
  revision: number
  reason: 'page' | 'catalog' | 'request' | 'stop' | 'transport' | 'renderer' | 'dom' | 'hydrate'
}
export interface ConversationProjectCatalogEntry {
  projectId: string
  title: string
  requestStartedAt: number
  observedAt: number
}

interface MutableConversationState {
  startEvidence?: import('./archive-start-evidence').ConversationStartEvidence
  safetyReview?: { active: boolean; message: string | null; protectionType: 'bio' | 'cyber' | null }
  conversationId: string
  projectId: string | null
  conversationOrigin: string | null
  title: string | null
  currentNodeId: string | null
  lastObservedAt: number
  revision: number
  lifecycle: ConversationLifecycleSnapshot
  records: Map<string, ArchivedMessage>
  turnIndex: Map<string, Set<string>>
  pages: Map<string, ConversationArchiveEventDetail>
  pageCoverage?: HistoryCoverageCheckpoint | undefined
  pageReplayIncomplete?: boolean | undefined
  headReadId: string | null
  headReadStartedAt: number | null
  catalogReadStartedAt: number | null
  recordReads: Map<string, { readId: string; startedAt: number }>
  submissionSelections: Map<string, ArchiveSubmissionSnapshot>
  hydrated: boolean
  hydration: Promise<void> | undefined
}

const MAX_CONVERSATIONS = 12
const MAX_PAGES_PER_CONVERSATION = 96
const ACTIVE_MESSAGE_STATUS = new Set(['in_progress', 'streaming', 'running'])
const STOPPED_MESSAGE_STATUS = new Set(['stopped', 'cancelled', 'canceled'])

function asyncStatusIsActive(value: unknown): boolean {
  if (typeof value === 'number') return [3, 5, 6, 7].includes(value)
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  if (/^\d+$/.test(normalized)) return [3, 5, 6, 7].includes(Number(normalized))
  return [
    'streaming',
    'realtime',
    'realtime_busy',
    'realtime_background',
    'in_progress',
    'running',
  ].includes(normalized)
}

function asyncStatusIsInactive(value: unknown): boolean {
  if (value === null) return true
  if (typeof value === 'number') return value === 4
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  if (/^\d+$/.test(normalized)) return Number(normalized) === 4
  return ['complete', 'completed', 'stopped', 'cancelled', 'canceled', 'failed', 'unread'].includes(
    normalized,
  )
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function sourceTime(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return serverTimeMs(value)
}

function sourceSummaryKey(record: ArchivedMessage | undefined): string | null {
  if (!record) return null
  const content = asRecord(record.raw.content)
  const thoughts = Array.isArray(content?.thoughts) ? content.thoughts : []
  const last = asRecord(thoughts.at(-1))
  if (typeof last?.summary === 'string' && last.summary.trim())
    return JSON.stringify([record.messageId, thoughts.length - 1, last.summary])
  const title = asRecord(record.raw.metadata)?.reasoning_title
  if (typeof title === 'string' && title.trim()) return JSON.stringify([record.messageId, title])
  return record.contentType === 'reasoning_recap' ? record.messageId : null
}

function visibleFinal(record: ArchivedMessage) {
  return (
    record.role === 'assistant' &&
    record.recipient === 'all' &&
    (!record.channel || record.channel === 'final') &&
    (record.contentType === 'text' || record.contentType === 'multimodal_text')
  )
}

function pageKey(detail: ConversationArchiveEventDetail) {
  const info = asRecord(detail.payload.page_info)
  const start = typeof info?.start_cursor === 'string' ? info.start_cursor : ''
  const end = typeof info?.end_cursor === 'string' ? info.end_cursor : ''
  return [detail.readId ?? 'live', detail.isInitial ? 'initial' : 'page', start, end].join(':')
}

function initialLifecycle(): ConversationLifecycleSnapshot {
  return {
    state: 'unknown',
    userMessageId: null,
    startedAt: null,
    completedAt: null,
    stopRequestedAt: null,
    terminalCause: null,
    updatedAt: 0,
    source: 'unknown',
  }
}

function recordSort(a: ArchivedMessage, b: ArchivedMessage) {
  return (
    serverTimeMs(a.createTime, a.firstSeenAt) - serverTimeMs(b.createTime, b.firstSeenAt) ||
    a.messageId.localeCompare(b.messageId)
  )
}

const SUBAGENT_ACTIVITY_KINDS = new Set<ConversationSubagentActivityKind>([
  'started',
  'interacted',
  'completed',
  'interrupted',
])
const COLLAB_AGENT_TOOLS = new Set(['spawnAgent', 'sendInput', 'resumeAgent', 'wait', 'closeAgent'])

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function subagentDisplayName(path: string | null): string | null {
  const value = path?.split('/').filter(Boolean).at(-1)?.trim()
  if (!value) return null
  return value.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

function collabAgentState(value: unknown): {
  status: ConversationSubagentStatus
  message: string | null
} | null {
  const state = asRecord(value)
  const rawStatus = typeof state?.status === 'string' ? state.status : null
  if (!rawStatus) return null
  const message = typeof state?.message === 'string' && state.message.trim() ? state.message : null
  if (rawStatus === 'pendingInit') return { status: 'waiting', message: null }
  if (rawStatus === 'running') return { status: 'working', message: null }
  if (rawStatus === 'errored' || rawStatus === 'notFound') return { status: 'failed', message }
  if (rawStatus === 'interrupted') return { status: 'interrupted', message }
  if (rawStatus === 'completed' || rawStatus === 'shutdown') return { status: 'done', message }
  return null
}

function subagentsFromRecords(records: Iterable<ArchivedMessage>): ConversationSubagentSnapshot[] {
  const agents = new Map<string, ConversationSubagentSnapshot>()
  const sorted = [...records].sort(recordSort)

  const ensure = (threadId: string, observedAt: number | null) => {
    const current = agents.get(threadId)
    if (current) {
      if (observedAt !== null) current.lastObservedAt = Math.max(current.lastObservedAt ?? 0, observedAt)
      return current
    }
    const created: ConversationSubagentSnapshot = {
      threadId,
      agentPath: null,
      displayName: null,
      prompt: null,
      status: 'working',
      statusMessage: null,
      activityKind: null,
      lastObservedAt: observedAt,
    }
    agents.set(threadId, created)
    return created
  }

  for (const message of sorted) {
    const metadata = asRecord(message.raw.metadata)
    const observedAt =
      sourceTime(message.updateTime) ?? sourceTime(message.createTime) ?? message.lastSeenAt

    const activity = asRecord(metadata?.codex_sub_agent_activity)
    const activityThreadId = typeof activity?.agentThreadId === 'string' ? activity.agentThreadId : null
    const activityKind =
      typeof activity?.kind === 'string' &&
      SUBAGENT_ACTIVITY_KINDS.has(activity.kind as ConversationSubagentActivityKind)
        ? (activity.kind as ConversationSubagentActivityKind)
        : null
    if (activityThreadId && activityKind) {
      const agent = ensure(activityThreadId, observedAt)
      const agentPath = typeof activity?.agentPath === 'string' ? activity.agentPath : null
      if (agentPath) {
        agent.agentPath = agentPath
        agent.displayName = subagentDisplayName(agentPath)
      }
      agent.activityKind = activityKind
      agent.status =
        activityKind === 'interrupted'
          ? 'interrupted'
          : activityKind === 'completed'
            ? 'done'
            : 'working'
      if (agent.status === 'working') agent.statusMessage = null
    }

    const toolCall = asRecord(metadata?.codex_collab_agent_tool_call)
    const tool = typeof toolCall?.tool === 'string' ? toolCall.tool : null
    if (!tool || !COLLAB_AGENT_TOOLS.has(tool)) continue
    const receiverThreadIds = stringArray(toolCall?.receiverThreadIds)
    const prompt =
      typeof toolCall?.prompt === 'string' && toolCall.prompt.trim() ? toolCall.prompt : null
    for (const threadId of receiverThreadIds) {
      const agent = ensure(threadId, observedAt)
      if (tool === 'spawnAgent' && prompt) agent.prompt = prompt
      if (tool === 'spawnAgent' || tool === 'sendInput' || tool === 'resumeAgent') {
        agent.status = 'working'
        agent.statusMessage = null
      }
    }

    const states = asRecord(toolCall?.agentsStates)
    if (states) {
      for (const [threadId, value] of Object.entries(states)) {
        const normalized = collabAgentState(value)
        if (!normalized) continue
        const agent = ensure(threadId, observedAt)
        agent.status = normalized.status
        agent.statusMessage = normalized.message
        if (normalized.status === 'interrupted') agent.activityKind = 'interrupted'
      }
    }
  }

  return [...agents.values()].sort((a, b) => {
    const left = a.lastObservedAt ?? 0
    const right = b.lastObservedAt ?? 0
    return left - right || a.threadId.localeCompare(b.threadId)
  })
}

export interface RejectedConversationSource {
  conversationId: string
  accountId: string
  observedAt: number
  sourceKind: 'stream' | 'page'
  raw: Record<string, unknown>
  evidence?: readonly Record<string, unknown>[]
}
export class ConversationStateStore implements BoosterModule {
  readonly id = 'conversation-state'
  readonly observations = new ConversationObservationGateway()
  #states = new Map<string, MutableConversationState>()
  #catalogOrigins = new Map<string, string | null>()
  #projects = new Map<string, ConversationProjectCatalogEntry>()
  #verifiedAccountId: string | null = null
  #accountEpoch = 0
  #catalogListeners = new Set<(detail: ConversationCatalogEventDetail) => void>()
  #accountListeners = new Set<() => void>()
  #listeners = new Set<(change: ConversationStateChange) => void>()
  #pageListeners = new Set<(detail: ConversationArchiveEventDetail) => void>()
  #rejectedSourceListeners = new Set<(detail: RejectedConversationSource) => void>()
  #streamMessageListeners = new Set<
    (detail: {
      conversationId: string
      raw: Record<string, unknown>
      observedAt: number
      accountId: string | null
      activeRun: boolean
      requestId?: string | null
      evidence?: readonly Record<string, unknown>[]
    }) => void
  >()
  #active = false
  #pendingRequests = new Map<string, ConversationRequestEventDetail>()
  #runConversations = new Map<string, string>()

  constructor(
    private readonly messageSource: Window = window,
    readonly sourceGate = new ArchiveSourceGate(),
  ) {}

  start() {
    if (this.#active) return
    this.#active = true
    window.addEventListener('message', this.#onMessage)
  }

  stop() {
    if (!this.#active) return
    this.#active = false
    window.removeEventListener('message', this.#onMessage)
    this.#listeners.clear()
    this.#pageListeners.clear()
    this.#rejectedSourceListeners.clear()
    this.#streamMessageListeners.clear()
    this.#accountListeners.clear()
    this.#catalogListeners.clear()
    this.#pendingRequests.clear()
    this.#runConversations.clear()
    // Observation was detached: the native application may select another owner while disabled.
    // A later activation must obtain fresh source proof before exposing or appending any data.
    this.#verifiedAccountId = null
    this.#states.clear()
    this.#catalogOrigins.clear()
    this.#projects.clear()
    this.#accountEpoch++
    this.observations.reset(null, this.#accountEpoch)
  }

  /** Only observer-verified native registry/selector evidence qualifies. */
  verifiedAccountId(): string | null {
    return this.#verifiedAccountId
  }
  accountEpoch(): number {
    return this.#accountEpoch
  }
  subscribeCatalog(listener: (detail: ConversationCatalogEventDetail) => void): () => void {
    this.#catalogListeners.add(listener)
    return () => this.#catalogListeners.delete(listener)
  }
  listProjects(): readonly ConversationProjectCatalogEntry[] {
    return this.#verifiedAccountId ? [...this.#projects.values()].map((entry) => ({ ...entry })) : []
  }
  project(projectId: string): ConversationProjectCatalogEntry | undefined {
    const entry = this.#verifiedAccountId ? this.#projects.get(projectId) : undefined
    return entry ? { ...entry } : undefined
  }

  ingestAccount(detail: ConversationAccountEventDetail) {
    const next = typeof detail.accountId === 'string' && detail.accountId ? detail.accountId : null
    if (next === this.#verifiedAccountId) return
    // Native history observed without a confirmed owner cannot be silently
    // attributed later. A switch also invalidates every prior RAM view.
    this.#accountEpoch++
    this.#states.clear()
    this.#pendingRequests.clear()
    this.#runConversations.clear()
    this.#catalogOrigins.clear()
    this.#projects.clear()
    this.#verifiedAccountId = next
    this.observations.reset(next, this.#accountEpoch)
    for (const listener of this.#accountListeners) {
      try {
        listener()
      } catch {
        /* Local listeners must not interrupt native observation. */
      }
    }
  }

  subscribeAccount(listener: () => void): () => void {
    this.#accountListeners.add(listener)
    return () => this.#accountListeners.delete(listener)
  }

  subscribe(listener: (change: ConversationStateChange) => void) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  subscribePages(listener: (detail: ConversationArchiveEventDetail) => void) {
    this.#pageListeners.add(listener)
    return () => this.#pageListeners.delete(listener)
  }

  subscribeStreamMessages(
    listener: (detail: {
      conversationId: string
      raw: Record<string, unknown>
      observedAt: number
      accountId: string | null
      activeRun: boolean
      requestId?: string | null
      evidence?: readonly Record<string, unknown>[]
    }) => void,
  ) {
    this.#streamMessageListeners.add(listener)
    return () => this.#streamMessageListeners.delete(listener)
  }
  subscribeRejectedSource(listener: (detail: RejectedConversationSource) => void) {
    this.#rejectedSourceListeners.add(listener)
    return () => this.#rejectedSourceListeners.delete(listener)
  }
  #rejectedSource(detail: Omit<RejectedConversationSource, 'accountId'>) {
    const owner = this.#verifiedAccountId
    if (!owner) return
    for (const listener of this.#rejectedSourceListeners)
      try {
        listener({ ...detail, accountId: owner, raw: structuredClone(detail.raw) })
      } catch {
        /* Rejection evidence cannot bypass the source gate. */
      }
  }

  revision(conversationId: string) {
    return this.#states.get(conversationId)?.revision ?? 0
  }

  lifecycle(conversationId: string): ConversationLifecycleSnapshot | undefined {
    const value = this.#states.get(conversationId)?.lifecycle
    return value ? { ...value } : undefined
  }
  safetyReview(conversationId: string) {
    const value = this.#states.get(conversationId)?.safetyReview
    return value ? { ...value } : undefined
  }

  conversationOrigin(conversationId: string): string | null | undefined {
    return (
      this.#states.get(conversationId)?.conversationOrigin ?? this.#catalogOrigins.get(conversationId)
    )
  }

  subagents(conversationId: string): ConversationSubagentSnapshot[] {
    const state = this.#states.get(conversationId)
    return state ? subagentsFromRecords(state.records.values()) : []
  }

  /** Context-only access never copies or sorts the live transcript. */
  header(conversationId: string) {
    const state = this.#states.get(conversationId)
    return state
      ? {
          conversationId,
          projectId: state.projectId,
          title: state.title,
          currentNodeId: state.currentNodeId,
          revision: state.revision,
          lastObservedAt: state.lastObservedAt,
          headReadId: state.headReadId,
          headReadStartedAt: state.headReadStartedAt,
          startEvidence: state.startEvidence,
        }
      : undefined
  }

  snapshot(conversationId: string): ConversationMemorySnapshot | undefined {
    const state = this.#states.get(conversationId)
    if (!state) return undefined
    return {
      conversationId,
      projectId: state.projectId,
      conversationOrigin: state.conversationOrigin,
      title: state.title,
      currentNodeId: state.currentNodeId,
      lastObservedAt: state.lastObservedAt,
      revision: state.revision,
      lifecycle: { ...state.lifecycle },
      subagents: subagentsFromRecords(state.records.values()),
      records: [...state.records.values()].sort(recordSort),
      pages: [...state.pages.values()].sort((a, b) => a.timestamp - b.timestamp),
    }
  }

  listSnapshots(): ConversationMemorySnapshot[] {
    return [...this.#states.keys()]
      .map((conversationId) => this.snapshot(conversationId))
      .filter((value): value is ConversationMemorySnapshot => Boolean(value))
      .sort((a, b) => b.lastObservedAt - a.lastObservedAt)
  }

  listMessages(conversationId: string): ArchivedMessage[] {
    return [...(this.#states.get(conversationId)?.records.values() ?? [])].sort(recordSort)
  }

  getMessage(conversationId: string, messageId: string): ArchivedMessage | undefined {
    return this.#states.get(conversationId)?.records.get(messageId)
  }

  recordsForMessageIds(conversationId: string, messageIds: readonly string[]): ArchivedMessage[] {
    const state = this.#states.get(conversationId)
    if (!state) return []
    const keys = new Set<string>()
    const direct = new Set<string>()
    for (const id of messageIds) {
      const item = state.records.get(id)
      if (!item) continue
      direct.add(item.messageId)
      if (item.turnExchangeId) keys.add(item.turnExchangeId)
      if (item.workingTurnId) keys.add(item.workingTurnId)
    }
    const ids = new Set(direct)
    for (const key of keys) for (const id of state.turnIndex.get(key) ?? []) ids.add(id)
    return [...ids]
      .map((id) => state.records.get(id))
      .filter((item): item is ArchivedMessage => Boolean(item))
      .sort(recordSort)
  }

  pages(conversationId: string): ConversationArchiveEventDetail[] {
    return [...(this.#states.get(conversationId)?.pages.values() ?? [])].sort(
      (a, b) => a.timestamp - b.timestamp,
    )
  }
  nativeHistoryCoverage(conversationId: string) {
    const state = this.#states.get(conversationId)
    return {
      ...checkpointHistoryCoverage(state?.pageCoverage),
      replayComplete: !state?.pageReplayIncomplete,
    }
  }

  ingestPage(detail: ConversationArchiveEventDetail) {
    if (detail.accountId !== undefined && detail.accountId !== this.#verifiedAccountId) return
    if (detail.payload.conversation_id && detail.payload.conversation_id !== detail.conversationId)
      return
    const observation = this.observations.receive(detail.conversationId, { kind: 'page', detail })
    try {
      this.sourceGate.inspect(detail)
    } catch (error) {
      this.#rejectedSource({
        conversationId: detail.conversationId,
        observedAt: detail.timestamp,
        sourceKind: 'page',
        raw: detail.payload,
      })
      throw error
    }
    const payload = detail.payload
    if (!payload || !Array.isArray(payload.messages)) return
    const conversationId =
      typeof payload.conversation_id === 'string' ? payload.conversation_id : detail.conversationId
    if (!conversationId || conversationId !== detail.conversationId) return
    const observedAt = detail.timestamp
    const readStartedAt = detail.readStartedAt ?? observedAt
    if (!Number.isFinite(observedAt) || !Number.isFinite(readStartedAt)) return
    const state = this.#ensure(conversationId)
    const initial = detail.isInitial === true || detail.isInitial === undefined
    const freshHead =
      initial &&
      (state.headReadStartedAt === null ||
        readStartedAt > state.headReadStartedAt ||
        (readStartedAt === state.headReadStartedAt && (detail.readId ?? null) === state.headReadId))
    if (freshHead) {
      if (detail.readId !== state.headReadId || readStartedAt !== state.headReadStartedAt)
        state.pageReplayIncomplete = false
      if (readStartedAt >= (state.catalogReadStartedAt ?? -Infinity)) {
        if (Object.hasOwn(payload, 'gizmo_id')) state.projectId = normalizeConversationProjectId(payload)
        if (typeof payload.title === 'string') state.title = payload.title
      }
      if (Object.hasOwn(payload, 'conversation_origin'))
        state.conversationOrigin =
          typeof payload.conversation_origin === 'string' ? payload.conversation_origin : null
      if (Object.hasOwn(payload, 'current_node'))
        state.currentNodeId = typeof payload.current_node === 'string' ? payload.current_node : null
      state.headReadId = detail.readId ?? null
      state.headReadStartedAt = readStartedAt
    }
    state.lastObservedAt = Math.max(state.lastObservedAt, observedAt)
    for (const value of payload.messages) {
      const raw = asRecord(value)
      if (!raw || typeof raw.id !== 'string') continue
      const previous = state.records.get(raw.id)
      const previousRead = state.recordReads.get(raw.id)
      if (
        previousRead &&
        (readStartedAt < previousRead.startedAt ||
          (readStartedAt === previousRead.startedAt && (detail.readId ?? '') !== previousRead.readId))
      )
        continue
      const oldVersion = previous && (asRecord(previous.raw)?.update_time ?? previous.createTime)
      const newVersion = raw.update_time ?? raw.create_time
      if (
        previous &&
        (previous.lastSeenAt > observedAt ||
          (typeof oldVersion === 'number' && typeof newVersion === 'number' && newVersion < oldVersion))
      )
        continue
      const normalized = normalizeConversationMessage(
        raw,
        conversationId,
        state.projectId,
        observedAt,
        previous,
      )
      if (!normalized) continue
      this.#mergeRecord(state, normalized)
      state.recordReads.set(raw.id, { readId: detail.readId ?? '', startedAt: readStartedAt })
    }
    const id = pageKey(detail)
    const pageInfo = asRecord(payload.page_info)
    if (
      !state.startEvidence &&
      pageInfo?.has_previous_page === false &&
      typeof pageInfo.start_cursor === 'string' &&
      typeof detail.readId === 'string' &&
      state.records.has(pageInfo.start_cursor)
    )
      state.startEvidence = {
        kind: 'native-page',
        firstMessageId: pageInfo.start_cursor,
        sourceId: detail.readId,
        observedAt: detail.timestamp,
      }
    state.pageCoverage = advanceHistoryCoverage(state.pageCoverage, nativePageEvidence(detail))
    if (detail.isInitial)
      for (const retained of state.pages.values())
        if (!retained.isInitial)
          state.pageCoverage = advanceHistoryCoverage(state.pageCoverage, nativePageEvidence(retained))
    const oldPage = state.pages.get(id)
    if (!oldPage || oldPage.timestamp <= observedAt) state.pages.set(id, detail)
    while (state.pages.size > MAX_PAGES_PER_CONVERSATION) {
      const oldest = [...state.pages.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0]
      if (!oldest) break
      if (state.pages.get(oldest)?.readId === state.headReadId) state.pageReplayIncomplete = true
      state.pages.delete(oldest)
    }
    // Older continuations cannot roll back lifecycle evidence from a newer native submit.
    if (freshHead && (state.lifecycle.requestObservedAt ?? -Infinity) <= readStartedAt)
      this.#inferLifecycleFromPage(state, payload, observedAt)
    this.#touch(state, 'page')
    this.observations.admit(observation, { kind: 'page', detail })
    for (const listener of this.#pageListeners) {
      try {
        listener(detail)
      } catch {
        /* Persistence must never interrupt native RAM observation. */
      }
    }
  }

  ingestCatalog(detail: ConversationCatalogEventDetail) {
    if (detail.accountId !== undefined && detail.accountId !== this.#verifiedAccountId) return
    const startedAt = detail.requestStartedAt ?? detail.observedAt
    if (!Number.isFinite(startedAt) || !Number.isFinite(detail.observedAt)) return
    const projects: { projectId: string; title: string }[] = []
    if (this.#verifiedAccountId && detail.accountId === this.#verifiedAccountId)
      for (const item of detail.projects ?? []) {
        if (
          typeof item.projectId !== 'string' ||
          !item.projectId.startsWith('g-p-') ||
          item.projectId.length <= 4 ||
          item.projectId.length > 256 ||
          /[\s/?#]/.test(item.projectId) ||
          typeof item.title !== 'string' ||
          !item.title.trim() ||
          item.title.length > 4096
        )
          continue
        const previous = this.#projects.get(item.projectId)
        if (previous && startedAt <= previous.requestStartedAt) continue
        this.#projects.delete(item.projectId)
        this.#projects.set(item.projectId, {
          projectId: item.projectId,
          title: item.title,
          requestStartedAt: startedAt,
          observedAt: detail.observedAt,
        })
        projects.push({ projectId: item.projectId, title: item.title })
      }
    while (this.#projects.size > 200) {
      const oldest = this.#projects.keys().next().value
      if (oldest === undefined) break
      this.#projects.delete(oldest)
    }
    const changes: ConversationStateChange[] = []
    for (const item of detail.items) {
      const state = this.#states.get(item.conversationId)
      if (
        state &&
        startedAt <
          Math.max(state.catalogReadStartedAt ?? -Infinity, state.headReadStartedAt ?? -Infinity)
      )
        continue
      const previousOrigin = this.#catalogOrigins.get(item.conversationId)
      this.#catalogOrigins.set(item.conversationId, item.conversationOrigin)
      let changed = previousOrigin !== item.conversationOrigin
      if (state) {
        const projectId =
          item.projectKnown === true ? item.projectId : (item.projectId ?? state.projectId)
        changed ||= projectId !== state.projectId || item.conversationOrigin !== state.conversationOrigin
        state.projectId = projectId
        if (typeof item.title === 'string' && item.title.trim()) {
          changed ||= state.title !== item.title
          state.title = item.title
        }
        state.catalogReadStartedAt = startedAt
        state.conversationOrigin = item.conversationOrigin
        state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
        if (changed) state.revision++
      }
      if (changed)
        changes.push({
          conversationId: item.conversationId,
          revision: state?.revision ?? 0,
          reason: 'catalog',
        })
    }
    while (this.#catalogOrigins.size > 200) {
      const first = this.#catalogOrigins.keys().next().value
      if (typeof first !== 'string') break
      this.#catalogOrigins.delete(first)
    }
    for (const change of changes)
      for (const listener of this.#listeners) {
        try {
          listener(change)
        } catch {
          /* Display subscriptions cannot stop native catalog ingestion. */
        }
      }
    for (const listener of this.#catalogListeners) {
      try {
        listener({ ...detail, ...(detail.projects ? { projects } : {}) })
      } catch {
        /* Optional persistence remains separate. */
      }
    }
  }

  submissionSelection(conversationId: string, messageId: string): ArchiveSubmissionSnapshot | undefined {
    const snapshot = this.#states.get(conversationId)?.submissionSelections.get(messageId)
    return snapshot
      ? { selection: { ...snapshot.selection }, conflicted: snapshot.conflicted }
      : undefined
  }

  #rememberRun(requestId: string, conversationId: string) {
    this.#runConversations.set(requestId, conversationId)
    while (this.#runConversations.size > 512) {
      const oldest = this.#runConversations.keys().next().value
      if (oldest === undefined) break
      this.#runConversations.delete(oldest)
    }
  }

  ingestRequest(detail: ConversationRequestEventDetail) {
    const conversationId =
      detail.conversationId ??
      (detail.requestId ? this.#runConversations.get(detail.requestId) : undefined) ??
      null
    if (detail.accountId !== undefined && detail.accountId !== this.#verifiedAccountId) return
    if (!conversationId) {
      if (detail.requestId) {
        this.#pendingRequests.set(detail.requestId, detail)
        while (this.#pendingRequests.size > 128) {
          const oldest = this.#pendingRequests.keys().next().value
          if (oldest === undefined) break
          this.#pendingRequests.delete(oldest)
        }
      }
      return
    }
    if (
      detail.requestId &&
      this.#runConversations.has(detail.requestId) &&
      this.#runConversations.get(detail.requestId) !== conversationId
    )
      return
    if (detail.requestId) this.#rememberRun(detail.requestId, conversationId)
    const requestObservation = this.observations.receive(conversationId, { kind: 'request', detail })
    const state = this.#ensure(conversationId)
    // Delayed/duplicate observations cannot replace a newer request or reopen its terminal state.
    if (
      state.lifecycle.requestObservedAt !== null &&
      state.lifecycle.requestObservedAt !== undefined &&
      (detail.observedAt < state.lifecycle.requestObservedAt ||
        (!!detail.requestId && detail.requestId === state.lifecycle.requestId))
    )
      return
    if (
      detail.submissionSelection &&
      this.#verifiedAccountId &&
      detail.accountId === this.#verifiedAccountId &&
      detail.conversationId === conversationId &&
      detail.submissionSelection.messageId === detail.userMessageId
    ) {
      try {
        this.sourceGate.inspectSubmissionSelection(conversationId, detail.submissionSelection)
        const previous = state.submissionSelections.get(detail.submissionSelection.messageId)
        state.submissionSelections.set(detail.submissionSelection.messageId, {
          selection: { ...(previous?.selection ?? detail.submissionSelection) },
          conflicted:
            previous?.conflicted === true ||
            (!!previous && !sameSubmissionSelection(previous.selection, detail.submissionSelection)),
        })
        while (state.submissionSelections.size > 256) {
          const oldest = state.submissionSelections.keys().next().value
          if (oldest === undefined) break
          state.submissionSelections.delete(oldest)
        }
      } catch (cause) {
        if (!(cause instanceof ArchiveContractError)) throw cause
        // Archival evidence is rejected; the native lifecycle/timer still starts normally.
      }
    }
    if (Object.hasOwn(detail, 'conversationOrigin'))
      state.conversationOrigin =
        typeof detail.conversationOrigin === 'string' ? detail.conversationOrigin : null
    // A local/renderer chat ID is never authority. This path is reached after the
    // pending native create request has been correlated with a server stream ID.
    const submitted = detail.submission ?? detail.creation
    if (
      submitted &&
      detail.requestId &&
      detail.accountId === this.#verifiedAccountId &&
      this.#verifiedAccountId &&
      submitted.message.id === detail.userMessageId &&
      asRecord(submitted.message.author)?.role === 'user'
    ) {
      if (detail.creation?.projectId) state.projectId = detail.creation.projectId
      const raw = submitted.message
      const first = normalizeConversationMessage(raw, conversationId, state.projectId, detail.observedAt)
      if (first) {
        if (detail.creation && !state.startEvidence)
          state.startEvidence = {
            kind: 'native-create',
            firstMessageId: first.messageId,
            sourceId: detail.requestId,
            observedAt: detail.observedAt,
          }
        this.#mergeRecord(state, first)
        this.observations.admit(requestObservation, {
          kind: 'message',
          detail: {
            conversationId,
            accountId: this.#verifiedAccountId,
            raw,
            observedAt: detail.observedAt,
            activeRun: false,
            requestId: detail.requestId,
            ...(detail.creation && state.startEvidence ? { startEvidence: state.startEvidence } : {}),
            evidence: [
              {
                kind: detail.creation ? 'native-create' : 'native-submission',
                requestId: detail.requestId,
                userMessageId: raw.id,
                parentMessageId: submitted.parentMessageId,
              },
            ],
          },
        })
      }
    }
    state.lifecycle = {
      state: 'in_progress',
      userMessageId: detail.userMessageId,
      startedAt: detail.startedAt,
      completedAt: null,
      stopRequestedAt: null,
      terminalCause: null,
      updatedAt: detail.observedAt,
      source: 'request',
      requestId: detail.requestId ?? null,
      requestObservedAt: detail.observedAt,
      transportHealth: 'healthy',
      lastActivityAt: detail.observedAt,
      lastSummaryAt: null,
      previousSummaryAt: null,
      lastSummaryKey: null,
      activityPhase: 'thinking',
      phaseStartedAt: detail.startedAt,
      actionMessageId: null,
    }
    state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
    this.#touch(state, 'request')
  }

  ingestStop(detail: ConversationStopEventDetail) {
    const conversationId =
      detail.conversationId ??
      (detail.requestId ? this.#runConversations.get(detail.requestId) : undefined) ??
      null
    if (!conversationId) return
    this.observations.receive(conversationId, { kind: 'stop', detail })
    const state = this.#states.get(conversationId)
    if (!state || !['in_progress', 'stop_requested', 'stopped'].includes(state.lifecycle.state)) return
    const previous = state.lifecycle
    if (previous.requestId && detail.requestId !== previous.requestId) return
    if (detail.phase === 'requested') {
      state.lifecycle = {
        ...previous,
        state: 'stop_requested',
        stopRequestedAt: detail.timestamp,
        terminalCause: null,
        updatedAt: detail.timestamp,
        source: 'stop',
      }
    } else if (detail.phase === 'confirmed') {
      state.lifecycle = {
        ...previous,
        state: 'stopped',
        completedAt: detail.timestamp,
        updatedAt: detail.timestamp,
        source: 'stop',
      }
    } else if (previous.state === 'stop_requested') {
      state.lifecycle = {
        ...previous,
        state: 'in_progress',
        stopRequestedAt: null,
        terminalCause: null,
        updatedAt: detail.timestamp,
        source: 'stop',
      }
    }
    state.lastObservedAt = Math.max(state.lastObservedAt, detail.timestamp)
    this.#touch(state, 'stop')
  }

  ingestStreamStatus(detail: ConversationStreamStatusEventDetail) {
    this.observations.receive(detail.conversationId, { kind: 'status', detail })
    if (detail.status !== 'COMPLETE') return
    const state = this.#states.get(detail.conversationId)
    if (!state) return
    const previous = state.lifecycle
    if (!previous.requestId || detail.requestId !== previous.requestId) return
    if (
      previous.state === 'stop_requested' ||
      previous.state === 'stopped' ||
      previous.state === 'failed' ||
      (previous.state === 'complete' && previous.completedAt !== null)
    )
      return
    state.lifecycle = {
      ...previous,
      state: 'complete',
      completedAt: detail.observedAt,
      updatedAt: detail.observedAt,
      source: 'transport',
    }
    state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
    this.#touch(state, 'transport')
  }

  ingestStreamEvent(detail: ConversationStreamEventDetail) {
    if (detail.accountId !== undefined && detail.accountId !== this.#verifiedAccountId) return
    const conversationId =
      detail.conversationId ??
      (detail.requestId ? this.#runConversations.get(detail.requestId) : undefined) ??
      null
    if (!conversationId) return
    if (
      detail.requestId &&
      this.#runConversations.has(detail.requestId) &&
      this.#runConversations.get(detail.requestId) !== conversationId
    )
      return
    const observation = this.observations.receive(conversationId, { kind: 'stream', detail })
    if (detail.requestId && this.#pendingRequests.has(detail.requestId)) {
      const pending = this.#pendingRequests.get(detail.requestId)
      if (
        pending &&
        (!pending.creation ||
          detail.kind === 'handoff' ||
          (detail.kind === 'message' && typeof detail.record.id === 'string')) &&
        detail.observedAt - pending.observedAt >= 0 &&
        detail.observedAt - pending.observedAt <= 120_000
      ) {
        this.#pendingRequests.delete(detail.requestId)
        this.ingestRequest({ ...pending, conversationId })
      }
    }
    if (detail.kind === 'message') {
      try {
        this.sourceGate.inspectStreamMessage(conversationId, detail.record)
      } catch (error) {
        this.#rejectedSource({
          conversationId,
          observedAt: detail.observedAt,
          sourceKind: 'stream',
          raw: detail.record,
          ...(detail.evidence ? { evidence: detail.evidence } : {}),
        })
        throw error
      }
    }
    const state = this.#ensure(conversationId)
    const historyUser = state.lifecycle.userMessageId
      ? state.records.get(state.lifecycle.userMessageId)
      : undefined
    const streamMetadata = detail.kind === 'message' ? asRecord(detail.record.metadata) : null
    const recoveredRun = Boolean(
      !state.lifecycle.requestId &&
        state.lifecycle.requestObservedAt == null &&
        ['in_progress', 'stop_requested'].includes(state.lifecycle.state) &&
        detail.observedAt >= (state.headReadStartedAt ?? 0) &&
        historyUser &&
        (detail.userMessageId === historyUser.messageId ||
          (historyUser.turnExchangeId &&
            streamMetadata?.turn_exchange_id === historyUser.turnExchangeId) ||
          (historyUser.workingTurnId && streamMetadata?.working_turn_id === historyUser.workingTurnId)),
    )
    if (recoveredRun && detail.requestId) {
      state.lifecycle = { ...state.lifecycle, requestId: detail.requestId }
      this.#rememberRun(detail.requestId, conversationId)
    }
    const sameRun = state.lifecycle.requestId
      ? detail.requestId === state.lifecycle.requestId
      : state.lifecycle.source === 'request' && !detail.requestId
        ? detail.userMessageId
          ? detail.userMessageId === state.lifecycle.userMessageId
          : true
        : recoveredRun
    if (detail.kind === 'message') {
      const previousRecord =
        typeof detail.record.id === 'string' ? state.records.get(detail.record.id) : undefined
      const normalized = normalizeConversationMessage(
        detail.record,
        conversationId,
        state.projectId,
        detail.observedAt,
        previousRecord,
      )
      if (!normalized) return
      const accepted = this.#mergeRecord(state, normalized)
      // Message ancestry is not request correlation, especially during a retry of the same turn.
      const affectsRun = accepted && sameRun
      if (
        affectsRun &&
        normalized.role === 'user' &&
        state.lifecycle.userMessageId !== normalized.messageId &&
        (sourceTime(normalized.createTime) ?? 0) >= (state.lifecycle.startedAt ?? 0)
      ) {
        state.lifecycle = {
          state: 'in_progress',
          userMessageId: normalized.messageId,
          requestId: detail.requestId ?? null,
          requestObservedAt: detail.observedAt,
          startedAt: sourceTime(normalized.createTime) ?? detail.observedAt,
          completedAt: null,
          stopRequestedAt: null,
          terminalCause: null,
          source: 'transport',
          updatedAt: detail.observedAt,
        }
      } else if (
        affectsRun &&
        ACTIVE_MESSAGE_STATUS.has(normalized.status ?? '') &&
        !['stop_requested', 'stopped', 'complete', 'failed', 'cancelled'].includes(state.lifecycle.state)
      ) {
        state.lifecycle = {
          ...state.lifecycle,
          state: 'in_progress',
          completedAt: null,
          terminalCause: null,
          source: 'transport',
          updatedAt: detail.observedAt,
        }
      }
      if (affectsRun && detail.observedAt >= (state.lifecycle.lastActivityAt ?? 0)) {
        const previous = state.lifecycle
        const phase =
          normalized.role === 'tool' || (normalized.recipient && normalized.recipient !== 'all')
            ? 'tool'
            : visibleFinal(normalized) && normalized.role === 'assistant'
              ? 'responding'
              : 'thinking'
        const actionId = normalized.role === 'tool' ? normalized.parentId : normalized.messageId
        const summaryKey = sourceSummaryKey(normalized)
        const newSummary =
          summaryKey !== null &&
          summaryKey !== previous.lastSummaryKey &&
          summaryKey !== sourceSummaryKey(previousRecord)
        state.lifecycle = {
          ...previous,
          lastActivityAt: detail.observedAt,
          activityPhase: phase,
          phaseStartedAt:
            phase !== previous.activityPhase || actionId !== previous.actionMessageId
              ? detail.observedAt
              : (previous.phaseStartedAt ?? previous.startedAt),
          actionMessageId: actionId,
          ...(newSummary
            ? {
                previousSummaryAt: previous.lastSummaryAt ?? null,
                lastSummaryAt: detail.observedAt,
                lastSummaryKey: summaryKey,
              }
            : {}),
        }
      }
      if (
        affectsRun &&
        visibleFinal(normalized) &&
        normalized.endTurn === true &&
        normalized.status === 'finished_successfully' &&
        !['stop_requested', 'stopped', 'failed'].includes(state.lifecycle.state)
      ) {
        state.lifecycle = {
          ...state.lifecycle,
          state: 'complete',
          completedAt: sourceTime(normalized.updateTime) ?? detail.observedAt,
          terminalCause: null,
          source: 'transport',
          updatedAt: detail.observedAt,
        }
      }
      const source = {
        conversationId,
        raw: detail.record,
        observedAt: detail.observedAt,
        accountId: this.#verifiedAccountId,
        activeRun: affectsRun,
        requestId: detail.requestId ?? null,
        ...(detail.evidence ? { evidence: detail.evidence } : {}),
      }
      if (source.accountId)
        this.observations.admit(observation, {
          kind: 'message',
          detail: { ...source, accountId: source.accountId },
        })
      for (const listener of this.#streamMessageListeners) listener(source)
      state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
      this.#touch(state, 'transport')
      return
    }
    if (!sameRun || state.lifecycle.state === 'unknown' || state.lifecycle.state === 'idle') return
    const previous = state.lifecycle
    if (detail.kind === 'complete') {
      // A tool/message segment can finish while the main agent keeps working.
      if (detail.phase === 'message') return
      if (
        previous.state === 'stop_requested' ||
        previous.state === 'stopped' ||
        previous.state === 'failed' ||
        (previous.state === 'complete' && previous.completedAt !== null)
      )
        return
      state.lifecycle = {
        ...previous,
        state: 'complete',
        completedAt: detail.observedAt,
        updatedAt: detail.observedAt,
        source: 'transport',
      }
      state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
      this.#touch(state, 'transport')
      return
    }
    if (detail.kind === 'error') {
      const terminalCause = detail.errorCode ?? detail.errorReason ?? 'stream_error'
      if (
        [
          'stream_interrupted',
          'source_patch_gap',
          'network_error',
          'tokenless_resume_unavailable',
          'persisted_final_available',
        ].includes(terminalCause)
      ) {
        state.lifecycle = {
          ...previous,
          transportHealth:
            terminalCause === 'tokenless_resume_unavailable' ? 'unavailable' : 'interrupted',
          source: 'transport',
          updatedAt: detail.observedAt,
        }
        this.#touch(state, 'transport')
        return
      }
      state.lifecycle = {
        ...previous,
        state: terminalCause === 'conversation_too_large' ? 'complete' : 'failed',
        completedAt: detail.observedAt,
        terminalCause,
        updatedAt: detail.observedAt,
        source: 'transport',
      }
      state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
      this.#touch(state, 'transport')
      return
    }
    if (detail.kind === 'safety-review') {
      state.safetyReview = {
        active: detail.active,
        message: detail.message,
        protectionType: detail.protectionType,
      }
      state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
      this.#touch(state, 'transport')
      return
    }
    if (detail.kind === 'async-status') {
      if (asyncStatusIsActive(detail.asyncStatus)) {
        if (!['stop_requested', 'stopped', 'complete', 'cancelled', 'failed'].includes(previous.state)) {
          state.lifecycle = {
            ...previous,
            state: 'in_progress',
            completedAt: null,
            terminalCause: null,
            updatedAt: detail.observedAt,
            source: 'transport',
          }
          state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
          this.#touch(state, 'transport')
        }
      } else if (asyncStatusIsInactive(detail.asyncStatus) && previous.state === 'in_progress') {
        state.lifecycle = {
          ...previous,
          state: 'complete',
          completedAt: detail.observedAt,
          updatedAt: detail.observedAt,
          source: 'transport',
        }
        state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
        this.#touch(state, 'transport')
      }
    }
  }

  /** Renderer state is presentation-only and cannot change an observed request. */
  observeRendererState(
    _conversationId: string,
    _stateValue: string | null,
    _userMessageId: string | null,
  ) {}

  /** DOM is a placement adapter only; native records come from observed protocol events. */
  ingestDomSnapshot(_snapshot: ConversationDomSnapshot) {}

  async hydrate(conversationId: string, archive: Pick<ConversationArchiveStore, 'listMessages'>) {
    const state = this.#ensure(conversationId)
    const epoch = this.#accountEpoch
    if (state.hydrated) return
    if (state.hydration) return await state.hydration
    state.hydration = archive
      .listMessages(conversationId)
      .then((records) => {
        if (epoch !== this.#accountEpoch || this.#states.get(conversationId) !== state) return
        for (const record of records) this.#mergeRecord(state, record, true)
        state.hydrated = true
        if (records.length) this.#touch(state, 'hydrate')
      })
      .finally(() => {
        state.hydration = undefined
      })
    await state.hydration
  }

  /** Restore immutable saved presentation without inferring request state. */
  async hydrateSavedWindow(conversationId: string, load: () => Promise<readonly ArchivedMessage[]>) {
    if (!this.verifiedAccountId()) return
    const epoch = this.#accountEpoch
    const state = this.#ensure(conversationId)
    const records = await load()
    if (epoch !== this.#accountEpoch || this.#states.get(conversationId) !== state) return
    let changed = false
    for (const record of records) {
      if (record.conversationId !== conversationId) continue
      changed = this.#mergeRecord(state, record, true) || changed
    }
    if (changed) this.#touch(state, 'hydrate')
  }

  #onMessage = (event: MessageEvent) => {
    if (event.origin && event.origin !== window.location.origin) return
    if (event.source && event.source !== this.messageSource) return
    const data = event.data as {
      channel?: string
      type?: string
      detail?: unknown
    }
    if (data?.channel !== TRANSPORT_CHANNEL) return
    if (data.type === CONVERSATION_ACCOUNT_EVENT) {
      const detail = data.detail as ConversationAccountEventDetail | undefined
      if (detail) this.ingestAccount(detail)
      return
    }
    if (data.type === ARCHIVE_CONTRACT_ERROR_EVENT) {
      const detail = asRecord(data.detail)
      if (typeof detail?.conversationId === 'string')
        this.sourceGate.reject({
          conversationId: detail.conversationId,
          version: this.sourceGate.registered ? this.sourceGate.version : 'unregistered-version',
          path: typeof detail.path === 'string' ? detail.path : 'payload',
          reason: 'unsupported',
        })
      return
    }
    if (
      (data.type === ARCHIVE_EVENT || data.type === ARCHIVE_PRELOAD_EVENT) &&
      asRecord(data.detail)?.kind === 'conversation-page'
    ) {
      try {
        this.ingestPage(data.detail as ConversationArchiveEventDetail)
      } catch (cause) {
        if (!(cause instanceof ArchiveContractError)) throw cause
        // The gate publishes a safe structural diagnostic; keep native ChatGPT working.
      }
      return
    }
    if (data.type === CONVERSATION_CATALOG_EVENT && data.detail) {
      this.ingestCatalog(data.detail as ConversationCatalogEventDetail)
      return
    }
    if (data.type === CONVERSATION_REQUEST_EVENT && data.detail) {
      this.ingestRequest(data.detail as ConversationRequestEventDetail)
      return
    }
    if (data.type === CONVERSATION_STOP_EVENT && data.detail) {
      this.ingestStop(data.detail as ConversationStopEventDetail)
      return
    }
    if (data.type === CONVERSATION_STREAM_STATUS_EVENT && data.detail) {
      this.ingestStreamStatus(data.detail as ConversationStreamStatusEventDetail)
      return
    }
    if (data.type === CONVERSATION_STREAM_EVENT && data.detail) {
      try {
        this.ingestStreamEvent(data.detail as ConversationStreamEventDetail)
      } catch (cause) {
        if (!(cause instanceof ArchiveContractError)) throw cause
      }
    }
  }

  #ensure(conversationId: string) {
    const existing = this.#states.get(conversationId)
    if (existing) return existing
    const state: MutableConversationState = {
      conversationId,
      projectId: null,
      conversationOrigin: null,
      title: null,
      currentNodeId: null,
      lastObservedAt: 0,
      revision: 0,
      lifecycle: initialLifecycle(),
      records: new Map(),
      turnIndex: new Map(),
      pages: new Map(),
      headReadId: null,
      headReadStartedAt: null,
      catalogReadStartedAt: null,
      recordReads: new Map(),
      submissionSelections: new Map(),
      hydrated: false,
      hydration: undefined,
    }
    this.#states.set(conversationId, state)
    this.#evict(conversationId)
    return state
  }

  #mergeRecord(state: MutableConversationState, incoming: ArchivedMessage, hydration = false): boolean {
    const previous = state.records.get(incoming.messageId)
    if (previous && compareSourceObservation(previous.raw, incoming.raw) !== 'advance') return false
    if (previous && hydration) {
      const previousSourceTime = sourceTime(previous.updateTime) ?? sourceTime(previous.createTime) ?? 0
      const incomingSourceTime = sourceTime(incoming.updateTime) ?? sourceTime(incoming.createTime) ?? 0
      const previousIsDom = asRecord(previous.raw.metadata)?.booster_dom_snapshot === true
      if (!previousIsDom && previousSourceTime >= incomingSourceTime) return false
    }
    if (previous) this.#unindexRecord(state, previous)
    state.records.set(incoming.messageId, incoming)
    this.#indexRecord(state, incoming)
    return true
  }

  #indexRecord(state: MutableConversationState, record: ArchivedMessage) {
    for (const key of [record.turnExchangeId, record.workingTurnId]) {
      if (!key) continue
      const ids = state.turnIndex.get(key) ?? new Set<string>()
      ids.add(record.messageId)
      state.turnIndex.set(key, ids)
    }
  }

  #unindexRecord(state: MutableConversationState, record: ArchivedMessage) {
    for (const key of [record.turnExchangeId, record.workingTurnId]) {
      if (!key) continue
      const ids = state.turnIndex.get(key)
      ids?.delete(record.messageId)
      if (ids?.size === 0) state.turnIndex.delete(key)
    }
  }

  #inferLifecycleFromPage(
    state: MutableConversationState,
    payload: Record<string, unknown>,
    observedAt: number,
  ) {
    if (state.lifecycle.state === 'stop_requested' && observedAt < state.lifecycle.updatedAt) return
    const records = [...state.records.values()].sort(recordSort)
    const hasAsyncStatus = Object.hasOwn(payload, 'async_status')
    const asyncStatus = payload.async_status
    const asyncActive = hasAsyncStatus && asyncStatusIsActive(asyncStatus)
    const asyncInactive = hasAsyncStatus && asyncStatusIsInactive(asyncStatus)
    const asyncAuthoritative = hasAsyncStatus && (asyncActive || asyncInactive)
    const latestUser = [...records].reverse().find((record) => record.role === 'user')
    const latestTurnKey = latestUser?.turnExchangeId ?? latestUser?.workingTurnId ?? null
    const turnRecords = latestTurnKey
      ? records.filter(
          (record) => record.turnExchangeId === latestTurnKey || record.workingTurnId === latestTurnKey,
        )
      : records
    const activeRecord = [...turnRecords]
      .reverse()
      .find((record) => ACTIVE_MESSAGE_STATUS.has(record.status?.toLowerCase() ?? ''))
    const stoppedRecord = [...turnRecords]
      .reverse()
      .find((record) => STOPPED_MESSAGE_STATUS.has(record.status?.toLowerCase() ?? ''))
    const final = [...turnRecords]
      .reverse()
      .find((record) => visibleFinal(record) && record.status === 'finished_successfully')
    const startedAt = sourceTime(latestUser?.createTime) ?? state.lifecycle.startedAt
    const userMessageId = latestUser?.messageId ?? state.lifecycle.userMessageId
    const isNewRun = Boolean(
      userMessageId && state.lifecycle.userMessageId && userMessageId !== state.lifecycle.userMessageId,
    )
    if (
      (startedAt && startedAt !== state.lifecycle.startedAt) ||
      (userMessageId && userMessageId !== state.lifecycle.userMessageId)
    )
      state.lifecycle = {
        ...state.lifecycle,
        userMessageId,
        startedAt,
        terminalCause: isNewRun ? null : state.lifecycle.terminalCause,
        updatedAt: observedAt,
        source: 'initial',
        ...(isNewRun
          ? {
              requestId: null,
              requestObservedAt: null,
              lastActivityAt: null,
              lastSummaryAt: null,
              previousSummaryAt: null,
              lastSummaryKey: null,
              phaseStartedAt: null,
              actionMessageId: null,
            }
          : {}),
      }

    // A history read is not fresh activity. Recover only native timestamps;
    // repeated reads/catalog polling must not reset the no-change counter.
    if (state.lifecycle.lastActivityAt == null) {
      const activity = turnRecords.filter((record) => record.role !== 'user')
      const times = activity.flatMap((record) => {
        const at = sourceTime(record.updateTime) ?? sourceTime(record.createTime)
        return at ? [at] : []
      })
      const summaries = activity.flatMap((record) => {
        const at = sourceTime(record.createTime)
        return at && sourceSummaryKey(record) ? [at] : []
      })
      const distinctSummaries = [...new Set(summaries)].sort((a, b) => a - b)
      const latest = activity.at(-1)
      state.lifecycle = {
        ...state.lifecycle,
        lastActivityAt: times.length ? Math.max(...times) : startedAt,
        lastSummaryAt: distinctSummaries.at(-1) ?? null,
        previousSummaryAt: distinctSummaries.at(-2) ?? null,
        activityPhase:
          latest?.role === 'tool' || (latest?.recipient && latest.recipient !== 'all')
            ? 'tool'
            : latest && visibleFinal(latest)
              ? 'responding'
              : 'thinking',
        phaseStartedAt: latest ? sourceTime(latest.createTime) : startedAt,
      }
    }

    if (asyncActive || (!asyncAuthoritative && activeRecord)) {
      if (state.lifecycle.state !== 'stop_requested')
        state.lifecycle = {
          ...state.lifecycle,
          state: 'in_progress',
          userMessageId,
          startedAt,
          completedAt: null,
          terminalCause: null,
          source: 'initial',
          updatedAt: observedAt,
        }
      return
    }
    if (stoppedRecord) {
      state.lifecycle = {
        ...state.lifecycle,
        state: 'stopped',
        userMessageId,
        startedAt,
        completedAt: sourceTime(stoppedRecord.updateTime) ?? sourceTime(stoppedRecord.createTime),
        source: 'initial',
        updatedAt: observedAt,
      }
      return
    }
    if (final && state.lifecycle.state !== 'stop_requested') {
      state.lifecycle = {
        ...state.lifecycle,
        state: 'complete',
        userMessageId,
        startedAt,
        completedAt: sourceTime(final.updateTime) ?? sourceTime(final.createTime),
        source: 'initial',
        updatedAt: observedAt,
      }
    } else if (asyncInactive && latestUser && state.lifecycle.state !== 'stop_requested') {
      state.lifecycle = {
        ...state.lifecycle,
        state: 'complete',
        userMessageId,
        startedAt,
        completedAt: state.lifecycle.completedAt,
        source: 'initial',
        updatedAt: observedAt,
      }
    }
  }

  #touch(state: MutableConversationState, reason: ConversationStateChange['reason']) {
    state.revision += 1
    const change = { conversationId: state.conversationId, revision: state.revision, reason }
    for (const listener of this.#listeners) listener(change)
  }

  #evict(protectedId: string) {
    while (this.#states.size > MAX_CONVERSATIONS) {
      const oldest = [...this.#states.values()]
        .filter((state) => state.conversationId !== protectedId)
        .sort((a, b) => a.lastObservedAt - b.lastObservedAt)[0]
      if (!oldest) return
      this.#states.delete(oldest.conversationId)
    }
  }
}
