import type { BoosterModule } from '@chatgpt-booster/core'
import { conversationIntegrityFromGraph } from '@kobaproduction/browser-archive'
import { checkpointHistoryCoverage } from './archive-coverage'
import type { FixedConversation } from './archive-fixed-dexie'
import type { FixedChatGptCapture } from './archive-fixed-runtime'
import { chatGptArchiveRecord } from './archive-message-adapter'
import { compareSourceObservation } from './archive-observation-policy'
import type { ArchivedMessage } from './archive-store'
import { normalizeConversationMessage } from './conversation-records'
import type { ConversationStateStore } from './conversation-state'

interface WorkspaceConversation {
  context: { conversationId: string; projectId: string | null; title: string | null }
  records: Map<string, ArchivedMessage>
  liveIds: Set<string>
  children: Map<string, Set<string>>
  missing: Map<string, Set<string>>
  ordered: string[] | null
  positions: Map<string, number>
  loading: boolean
  loaded: boolean
  failed: boolean
  dirty: boolean
  opened: boolean
  pending?: Promise<void>
  header?: FixedConversation
  liveHead: string | null
  liveTerminal: string | null
  revision: number
}

/** Read workspace: UUID indexes + explicit ancestry, hydrated in bounded DB chunks.
 * Loading never writes to the gateway, persistence, native lifecycle or triggers. */
