import { buildArchiveThread, currentConversationId, currentProjectId } from '@chatgpt-booster/chatgpt'
import type { ArchiveDataAdapter, ArchiveMessageView, ArchiveThreadWindow } from '@chatgpt-booster/ui'
import {
  type ArchiveExportMessageSummary,
  type ArchiveMessageV1,
  archiveMessageText,
} from '@kobaproduction/browser-archive'
import { DEFAULT_ARCHIVE_EXPORT_PIPELINE } from './archive-export'
import type { FixedChatGptCapture } from './archive-fixed-runtime'
import { chatGptArchiveRecord } from './archive-message-adapter'
import { sourceScopeContext } from './archive-scope-context'
import { ConversationArchiveWorkspace } from './archive-workspace'
import { normalizeConversationMessage } from './conversation-records'
import type { ConversationStateStore } from './conversation-state'

/**
 * Only live archive facade. Historical native v4 is never opened for Reader,
 * export, capture, recovery or maintenance by this adapter.
 */
export function createFixedArchiveUiAdapter(
  capture: FixedChatGptCapture,
  memory: ConversationStateStore,
  workspace = new ConversationArchiveWorkspace(memory, capture),
): ArchiveDataAdapter {
  const presentationRecord = (
    source: { raw: Record<string, unknown>; observedAtMs: number; normalized?: ArchiveMessageV1 },
    id: string,
  ) =>
    source.normalized
      ? chatGptArchiveRecord(source.raw, source.normalized)
      : normalizeConversationMessage(source.raw, id, null, source.observedAtMs)
  const account = () => {
    const id = memory.verifiedAccountId()
    if (!id) throw Error('Unverified ChatGPT account')
    return id
  }
  const current = () => currentConversationId() ?? null
  const guard = (owner: string, epoch: number) => {
    if (memory.verifiedAccountId() !== owner || memory.accountEpoch() !== epoch)
      throw Error('Owner changed during saved archive read')
  }
  const listProjects = async () => {
    const owner = account(),
      epoch = memory.accountEpoch()
    const saved = await capture.listSavedProjects()
    guard(owner, epoch)
    const projects = new Map(saved.map((project) => [project.projectId, project]))
    for (const project of memory.listProjects())
      projects.set(project.projectId, { projectId: project.projectId, title: project.title })
    return [...projects.values()].map(({ projectId, title }) => ({ projectId, title }))
  }
  const readSavedWindow = async (
    id: string,
    cursor: Parameters<NonNullable<ArchiveDataAdapter['getThreadWindow']>>[1],
    direction: 'older' | 'newer' | 'first' | 'middle' = 'older',
    request?: Parameters<NonNullable<ArchiveDataAdapter['getThreadWindow']>>[3],
  ) => {
    const owner = account(),
      epoch = memory.accountEpoch()
    const revision = await capture.sourceRevision(id)
    const instanceId = await capture.sourceInstanceId(id)
    if (request?.expectedRevision !== undefined && request.expectedRevision !== revision)
      throw Error('archive.error.sourceChanged')
    if (request?.expectedInstanceId && request.expectedInstanceId !== instanceId)
      throw Error('archive.error.sourceChanged')
    if (request?.expectedAccountId && request.expectedAccountId !== owner)
      throw Error('Owner mismatch for saved Dexie window')
    if (request?.signal?.aborted) throw Error('Reader cancelled')
    const [rows, total] = await Promise.all([
      capture.windowConversation(id, direction, cursor?.messageId),
      capture.savedCount(id),
    ])
    guard(owner, epoch)
    if (request?.signal?.aborted) throw Error('Reader cancelled')
    const records = rows.map((item) => {
      const record = presentationRecord(item, id)
      if (!record) throw Error('Cannot decode saved canonical source')
      return record
    })
    const first = rows[0]?.id,
      last = rows.at(-1)?.id
    const [hasOlder, hasNewer] = await Promise.all([
      first ? capture.hasMessagesBefore(id, first) : false,
      last ? capture.hasMessagesAfter(id, last) : false,
    ])
    if (
      (await capture.sourceRevision(id)) !== revision ||
      (await capture.sourceInstanceId(id)) !== instanceId
    )
      throw Error('archive.error.sourceChanged')
    guard(owner, epoch)
    // Cursor identity is stable; ordering is the provider's source timestamp
    // projection. Missing timestamps remain explicitly unsequenced.
    return {
      thread: buildArchiveThread(records, { unknownTimeLast: true }),
      olderCursor: first ? { sourceCreateTime: null, messageId: first } : null,
      newerCursor: last ? { sourceCreateTime: null, messageId: last } : null,
      hasOlderStored: hasOlder,
      hasNewerStored: hasNewer,
      loadedRecordCount: rows.length,
      totalKnownRecordCount: total,
      hasUnsequencedRecords: records.some((record) => record.createTime === null),
      source: 'saved' as const,
      sourceRevision: revision,
      sourceInstanceId: instanceId,
      accountId: owner,
    }
  }
  const readWindow = async (
    id: string,
    cursor: Parameters<NonNullable<ArchiveDataAdapter['getThreadWindow']>>[1],
    direction: 'older' | 'newer' | 'first' | 'middle' = 'older',
    request?: Parameters<NonNullable<ArchiveDataAdapter['getThreadWindow']>>[3],
  ): Promise<ArchiveThreadWindow> => {
    if (request?.source === 'saved') return readSavedWindow(id, cursor, direction, request)
    const owner = account(),
      epoch = memory.accountEpoch()
    if (request?.expectedAccountId && request.expectedAccountId !== owner)
      throw Error('archive.error.auth')
    await workspace.open(id)
    guard(owner, epoch)
    if (request?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const view = workspace.window(id, direction, cursor?.messageId)
    const first = view.records[0],
      last = view.records.at(-1)
    return {
      thread: buildArchiveThread(view.records, { unknownTimeLast: true }),
      olderCursor: first ? { sourceCreateTime: first.createTime, messageId: first.messageId } : null,
      newerCursor: last ? { sourceCreateTime: last.createTime, messageId: last.messageId } : null,
      hasOlderStored: view.hasOlder,
      hasNewerStored: view.hasNewer,
      loadedRecordCount: view.records.length,
      totalKnownRecordCount: view.total,
      hasUnsequencedRecords: view.records.some((record) => record.createTime === null),
      source: 'live',
      sourceRevision: null,
      sourceInstanceId: null,
      accountId: owner,
    }
  }
  return {
    liveConversations: () => {
      if (!memory.verifiedAccountId()) return []
      const byId = new Map(workspace.catalog().map((item) => [item.conversationId, item]))
      const id = current(),
        header = id ? memory.header(id) : undefined
      if (id && header)
        byId.set(id, { conversationId: id, projectId: header.projectId, title: header.title })
      return [...byId.values()].map((item) => ({
        ...item,
        updatedAt: null,
        lastSeenAt: 0,
        archiveState: 'partial' as const,
        branchSourceConversationId: null,
        branchSourceTitle: null,
      }))
    },
    workspaceStatus: (id) => workspace.status(id),
    retryWorkspace: (id) => workspace.retry(id),
    getBranchPath: async (id, tipId) => {
      await workspace.open(id)
      return workspace.branchPath(id, tipId)
    },
    getRangeMessageIds: async (id, firstId, lastId) => {
      await workspace.open(id)
      return workspace.range(id, firstId, lastId)
    },
    getTimeline: async (id) => {
      const owner = account(),
        epoch = memory.accountEpoch()
      await workspace.open(id)
      const confirmedStarts = workspace.confirmedStartIds(id)
      const metadata = workspace.records(id).map((record) => ({
        id: record.messageId,
        parentId: record.parentId,
        parentKnown: record.parentKnown,
        timestampMs: record.createTime === null ? null : record.createTime * 1000,
        role: record.role,
        contentType: record.contentType,
        channel: record.channel,
        recipient: record.recipient,
        preview: String(
          (record.raw.content as { parts?: unknown[] })?.parts
            ?.filter((part) => typeof part === 'string')
            .join('') ?? '',
        ).slice(0, 200),
      }))
      guard(owner, epoch)
      const byId = new Map(metadata.map((message) => [message.id, message]))
      const visible = new Set(
        metadata
          .filter(
            (message) =>
              (['text', 'multimodal_text'].includes(message.contentType ?? '') &&
                message.role === 'user') ||
              (message.role === 'assistant' &&
                ['text', 'multimodal_text'].includes(message.contentType ?? '') &&
                (!message.channel || message.channel === 'final') &&
                (!message.recipient || message.recipient === 'all')),
          )
          .map((message) => message.id),
      )
      return metadata
        .filter((message) => visible.has(message.id))
        .map((message) => {
          let parentId = message.parentId
          let uncertain = !message.parentKnown && !confirmedStarts.has(message.id)
          const seen = new Set([message.id])
          while (parentId && byId.has(parentId) && !visible.has(parentId) && !seen.has(parentId)) {
            seen.add(parentId)
            const intermediate = byId.get(parentId)
            if (!intermediate) {
              uncertain = true
              break
            }
            if (!intermediate.parentKnown && !confirmedStarts.has(intermediate.id)) uncertain = true
            parentId = intermediate.parentId
          }
          uncertain ||= Boolean(parentId && (!visible.has(parentId) || seen.has(parentId)))
          return {
            id: message.id,
            key: JSON.stringify([owner, id, message.id]),
            parentId: uncertain ? null : parentId,
            label: message.role === 'user' ? 'User' : 'Assistant',
            preview: message.preview,
            timestampMs: message.timestampMs,
            uncertain,
          }
        })
    },
    getExportMessages: async (id, signal) => {
      const owner = account(),
        epoch = memory.accountEpoch(),
        revision = await capture.sourceRevision(id),
        instanceId = await capture.sourceInstanceId(id)
      const messages: ArchiveExportMessageSummary[] = []
      let cursor: string | undefined
      while (true) {
        signal?.throwIfAborted()
        const rows = await capture.windowConversation(id, cursor ? 'newer' : 'first', cursor)
        guard(owner, epoch)
        for (const source of rows) {
          const record = presentationRecord(source, id)
          if (!record) throw Error('Cannot decode saved export source')
          messages.push({
            id: record.messageId,
            timestampMs: record.createTime === null ? null : record.createTime * 1000,
            author: record.authorName ?? '',
            role: record.role,
            text: source.normalized
              ? archiveMessageText(source.normalized).slice(0, 160)
              : String(
                  (record.raw.content as { parts?: unknown[] })?.parts
                    ?.filter((part) => typeof part === 'string')
                    .join('') ?? '',
                ).slice(0, 160),
          })
        }
        const last = rows.at(-1)?.id
        if (!last || !(await capture.hasMessagesAfter(id, last))) break
        if (last === cursor) throw Error('archive.error.sourceChanged')
        cursor = last
      }
      signal?.throwIfAborted()
      if (
        (await capture.sourceRevision(id)) !== revision ||
        (await capture.sourceInstanceId(id)) !== instanceId
      )
        throw Error('archive.error.sourceChanged')
      guard(owner, epoch)
      return messages
    },
    liveSavedUpdates: true,
    subscribeExportChanges: (id, listener) => {
      const saved = capture.subscribeSaved((changed) => {
        if (changed === null || changed === id) listener()
      })
      const live = workspace.subscribe((changed) => {
        if (!changed || changed === id) listener()
      })
      return () => {
        saved()
        live()
      }
    },
    getMessageVersions: async (id, messageId) => {
      const owner = account(),
        epoch = memory.accountEpoch()
      const versions = await capture.messageVersions(id, messageId)
      guard(owner, epoch)
      return versions.map((version) => {
        const record = presentationRecord(version, id)
        if (!record) throw Error('Source variant cannot be decoded')
        return {
          observedAtMs: version.observedAtMs,
          decision: version.decision,
          thread: buildArchiveThread([record]),
        }
      })
    },
    archiveGeneration: undefined,
    collectionInsideExportOnly: false,
    currentConversationId: current,
    currentProjectId: () =>
      memory.verifiedAccountId() ? (memory.header(current() ?? '')?.projectId ?? null) : null,
    currentAccountId: () => memory.verifiedAccountId(),
    getCurrentContext: async () => {
      const owner = memory.verifiedAccountId(),
        epoch = memory.accountEpoch()
      const empty = {
        conversationId: null,
        conversationTitle: null,
        projectId: null,
        projectTitle: null,
      }
      if (!owner) return empty
      const id = current(),
        routeProject = currentProjectId()
      const [conversations, projects] = await Promise.all([
        capture.listSavedConversations(),
        listProjects(),
      ])
      guard(owner, epoch)
      const source = {
        ownerId: owner,
        nativeConversation: (candidate: string) => memory.header(candidate),
        savedConversation: (candidate: string) =>
          conversations.find((value) => value.conversationId === candidate),
        savedProject: (candidate: string) => projects.find((value) => value.projectId === candidate),
        currentNativeProjectId: id ? (memory.header(id)?.projectId ?? null) : null,
      }
      const context = id
        ? sourceScopeContext({ scope: 'conversation', id, title: null }, source)
        : routeProject
          ? sourceScopeContext({ scope: 'project', id: routeProject, title: null }, source)
          : undefined
      if (!context) return empty
      const projectId = context.scope === 'project' ? context.id : (context.projectId ?? null)
      return {
        conversationId: context.scope === 'conversation' ? context.id : null,
        conversationTitle: context.scope === 'conversation' ? context.title : null,
        projectId,
        projectTitle: projects.find((value) => value.projectId === projectId)?.title ?? null,
      }
    },
    subscribeContextChange: (handler) => {
      const state = memory.subscribe(() => handler()),
        saved = capture.subscribeSaved(() => handler())
      return () => {
        state()
        saved()
      }
    },
    getCollectionState: () => capture.collectionSession.snapshot(),
    collectCurrent: () => capture.collectCurrent(),
    stopCollection: () => capture.stopCollection(),
    clearAll: () => Promise.reject(Error('Automatic archive deletion is disabled')),
    getConversation: async (id) => {
      const owner = account(),
        epoch = memory.accountEpoch()
      const live = memory.header(id) ?? workspace.context(id)
      const source =
        live ?? (await capture.listSavedConversations()).find((x) => x.conversationId === id)
      const origin = live
        ? capture.cachedSavedBranchOrigin(id)
        : source
          ? await capture.savedBranchOrigin(id)
          : null
      guard(owner, epoch)
      return source
        ? {
            ...source,
            updatedAt: null,
            lastSeenAt: 0,
            archiveState: 'partial',
            branchSourceConversationId: origin?.conversationId ?? null,
            branchSourceTitle: origin?.title ?? null,
          }
        : undefined
    },
    listProjects,
    listConversations: async () => {
      const owner = account(),
        epoch = memory.accountEpoch()
      const source = await capture.listSavedConversations()
      const byId = new Map(source.map((item) => [item.conversationId, item]))
      for (const item of workspace.catalog()) byId.set(item.conversationId, item)
      for (const snapshot of memory.listSnapshots())
        byId.set(snapshot.conversationId, {
          conversationId: snapshot.conversationId,
          projectId: snapshot.projectId,
          title: snapshot.title,
        })
      guard(owner, epoch)
      const result = []
      for (const item of byId.values()) {
        const origin = capture.cachedSavedBranchOrigin(item.conversationId)
        result.push({
          ...item,
          updatedAt: null,
          lastSeenAt: 0,
          archiveState: 'partial' as const,
          branchSourceConversationId: origin.conversationId,
          branchSourceTitle: origin.title,
        })
      }
      return result
    },
    listMessages: async (id) => {
      const owner = account(),
        epoch = memory.accountEpoch()
      await workspace.open(id)
      guard(owner, epoch)
      return workspace.records(id) as ArchiveMessageView[]
    },
    getThreadWindow: readWindow,
    getPositionWindow: (id, position, request) =>
      readWindow(id, null, position === 'latest' ? 'older' : position, request),
    getMessageWindow: async (id, messageId, request) => {
      if (request?.source !== 'saved') {
        const owner = account(),
          epoch = memory.accountEpoch()
        if (request?.expectedAccountId && request.expectedAccountId !== owner)
          throw Error('archive.error.auth')
        await workspace.open(id)
        guard(owner, epoch)
        if (request?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
        const view = workspace.window(id, 'older', messageId, true)
        const first = view.records[0],
          last = view.records.at(-1)
        return {
          thread: buildArchiveThread(view.records),
          olderCursor: first ? { sourceCreateTime: first.createTime, messageId: first.messageId } : null,
          newerCursor: last ? { sourceCreateTime: last.createTime, messageId: last.messageId } : null,
          hasOlderStored: view.hasOlder,
          hasNewerStored: view.hasNewer,
          loadedRecordCount: view.records.length,
          totalKnownRecordCount: view.total,
          hasUnsequencedRecords: view.records.some((record) => record.createTime === null),
          focusedMessageId: messageId,
          source: 'live',
          sourceRevision: null,
          sourceInstanceId: null,
          accountId: owner,
        }
      }
      const owner = account(),
        epoch = memory.accountEpoch()
      const revision = await capture.sourceRevision(id)
      const instanceId = await capture.sourceInstanceId(id)
      if (request?.expectedRevision !== undefined && request.expectedRevision !== revision)
        throw Error('archive.error.sourceChanged')
      if (request?.expectedInstanceId && request.expectedInstanceId !== instanceId)
        throw Error('archive.error.sourceChanged')
      if (request?.expectedAccountId && request.expectedAccountId !== owner)
        throw Error('archive.error.auth')
      if (request?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const [rows, total] = await Promise.all([
        capture.windowAroundMessage(id, messageId),
        capture.savedCount(id),
      ])
      guard(owner, epoch)
      if (request?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const records = rows.map((row) => {
        const record = presentationRecord(row, id)
        if (!record) throw Error('Cannot decode saved source')
        return record
      })
      const first = rows[0]?.id,
        last = rows.at(-1)?.id
      const [hasOlder, hasNewer] = await Promise.all([
        first ? capture.hasMessagesBefore(id, first) : false,
        last ? capture.hasMessagesAfter(id, last) : false,
      ])
      if (
        (await capture.sourceRevision(id)) !== revision ||
        (await capture.sourceInstanceId(id)) !== instanceId
      )
        throw Error('archive.error.sourceChanged')
      guard(owner, epoch)
      return {
        thread: buildArchiveThread(records),
        olderCursor: first ? { sourceCreateTime: null, messageId: first } : null,
        newerCursor: last ? { sourceCreateTime: null, messageId: last } : null,
        hasOlderStored: hasOlder,
        hasNewerStored: hasNewer,
        loadedRecordCount: rows.length,
        totalKnownRecordCount: total,
        hasUnsequencedRecords: records.some((record) => record.createTime === null),
        focusedMessageId: messageId,
        source: 'saved' as const,
        sourceRevision: revision,
        sourceInstanceId: instanceId,
        accountId: owner,
      }
    },
    getThread: async (id) => {
      const owner = account(),
        epoch = memory.accountEpoch()
      await workspace.open(id)
      guard(owner, epoch)
      return buildArchiveThread(workspace.records(id))
    },
    getCoverage: async (id) => {
      const owner = account(),
        epoch = memory.accountEpoch()
      await workspace.open(id)
      const integrity = workspace.integrity(id),
        count = workspace.status(id).loaded
      const savedGraph =
        integrity.scope === 'current-native-graph' ? await capture.savedNativeGraphStatus(id) : undefined
      const exhaustion = await capture.savedExhaustion?.(id)
      guard(owner, epoch)
      return {
        conversationId: id,
        knownMessageCount: count,
        exhaustedAt: exhaustion?.observedAt ?? null,
        integrity,
        hasOlderServerHistory: integrity.start === 'verified' ? false : null,
        oldestKnownVisibleMessageId: integrity.firstMessageId ?? null,
        newestKnownVisibleMessageId: integrity.lastMessageId ?? null,
        completeAtLastRead:
          integrity.chain === 'verified' &&
          (integrity.scope !== 'current-native-graph' ||
            (savedGraph?.readId === workspace.nativeGraphRead(id)?.readId &&
              savedGraph?.headId === integrity.lastMessageId)),
        lastFullReadAt: null,
        storedStartMatchesCurrent: false,
        storedLatestMatchesCurrent: integrity.end === 'verified',
      }
    },
    listExportFormats: () => DEFAULT_ARCHIVE_EXPORT_PIPELINE.listFormats(),
    exportConversation: (id, options, signal, progress) =>
      capture.exportUserConversation(id, options, signal, progress),
  }
}
