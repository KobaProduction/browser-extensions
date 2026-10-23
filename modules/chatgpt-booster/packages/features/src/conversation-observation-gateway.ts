import type {
  ConversationArchiveEventDetail,
  ConversationRequestEventDetail,
  ConversationStopEventDetail,
  ConversationStreamEventDetail,
  ConversationStreamStatusEventDetail,
} from '@chatgpt-booster/observer'
import type { ConversationStartEvidence } from './archive-start-evidence'

export type ConversationObservation =
  | { kind: 'page'; detail: ConversationArchiveEventDetail }
  | { kind: 'stream'; detail: ConversationStreamEventDetail }
  | { kind: 'request'; detail: ConversationRequestEventDetail }
  | { kind: 'stop'; detail: ConversationStopEventDetail }
  | { kind: 'status'; detail: ConversationStreamStatusEventDetail }

export type BufferedConversationSource =
  | { kind: 'page'; detail: ConversationArchiveEventDetail }
  | {
      kind: 'message'
      detail: {
        conversationId: string
        accountId: string
        raw: Record<string, unknown>
        observedAt: number
        activeRun: boolean
        requestId?: string | null
        evidence?: readonly Record<string, unknown>[]
        startEvidence?: ConversationStartEvidence
      }
    }

export interface ConversationObservationEntry {
  sequence: number
  ownerId: string
  epoch: number
  conversationId: string
  observation: ConversationObservation
  source?: BufferedConversationSource
}

/** First circuit: lossless, owner-scoped page-session RAM. No settings, DB or network.
 * The source validator admits a separate projection for downstream consumers;
 * rejected shapes remain here without becoming canonical facts. Replay never
 * re-emits native lifecycle/automation events. */
export class ConversationObservationGateway {
  private ownerId: string | null = null
  private epoch = 0
  private sequence = 0
  private entries = new Map<number, ConversationObservationEntry>()
  private conversations = new Map<string, Map<number, ConversationObservationEntry>>()
  private messages = new Map<string, Map<string, Set<number>>>()
  private messageIds = new Map<string, Set<string>>()
  private listeners = new Set<() => void>()
  private countListeners = new Set<() => void>()
  private sourceListeners = new Set<(entry: ConversationObservationEntry) => void>()
  private heads = new Map<string, Extract<BufferedConversationSource, { kind: 'message' }>>()

