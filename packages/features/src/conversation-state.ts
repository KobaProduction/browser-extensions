import type { ConversationDomSnapshot } from '@chatgpt-booster/chatgpt'
import { currentConversationId } from '@chatgpt-booster/chatgpt'
import type { BoosterModule } from '@chatgpt-booster/core'
import { serverTimeMs } from '@chatgpt-booster/core'
import {
  ARCHIVE_EVENT,
  ARCHIVE_PRELOAD_EVENT,
  CONVERSATION_REQUEST_EVENT,
  CONVERSATION_STOP_EVENT,
  CONVERSATION_STREAM_EVENT,
  CONVERSATION_STREAM_STATUS_EVENT,
  type ConversationArchiveEventDetail,
  type ConversationRequestEventDetail,
  type ConversationStopEventDetail,
  type ConversationStreamEventDetail,
  type ConversationStreamStatusEventDetail,
  TRANSPORT_CHANNEL,
} from '@chatgpt-booster/observer'
import type { ArchivedMessage, ConversationArchiveStore } from './archive-store'
import {
  normalizeConversationMessage,
  normalizeConversationProjectId,
} from './conversation-records'

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
  state: ConversationRunState
  userMessageId: string | null
  startedAt: number | null
  completedAt: number | null
  stopRequestedAt: number | null
  updatedAt: number
  source: 'initial' | 'request' | 'stop' | 'transport' | 'renderer' | 'hydrated' | 'unknown'
}

export interface ConversationMemorySnapshot {
  conversationId: string
  projectId: string | null
  title: string | null
  currentNodeId: string | null
  lastObservedAt: number
  revision: number
  lifecycle: ConversationLifecycleSnapshot
  records: ArchivedMessage[]
  pages: ConversationArchiveEventDetail[]
}

export interface ConversationStateChange {
  conversationId: string
  revision: number
  reason: 'page' | 'request' | 'stop' | 'transport' | 'renderer' | 'dom' | 'hydrate'
}

interface MutableConversationState {
  conversationId: string
  projectId: string | null
  title: string | null
  currentNodeId: string | null
  lastObservedAt: number
  revision: number
  lifecycle: ConversationLifecycleSnapshot
  records: Map<string, ArchivedMessage>
  turnIndex: Map<string, Set<string>>
  pages: Map<string, ConversationArchiveEventDetail>
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

export class ConversationStateStore implements BoosterModule {
  readonly id = 'conversation-state'
  #states = new Map<string, MutableConversationState>()
  #listeners = new Set<(change: ConversationStateChange) => void>()
  #pageListeners = new Set<(detail: ConversationArchiveEventDetail) => void>()
  #active = false

  constructor(private readonly messageSource: Window = window) {}

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
  }

  subscribe(listener: (change: ConversationStateChange) => void) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  subscribePages(listener: (detail: ConversationArchiveEventDetail) => void) {
    this.#pageListeners.add(listener)
    return () => this.#pageListeners.delete(listener)
  }

  revision(conversationId: string) {
    return this.#states.get(conversationId)?.revision ?? 0
  }

  lifecycle(conversationId: string): ConversationLifecycleSnapshot | undefined {
    const value = this.#states.get(conversationId)?.lifecycle
    return value ? { ...value } : undefined
  }