export class ConversationArchiveWorkspace implements BoosterModule {
  readonly id = 'archive-workspace'
  private conversations = new Map<string, WorkspaceConversation>()
  private listeners = new Set<(id: string | null) => void>()
  private cleanup: (() => void)[] = []
  private owner: string | null = null
  private epoch = -1
  private active = false
  constructor(
    private memory: ConversationStateStore,
    private capture: FixedChatGptCapture,
  ) {}
  start() {
    if (this.active) return
    this.active = true
    this.syncOwner()
    this.cleanup.push(this.memory.observations.subscribe(() => this.syncOwner()))
    this.cleanup.push(
      this.memory.observations.subscribeSources((entry) => {
        const conversation = this.conversation(entry.conversationId)
        const header = this.memory.header(entry.conversationId)
        if (header)
          conversation.context = {
            conversationId: entry.conversationId,
            projectId: header.projectId,
            title: header.title,
          }
        const source = entry.source
        const pageRecords =
          source?.kind === 'page' && Array.isArray(source.detail.payload.messages)
            ? source.detail.payload.messages
            : []
        const ids =
          source?.kind === 'message'
            ? [source.detail.raw.id]
            : pageRecords.map((raw) => (raw as { id?: string }).id)
        for (const id of ids) {
          const record =
            typeof id === 'string' ? this.memory.getMessage(entry.conversationId, id) : undefined
          if (record) {
            conversation.liveIds.add(record.messageId)
            this.merge(conversation, record)
          }
        }
        if (source?.kind === 'message' && source.detail.activeRun) {
          const record = this.memory.getMessage(entry.conversationId, String(source.detail.raw.id))
          if (
            record &&
            ['user', 'assistant'].includes(record.role ?? '') &&
            (!record.recipient || record.recipient === 'all') &&
            (!record.channel || record.channel === 'final')
          ) {
            conversation.liveHead = record.messageId
            conversation.liveTerminal =
              record.endTurn && record.status === 'finished_successfully' ? record.messageId : null
          }
        }
        this.notify(entry.conversationId)
      }),
    )
    this.cleanup.push(
      this.capture.subscribeSaved((id) => {
        const candidates = id ? [[id, this.conversations.get(id)] as const] : this.conversations
        for (const [candidate, conversation] of candidates)
          if (conversation?.opened) {
            // Own live records are already present; cross-tab invalidation has no local ID.
            if (id && this.memory.observations.receivedCount(id)) continue
            if (conversation.loading) {
              conversation.dirty = true
              continue
            }
            if (conversation.failed) continue
            conversation.loaded = false
            void this.hydrate(candidate, conversation)
          }
      }),
    )
  }
  stop() {
    this.active = false
    for (const dispose of this.cleanup.splice(0)) dispose()
    this.conversations.clear()
    this.owner = null
    this.epoch = -1
    this.notify(null)
    this.listeners.clear()
  }
  private syncOwner() {
    const owner = this.memory.verifiedAccountId(),
      epoch = this.memory.accountEpoch()
    if (owner === this.owner && epoch === this.epoch) return
    this.owner = owner
    this.epoch = epoch
    this.conversations.clear()
    this.notify(null)
  }
  private conversation(id: string) {
    this.syncOwner()
    if (!this.owner) throw Error('archive.error.auth')
    let conversation = this.conversations.get(id)
    if (!conversation) {
      conversation = {
        context: {
          conversationId: id,
          projectId: this.memory.header(id)?.projectId ?? null,
          title: this.memory.header(id)?.title ?? null,
        },
        records: new Map(),
        liveIds: new Set(),
        children: new Map(),
        missing: new Map(),
        ordered: null,
        positions: new Map(),
        loading: false,
        loaded: false,
        failed: false,
        dirty: false,
        opened: false,
        liveHead: null,
        liveTerminal: null,
        revision: 0,
      }
      this.conversations.set(id, conversation)
      for (const record of this.memory.listMessages(id)) {
        if (this.memory.observations.hasMessage(id, record.messageId))
          conversation.liveIds.add(record.messageId)
        this.merge(conversation, record)
      }
    }
    return conversation
  }
  private merge(conversation: WorkspaceConversation, incoming: ArchivedMessage) {
    const previous = conversation.records.get(incoming.messageId)
    if (previous && compareSourceObservation(previous.raw, incoming.raw) !== 'advance') return
    if (previous?.parentId) {
      conversation.children.get(previous.parentId)?.delete(previous.messageId)
      conversation.missing.get(previous.parentId)?.delete(previous.messageId)
      if (!conversation.missing.get(previous.parentId)?.size)
        conversation.missing.delete(previous.parentId)
    }
    conversation.records.set(incoming.messageId, incoming)
    if (!previous || previous.createTime !== incoming.createTime) conversation.ordered = null
    if (incoming.parentId) {
      const children = conversation.children.get(incoming.parentId) ?? new Set<string>()
      children.add(incoming.messageId)
      conversation.children.set(incoming.parentId, children)
      if (!conversation.records.has(incoming.parentId))
        conversation.missing.set(incoming.parentId, children)
    }
    conversation.missing.delete(incoming.messageId)
    conversation.revision++
  }
  private ordered(conversation: WorkspaceConversation) {
    if (!conversation.ordered) {
      conversation.ordered = [...conversation.records.values()]
        .sort(
          (a, b) =>
            (a.createTime ?? Infinity) - (b.createTime ?? Infinity) ||
            a.messageId.localeCompare(b.messageId),
        )
        .map((record) => record.messageId)
      conversation.positions = new Map(conversation.ordered.map((id, index) => [id, index]))
    }
    return conversation.ordered
  }
  private remove(conversation: WorkspaceConversation, id: string) {
    const record = conversation.records.get(id)
    if (!record) return
    if (record.parentId) {
      const siblings = conversation.children.get(record.parentId)
      siblings?.delete(id)
      if (!siblings?.size) {
        conversation.children.delete(record.parentId)
        conversation.missing.delete(record.parentId)
      }
    }
    const children = conversation.children.get(id)
    if (children?.size) conversation.missing.set(id, children)
    conversation.records.delete(id)
    conversation.ordered = null
    conversation.revision++
  }
  retry(id: string) {
    this.start()
    const conversation = this.conversation(id)
    conversation.opened = true
    conversation.failed = false
    conversation.loaded = false
    if (conversation.loading) conversation.dirty = true
    else void this.hydrate(id, conversation)
  }
  async open(id: string) {
    this.start()
    const conversation = this.conversation(id)
    conversation.opened = true
    if (!conversation.loaded && !conversation.loading && !conversation.failed)
      void this.hydrate(id, conversation)
    // RAM is immediately usable; a saved-only conversation waits for its first bounded chunk.
    if (!conversation.records.size) await conversation.pending
    this.syncOwner()
    if (this.conversations.get(id) !== conversation) throw Error('archive.error.auth')
  }
  private hydrate(id: string, conversation: WorkspaceConversation) {
    if (conversation.loading || !this.active) return conversation.pending
    const owner = this.owner,
      epoch = this.epoch
    const owns = () =>
      this.active &&
      owner === this.memory.verifiedAccountId() &&
      epoch === this.memory.accountEpoch() &&
      this.conversations.get(id) === conversation
    conversation.loading = true
    conversation.failed = false
    this.notify(id)
    let first!: () => void
    conversation.pending = new Promise<void>((resolve) => {
      first = resolve
    })
    const load = async () => {
      let cursor: string | undefined
      let restarts = 0
      const savedIds = new Set<string>()
      try {
        do {
          const chunk = await this.capture.workspaceChunk(id, cursor)
          if (!owns()) return
          if (conversation.header && conversation.header.instanceId !== chunk.header?.instanceId) {
            for (const key of conversation.records.keys())
              if (!conversation.liveIds.has(key)) this.remove(conversation, key)
            if (cursor) {
              if (++restarts > 3) throw Error('Workspace source keeps changing')
              cursor = undefined
              savedIds.clear()
              conversation.header = chunk.header
              continue
            }
          }
          conversation.header = chunk.header
          if (!this.memory.header(id) && chunk.header)
            conversation.context = {
              conversationId: id,
              projectId: chunk.header.projectId,
              title: chunk.header.title,
            }
          for (const row of chunk.rows) {
            savedIds.add(row.id)
            const base = normalizeConversationMessage(
              row.raw,
              id,
              chunk.header?.projectId ?? null,
              row.observedAtMs,
            )
            if (!base) throw Error('Workspace source cannot be decoded')
            const record = row.normalized
              ? { ...base, ...chatGptArchiveRecord(row.raw, row.normalized) }
              : base
            this.merge(conversation, record)
          }
          first()
          this.notify(id)
          if (!chunk.hasMore) break
          if (!chunk.cursor || chunk.cursor === cursor) throw Error('Workspace cursor did not advance')
          cursor = chunk.cursor
          // Yield between chunks so native/UI tasks continue while the chain fills.
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        } while (owns())
        if (owns()) {
          for (const key of conversation.records.keys())
            if (!conversation.liveIds.has(key) && !savedIds.has(key)) this.remove(conversation, key)
          conversation.loaded = true
        }
      } catch {
        if (owns()) conversation.failed = true
      } finally {
        first()
        if (owns()) {
          conversation.loading = false
          this.notify(id)
          if (conversation.dirty && !conversation.failed) {
            conversation.dirty = false
            conversation.loaded = false
            void this.hydrate(id, conversation)
          }
        }
      }
    }
    void load()
    return conversation.pending
  }
  status(id: string) {
    this.syncOwner()
    const conversation = this.conversations.get(id)
    return {
      loading: conversation?.loading ?? false,
      loaded: conversation?.records.size ?? 0,
      missingParents: conversation?.missing.size ?? 0,
      failed: conversation?.failed ?? false,
    }
  }
  getMessage(id: string, messageId: string) {
    return this.conversation(id).records.get(messageId)
  }
  catalog() {
    this.syncOwner()
    return [...this.conversations.values()].map((conversation) => ({ ...conversation.context }))
  }
  context(id: string) {
    this.syncOwner()
    return this.conversations.get(id)?.context
  }
  range(id: string, firstId: string, lastId: string) {
    const conversation = this.conversation(id),
      result: string[] = [],
      seen = new Set<string>()
    let cursor: string | null = lastId
    while (cursor) {
      if (seen.has(cursor)) throw Error('archive.error.incompleteSource')
      seen.add(cursor)
      const record = conversation.records.get(cursor)
      if (!record) throw Error('archive.error.messageMissing')
      result.push(cursor)
      if (cursor === firstId) return result.reverse()
      cursor = record.parentId
    }
    throw Error('archive.error.incompleteSource')
  }
  records(id: string) {
    const c = this.conversation(id)
    return this.ordered(c).flatMap((key) => {
      const record = c.records.get(key)
      return record ? [record] : []
    })
  }
  window(
    id: string,
    direction: 'older' | 'newer' | 'first' | 'middle',
    cursorId?: string,
    around = false,
  ) {
    const conversation = this.conversation(id),
      ids = this.ordered(conversation)
    const position = cursorId ? conversation.positions.get(cursorId) : undefined
    if (cursorId && position === undefined) throw Error('archive.error.messageMissing')
    const start = around
      ? Math.max(0, (position ?? 0) - 80)
      : direction === 'first'
        ? 0
        : direction === 'middle'
          ? Math.max(0, Math.floor(ids.length / 2) - 80)
          : direction === 'newer'
            ? position === undefined
              ? 0
              : position + 1
            : Math.max(0, (position ?? ids.length) - 160)
    const end =
      direction === 'older' && position !== undefined && !around
        ? position
        : Math.min(ids.length, start + 160)
    return {
      records: ids.slice(start, end).flatMap((key) => {
        const record = conversation.records.get(key)
        return record ? [record] : []
      }),
      hasOlder: start > 0,
      hasNewer: end < ids.length,
      total: ids.length,
      revision: conversation.revision,
    }
  }
  branchPath(id: string, tipId: string) {
    const conversation = this.conversation(id),
      result: string[] = [],
      seen = new Set<string>()
    let cursor: string | null = tipId
    while (cursor) {
      if (seen.has(cursor)) throw Error('archive.error.incompleteSource')
      seen.add(cursor)
      const record = conversation.records.get(cursor)
      if (!record) throw Error('archive.error.messageMissing')
      result.push(cursor)
      cursor = record.parentId
    }
    return result.reverse()
  }
  integrity(id: string) {
    const conversation = this.conversation(id),
      header = this.memory.header(id),
      saved = conversation.header
    const streamed = this.memory.observations.head(id)
    const currentStream =
      streamed?.requestId && streamed.requestId === this.memory.lifecycle(id)?.requestId
        ? streamed
        : undefined
    const pageIsNewer =
      header?.currentNodeId && (header.headReadStartedAt ?? 0) >= (currentStream?.observedAt ?? Infinity)
    const head = pageIsNewer
      ? header.currentNodeId
      : typeof currentStream?.raw.id === 'string'
        ? currentStream.raw.id
        : (conversation.liveHead ?? header?.currentNodeId ?? saved?.currentHeadId ?? null)
    const streamTerminal =
      currentStream?.raw.end_turn === true &&
      currentStream.raw.status === 'finished_successfully' &&
      currentStream.raw.id === head
    const page = checkpointHistoryCoverage(saved?.pageCoverage)
    return conversationIntegrityFromGraph(
      [...conversation.records.values()].map((record) => ({
        id: record.messageId,
        parentId: record.parentId,
        parentKnown: Object.hasOwn((record.raw.metadata ?? {}) as object, 'parent_id'),
      })),
      {
        startReached: page.startReached || this.memory.nativeHistoryCoverage(id).startReached,
        endReached:
          !!head &&
          (streamTerminal ||
            conversation.liveTerminal === head ||
            saved?.terminalHeadId === head ||
            (page.endReached && saved?.pageHeadId === head)),
        headId: head,
      },
    )
  }
  subscribe(listener: (id: string | null) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private notify(id: string | null) {
    for (const listener of this.listeners) {
      try {
        listener(id)
      } catch {}
    }
  }
}