  reset(ownerId: string | null, epoch: number) {
    this.ownerId = ownerId
    this.epoch = epoch
    this.entries.clear()
    this.conversations.clear()
    this.messages.clear()
    this.heads.clear()
    this.messageIds.clear()
    this.notify()
    this.notifyCounts()
  }
  receive(conversationId: string, observation: ConversationObservation): number | undefined {
    if (!this.ownerId || !conversationId) return
    const detail = observation.detail
    if ('accountId' in detail && detail.accountId !== undefined && detail.accountId !== this.ownerId)
      return
    const detached = structuredClone(observation)
    const sequence = ++this.sequence
    const entry: ConversationObservationEntry = {
      sequence,
      ownerId: this.ownerId,
      epoch: this.epoch,
      conversationId,
      observation: detached,
    }
    this.entries.set(sequence, entry)
    const conversation = this.conversations.get(conversationId) ?? new Map()
    conversation.set(sequence, entry)
    this.conversations.set(conversationId, conversation)
    const records =
      detached.kind === 'page'
        ? detached.detail.payload.messages
        : detached.kind === 'stream' && detached.detail.kind === 'message'
          ? [detached.detail.record]
          : detached.kind === 'request' && (detached.detail.submission || detached.detail.creation)
            ? [(detached.detail.submission ?? detached.detail.creation)?.message]
            : []
    const ids = this.messageIds.get(conversationId) ?? new Set<string>()
    const previousCount = ids.size
    const messages = this.messages.get(conversationId) ?? new Map<string, Set<number>>()
    if (Array.isArray(records))
      for (const raw of records)
        if (raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id) {
          ids.add(raw.id)
          const versions = messages.get(raw.id) ?? new Set<number>()
          versions.add(sequence)
          messages.set(raw.id, versions)
        }
    this.messageIds.set(conversationId, ids)
    this.messages.set(conversationId, messages)
    this.notify()
    if (ids.size !== previousCount) this.notifyCounts()
    return sequence
  }
  admit(sequence: number | undefined, source: BufferedConversationSource) {
    if (sequence === undefined) return
    const entry = this.entries.get(sequence)
    if (!entry || entry.ownerId !== this.ownerId || entry.epoch !== this.epoch || entry.source) return
    if (source.detail.conversationId !== entry.conversationId) throw Error('Gateway source mismatch')
    entry.source = structuredClone(source)
    if (entry.observation.kind === 'page' && entry.source.kind === 'page')
      entry.source.detail = entry.observation.detail
    if (
      entry.observation.kind === 'stream' &&
      entry.observation.detail.kind === 'message' &&
      entry.source.kind === 'message'
    ) {
      entry.source.detail.raw = entry.observation.detail.record
      if (entry.observation.detail.evidence)
        entry.source.detail.evidence = entry.observation.detail.evidence
    }
    if (entry.source.kind === 'message' && entry.source.detail.activeRun) {
      const raw = entry.source.detail.raw,
        author = raw.author as { role?: string } | undefined
      if (
        ['user', 'assistant'].includes(author?.role ?? '') &&
        (!raw.recipient || raw.recipient === 'all') &&
        (!raw.channel || raw.channel === 'final')
      )
        this.heads.set(entry.conversationId, entry.source)
    }
    for (const listener of this.sourceListeners)
      try {
        listener(structuredClone(entry))
      } catch {
        // A consumer cannot interrupt observation or another consumer.
      }
  }
  receivedCount(conversationId: string): number {
    return this.messageIds.get(conversationId)?.size ?? 0
  }
  scope() {
    return { ownerId: this.ownerId, epoch: this.epoch }
  }
  hasMessage(conversationId: string, messageId: string) {
    return this.messages.get(conversationId)?.has(messageId) ?? false
  }
  head(conversationId: string) {
    const head = this.heads.get(conversationId)
    return head ? structuredClone(head.detail) : undefined
  }
  observations(conversationId?: string): readonly ConversationObservationEntry[] {
    const entries = conversationId ? this.conversations.get(conversationId) : this.entries
    return [...(entries?.values() ?? [])].map((entry) => structuredClone(entry))
  }
  messageObservations(
    conversationId: string,
    messageId: string,
  ): readonly ConversationObservationEntry[] {
    return [...(this.messages.get(conversationId)?.get(messageId) ?? [])].flatMap((sequence) => {
      const entry = this.entries.get(sequence)
      return entry ? [structuredClone(entry)] : []
    })
  }
  hasFullRead(conversationId: string, readId: string | undefined) {
    for (const entry of this.conversations.get(conversationId)?.values() ?? [])
      if (
        entry.source?.kind === 'page' &&
        entry.source.detail.nativeGraph &&
        entry.source.detail.readId === readId
      )
        return true
    return false
  }
  latestFullGraph(conversationId: string) {
    let selected: Extract<BufferedConversationSource, { kind: 'page' }> | undefined
    for (const entry of this.conversations.get(conversationId)?.values() ?? []) {
      const source = entry.source
      if (
        source?.kind === 'page' &&
        source.detail.nativeGraph &&
        (!selected || (source.detail.readStartedAt ?? 0) >= (selected.detail.readStartedAt ?? 0))
      )
        selected = source
    }
    return selected?.detail.nativeGraph
      ? {
          graph: structuredClone(selected.detail.nativeGraph),
          readId: selected.detail.readId ?? '',
          readStartedAt: selected.detail.readStartedAt ?? 0,
          observedAt: selected.detail.timestamp,
        }
      : undefined
  }
  sources(conversationId?: string): readonly ConversationObservationEntry[] {
    const entries = conversationId ? this.conversations.get(conversationId) : this.entries
    return [...(entries?.values() ?? [])]
      .filter((entry) => entry.source)
      .map((entry) => structuredClone(entry))
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  subscribeCounts(listener: () => void) {
    this.countListeners.add(listener)
    return () => this.countListeners.delete(listener)
  }
  private notifyCounts() {
    for (const listener of this.countListeners) {
      try {
        listener()
      } catch {}
    }
  }
  subscribeSources(listener: (entry: ConversationObservationEntry) => void) {
    this.sourceListeners.add(listener)
    return () => this.sourceListeners.delete(listener)
  }
  private notify() {
    for (const listener of this.listeners)
      try {
        listener()
      } catch {
        // UI consumers cannot interrupt the first circuit.
      }
  }
}