  snapshot(conversationId: string): ConversationMemorySnapshot | undefined {
    const state = this.#states.get(conversationId)
    if (!state) return undefined
    return {
      conversationId,
      projectId: state.projectId,
      title: state.title,
      currentNodeId: state.currentNodeId,
      lastObservedAt: state.lastObservedAt,
      revision: state.revision,
      lifecycle: { ...state.lifecycle },
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

  ingestPage(detail: ConversationArchiveEventDetail) {
    const payload = detail.payload
    if (!payload || !Array.isArray(payload.messages)) return
    const conversationId =
      typeof payload.conversation_id === 'string' ? payload.conversation_id : detail.conversationId
    if (!conversationId || conversationId !== detail.conversationId) return
    const state = this.#ensure(conversationId)
    const observedAt = detail.timestamp || Date.now()
    state.projectId = normalizeConversationProjectId(payload) ?? state.projectId
    state.title = typeof payload.title === 'string' ? payload.title : state.title
    state.currentNodeId =
      typeof payload.current_node === 'string' ? payload.current_node : state.currentNodeId
    state.lastObservedAt = Math.max(state.lastObservedAt, observedAt)

    for (const value of payload.messages) {
      const raw = asRecord(value)
      if (!raw) continue
      const id = typeof raw.id === 'string' ? raw.id : null
      const previous = id ? state.records.get(id) : undefined
      const normalized = normalizeConversationMessage(
        raw,
        conversationId,
        state.projectId,
        observedAt,
        previous,
      )
      if (!normalized) continue
      this.#mergeRecord(state, normalized)
    }

    state.pages.set(pageKey(detail), detail)
    while (state.pages.size > MAX_PAGES_PER_CONVERSATION) {
      const oldest = [...state.pages.entries()].sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      )[0]?.[0]
      if (!oldest) break
      state.pages.delete(oldest)
    }
    this.#inferLifecycleFromPage(state, payload, observedAt)
    this.#touch(state, 'page')
    for (const listener of this.#pageListeners) listener(detail)
  }

  ingestRequest(detail: ConversationRequestEventDetail) {
    const conversationId = detail.conversationId ?? currentConversationId() ?? null
    if (!conversationId) return
    const state = this.#ensure(conversationId)
    state.lifecycle = {
      state: 'in_progress',
      userMessageId: detail.userMessageId,
      startedAt: detail.startedAt,
      completedAt: null,
      stopRequestedAt: null,
      updatedAt: detail.observedAt,
      source: 'request',
    }
    state.lastObservedAt = Math.max(state.lastObservedAt, detail.observedAt)
    this.#touch(state, 'request')
  }

  ingestStop(detail: ConversationStopEventDetail) {
    const conversationId = detail.conversationId ?? currentConversationId() ?? null
    if (!conversationId) return
    const state = this.#ensure(conversationId)
    const previous = state.lifecycle
    if (detail.phase === 'requested') {
      state.lifecycle = {
        ...previous,
        state: 'stop_requested',
        stopRequestedAt: detail.timestamp,
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
        updatedAt: detail.timestamp,
        source: 'stop',
      }
    }
    state.lastObservedAt = Math.max(state.lastObservedAt, detail.timestamp)
    this.#touch(state, 'stop')
  }

  ingestStreamStatus(detail: ConversationStreamStatusEventDetail) {
    if (detail.status !== 'COMPLETE') return
    const state = this.#ensure(detail.conversationId)
    const previous = state.lifecycle
    if (
      previous.state === 'stop_requested' ||
      previous.state === 'stopped' ||
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
    const conversationId = detail.conversationId ?? currentConversationId() ?? null
    if (!conversationId) return
    const state = this.#ensure(conversationId)
    const previous = state.lifecycle
    if (detail.kind === 'complete') {
      if (
        previous.state === 'stop_requested' ||
        previous.state === 'stopped' ||
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
    if (detail.kind === 'async-status') {
      if (asyncStatusIsActive(detail.asyncStatus)) {
        if (
          !['stop_requested', 'stopped', 'complete', 'cancelled', 'failed'].includes(previous.state)
        ) {
          state.lifecycle = {
            ...previous,
            state: 'in_progress',
            completedAt: null,
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

  observeRendererState(
    conversationId: string,
    stateValue: string | null,
    userMessageId: string | null,
  ) {
    const state = this.#ensure(conversationId)
    const previous = state.lifecycle
    const normalized = stateValue?.toLowerCase() ?? ''
    let next = previous
    if (normalized === 'in_progress') {
      if (previous.state !== 'stop_requested') {
        const nextUserMessageId = userMessageId ?? previous.userMessageId
        const userRecord = nextUserMessageId ? state.records.get(nextUserMessageId) : undefined
        const nextStartedAt =
          sourceTime(userRecord?.createTime) ??
          (nextUserMessageId === previous.userMessageId ? previous.startedAt : null)
        const sameRun =
          !nextUserMessageId ||
          !previous.userMessageId ||
          nextUserMessageId === previous.userMessageId
        const terminal = ['stopped', 'complete', 'cancelled', 'failed'].includes(previous.state)
        const regressesRun = Boolean(
          nextUserMessageId &&
            previous.userMessageId &&
            nextUserMessageId !== previous.userMessageId &&
            nextStartedAt &&
            previous.startedAt &&
            nextStartedAt < previous.startedAt,
        )
        const conflictsWithFreshRequest = Boolean(
          previous.source === 'request' &&
            previous.userMessageId &&
            nextUserMessageId &&
            nextUserMessageId !== previous.userMessageId,
        )
        if (!((terminal && sameRun) || regressesRun || conflictsWithFreshRequest)) {
          if (
            previous.state !== 'in_progress' ||
            nextUserMessageId !== previous.userMessageId ||
            nextStartedAt !== previous.startedAt
          )
            next = {
              ...previous,
              state: 'in_progress',
              userMessageId: nextUserMessageId,
              startedAt: nextStartedAt,
              completedAt: null,
              source: 'renderer',
            }
        }
      }
    } else if (normalized === 'complete' && previous.state !== 'stop_requested') {
      if (previous.state !== 'complete')
        next = { ...previous, state: 'complete', source: 'renderer' }
    }
    if (next === previous) return
    state.lifecycle = next
    this.#touch(state, 'renderer')
  }

  ingestDomSnapshot(snapshot: ConversationDomSnapshot) {
    const state = this.#ensure(snapshot.conversationId)
    state.projectId = snapshot.projectId ?? state.projectId
    state.title = snapshot.title ?? state.title
    state.lastObservedAt = Math.max(state.lastObservedAt, snapshot.observedAt)
    for (const source of snapshot.records) {
      const previous = state.records.get(source.messageId)
      const normalized = normalizeConversationMessage(
        source.raw,
        snapshot.conversationId,
        state.projectId,
        snapshot.observedAt,
        previous,
      )
      if (normalized) this.#mergeRecord(state, normalized)
    }
    this.#touch(state, 'dom')
  }

  async hydrate(conversationId: string, archive: Pick<ConversationArchiveStore, 'listMessages'>) {
    const state = this.#ensure(conversationId)
    if (state.hydrated) return
    if (state.hydration) return await state.hydration
    state.hydration = archive
      .listMessages(conversationId)
      .then((records) => {
        for (const record of records) this.#mergeRecord(state, record, true)
        state.hydrated = true
        if (records.length) this.#touch(state, 'hydrate')
      })
      .finally(() => {
        state.hydration = undefined
      })
    await state.hydration
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
    if (
      (data.type === ARCHIVE_EVENT || data.type === ARCHIVE_PRELOAD_EVENT) &&
      asRecord(data.detail)?.kind === 'conversation-page'
    ) {
      this.ingestPage(data.detail as ConversationArchiveEventDetail)
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
    if (data.type === CONVERSATION_STREAM_EVENT && data.detail)
      this.ingestStreamEvent(data.detail as ConversationStreamEventDetail)
  }

  #ensure(conversationId: string) {
    const existing = this.#states.get(conversationId)
    if (existing) return existing
    const state: MutableConversationState = {
      conversationId,
      projectId: null,
      title: null,
      currentNodeId: null,
      lastObservedAt: 0,
      revision: 0,
      lifecycle: initialLifecycle(),
      records: new Map(),
      turnIndex: new Map(),
      pages: new Map(),
      hydrated: false,
      hydration: undefined,
    }
    this.#states.set(conversationId, state)
    this.#evict()
    return state
  }

  #mergeRecord(state: MutableConversationState, incoming: ArchivedMessage, hydration = false) {
    const previous = state.records.get(incoming.messageId)
    if (previous && hydration) {
      const previousSourceTime =
        sourceTime(previous.updateTime) ?? sourceTime(previous.createTime) ?? 0
      const incomingSourceTime =
        sourceTime(incoming.updateTime) ?? sourceTime(incoming.createTime) ?? 0
      const previousIsDom = asRecord(previous.raw.metadata)?.booster_dom_snapshot === true
      if (!previousIsDom && previousSourceTime >= incomingSourceTime) return
    }
    if (previous) this.#unindexRecord(state, previous)
    state.records.set(incoming.messageId, incoming)
    this.#indexRecord(state, incoming)
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
    const activeRecord = [...records]
      .reverse()
      .find((record) => ACTIVE_MESSAGE_STATUS.has(record.status?.toLowerCase() ?? ''))
    const hasAsyncStatus = Object.hasOwn(payload, 'async_status')
    const asyncStatus = payload.async_status
    const asyncActive = hasAsyncStatus && asyncStatusIsActive(asyncStatus)
    const asyncInactive = hasAsyncStatus && asyncStatusIsInactive(asyncStatus)
    const asyncAuthoritative = hasAsyncStatus && (asyncActive || asyncInactive)
    const latestUser = [...records].reverse().find((record) => record.role === 'user')
    const latestTurnKey = latestUser?.turnExchangeId ?? latestUser?.workingTurnId ?? null
    const turnRecords = latestTurnKey
      ? records.filter(
          (record) =>
            record.turnExchangeId === latestTurnKey || record.workingTurnId === latestTurnKey,
        )
      : records
    const stoppedRecord = [...turnRecords]
      .reverse()
      .find((record) => STOPPED_MESSAGE_STATUS.has(record.status?.toLowerCase() ?? ''))
    const final = [...turnRecords]
      .reverse()
      .find((record) => visibleFinal(record) && record.status === 'finished_successfully')
    const startedAt = sourceTime(latestUser?.createTime) ?? state.lifecycle.startedAt
    const userMessageId = latestUser?.messageId ?? state.lifecycle.userMessageId
    if (
      (startedAt && startedAt !== state.lifecycle.startedAt) ||
      (userMessageId && userMessageId !== state.lifecycle.userMessageId)
    )
      state.lifecycle = {
        ...state.lifecycle,
        userMessageId,
        startedAt,
        updatedAt: observedAt,
        source: 'initial',
      }

    if (asyncActive || (!asyncAuthoritative && activeRecord)) {
      if (state.lifecycle.state !== 'stop_requested')
        state.lifecycle = {
          ...state.lifecycle,
          state: 'in_progress',
          userMessageId,
          startedAt,
          completedAt: null,
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

  #evict() {
    while (this.#states.size > MAX_CONVERSATIONS) {
      const oldest = [...this.#states.values()].sort(
        (a, b) => a.lastObservedAt - b.lastObservedAt,
      )[0]
      if (!oldest) return
      this.#states.delete(oldest.conversationId)
    }
  }
}
