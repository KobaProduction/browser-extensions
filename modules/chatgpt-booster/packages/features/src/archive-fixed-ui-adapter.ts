import {
  buildArchiveThread, currentConversationId, currentProjectId, currentConversationTitle, currentProjectTitle,
} from '@chatgpt-booster/chatgpt'
import type { ArchiveDataAdapter, ArchiveMessageView } from '@chatgpt-booster/ui'
import type { ConversationStateStore } from './conversation-state'
import type { FixedChatGptCapture } from './archive-fixed-runtime'
import { normalizeConversationMessage } from './conversation-records'

/**
 * Only live archive facade. Historical native v4 is never opened for Reader,
 * export, capture, recovery or maintenance by this adapter.
 */
export function createFixedArchiveUiAdapter(
  capture: FixedChatGptCapture,
  memory: ConversationStateStore,
): ArchiveDataAdapter {
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
  return {
    archiveGeneration: undefined,
    collectionInsideExportOnly: false,
    currentConversationId: current,
    currentProjectId: () => currentProjectId() ?? null,
    currentAccountId: () => memory.verifiedAccountId(),
    getCurrentContext: async () => ({
      conversationId: current(), conversationTitle: currentConversationTitle() ?? null,
      projectId: currentProjectId() ?? null, projectTitle: currentProjectTitle(currentProjectId() ?? '') ?? null,
    }),
    subscribeContextChange: handler => memory.subscribe(() => handler()),
    getCollectionState: () => capture.collectionSession.snapshot(),
    collectCurrent: () => capture.collectCurrent(),
    stopCollection: () => capture.stopCollection(),
    clearAll: () => Promise.reject(Error('Automatic archive deletion is disabled')),
    getConversation: async id => {
      const owner = account(), epoch = memory.accountEpoch()
      const source = (await capture.listSavedConversations()).find(x => x.conversationId === id)
      guard(owner, epoch)
      return source ? {
        ...source, updatedAt: null, lastSeenAt: 0, archiveState: 'partial',
        branchSourceConversationId: null, branchSourceTitle: null,
      } : undefined
    },
    listProjects: () => capture.listSavedProjects().then(list =>
      list.map(x => ({ projectId: x.projectId, title: x.title }))),
    listConversations: async () => {
      const owner = account(), epoch = memory.accountEpoch()
      const source = await capture.listSavedConversations()
      guard(owner, epoch)
      return source.map(x => ({
        ...x, updatedAt: null, lastSeenAt: 0, archiveState: 'partial' as const,
        branchSourceConversationId: null, branchSourceTitle: null,
      }))
    },
    listMessages: async id => {
      const owner = account(), epoch = memory.accountEpoch()
      const items = await capture.readConversation(id)
      guard(owner, epoch)
      return items.map(item => {
        const normalized = normalizeConversationMessage(item.raw, id, null, item.observedAtMs)
        if (!normalized) throw Error('Saved source cannot be normalized for the fixed Reader')
        return normalized as ArchiveMessageView
      })
    },
    getThreadWindow: async (id, cursor, direction = 'older', request) => {
      const owner = account(), epoch = memory.accountEpoch()
      if (request?.expectedAccountId && request.expectedAccountId !== owner)
        throw Error('Owner mismatch for saved Dexie window')
      if (request?.signal?.aborted) throw Error('Reader cancelled')
      const [rows, total] = await Promise.all([
        capture.windowConversation(id, direction, cursor?.messageId),
        capture.savedCount(id),
      ])
      guard(owner, epoch)
      if (request?.signal?.aborted) throw Error('Reader cancelled')
      const records = rows.map(item => {
        const record = normalizeConversationMessage(item.raw, id, null, item.observedAtMs)
        if (!record) throw Error('Cannot decode saved canonical source')
        return record
      })
      const first = rows[0]?.id, last = rows.at(-1)?.id
      // Source message IDs are stable cursor keys; their ordering is not a
      // fabricated proof of provider chronology or completeness.
      return {
        thread: buildArchiveThread(records, { unknownTimeLast: true }),
        olderCursor: first ? { sourceCreateTime: null, messageId: first } : null,
        newerCursor: last ? { sourceCreateTime: null, messageId: last } : null,
        hasOlderStored: Boolean(first && await capture.hasMessagesBefore(id, first)),
        hasNewerStored: Boolean(last && await capture.hasMessagesAfter(id, last)),
        loadedRecordCount: rows.length, totalKnownRecordCount: total,
        hasUnsequencedRecords: true,
        source: 'saved' as const, sourceRevision: null, sourceInstanceId: null, accountId: owner,
      }
    },
    getThread: async id => {
      const owner = account(), epoch = memory.accountEpoch()
      const items = await capture.readConversation(id)
      guard(owner, epoch)
      return buildArchiveThread(items.map(item => {
        const record = normalizeConversationMessage(item.raw, id, null, item.observedAtMs)
        if (!record) throw Error('Saved source cannot be normalized')
        return record
      }))
    },
    getCoverage: async id => {
      const owner = account(), epoch = memory.accountEpoch()
      const count = await capture.savedCount(id)
      guard(owner, epoch)
      return {
        conversationId: id, knownMessageCount: count,
        hasOlderServerHistory: null, completeAtLastRead: false,
        lastFullReadAt: null, storedStartMatchesCurrent: false,
        storedLatestMatchesCurrent: false,
      }
    },
    listExportFormats: () => [{
      id: 'fixed-json-gzip', label: 'Fixed archive v1 — JSONL.gz',
      mimeType: 'application/gzip', fileExtension: 'jsonl.gz', isDefault: true,
    }],
    exportConversation: async (id, options) => {
      if (options.format !== 'fixed-json-gzip')
        throw Error('Fixed archive exports only the lossless JSONL.gz contract')
      const blob = await capture.exportConversation(id)
      return {
        blob, extension: 'jsonl.gz', packaged: true,
        complete: false, includedAssets: 0, missingAssets: 0,
      }
    },
  }
}
