/** Deliberately synthetic UI-only ports. No real provider/network/storage access. */

import { buildArchiveThread } from '@chatgpt-booster/chatgpt'
import {
  type ArchiveCurrentContext,
  type ArchiveWindowRequest,
  applyTransportCounterEvent,
  EMPTY_TRANSPORT_COUNTERS,
  HISTORY_LOADER_STATE_EVENT,
  type HistoryLoaderState,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
  type TransportCounterEvent,
  type TransportCounters,
} from '@chatgpt-booster/core'
import { type FixedChatGptView, normalizeConversationMessage } from '@chatgpt-booster/features'
import type { ArchiveDataAdapter, ArchiveWindowCursor } from '@chatgpt-booster/ui'
import { conversationIntegrityFromGraph, linearArchiveIntegrity } from '@kobaproduction/browser-archive'
import { instanceKey } from '@kobaproduction/browser-core'
import { setVkPreferencesPersistence } from '../../../modules/vk-booster/src/features/chat-export/model/durable-preferences'
import type {
  ArchiveApi,
  ArchiveOptions,
  ArchiveStatus,
  VkMessage,
} from '../../../modules/vk-booster/src/features/chat-export/model/types'
import { createVkUserExport } from '../../../modules/vk-booster/src/features/chat-export/model/vk-user-export'
import type { LabMethod, LabScene } from './scenes'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
export const fixtureSize = (scene: LabScene) => (scene === 'empty' ? 0 : scene === 'long' ? 3000 : 32)
export const fixtureTitle = (scene: LabScene) =>
  scene === 'long'
    ? 'План разработки приложения: этапы, интерфейс, архитектура и обсуждение деталей следующего выпуска'
    : 'План разработки приложения'

export function createMockSettingsAdapter(): SettingsAdapter {
  let state = normalizeSettings()
  const listeners = new Set<(value: typeof state) => void>()
  const broadcast = () => {
    for (const cb of listeners) cb(structuredClone(state))
  }
  return {
    async get() {
      return structuredClone(state)
    },
    async set(value) {
      state = structuredClone(value)
      broadcast()
    },
    async update(patch) {
      state = mergeSettings(state, patch)
      broadcast()
      return structuredClone(state)
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

export function createMockCounters(size: number) {
  let value: TransportCounters = {
    ...EMPTY_TRANSPORT_COUNTERS,
    requestsSent: size * 2,
    responsesReceived: size * 2,
    messagesSent: size,
    messagesReceived: size * 3,
    lastEventAt: Date.now(),
    errors: 0,
  }
  const subs = new Set<(next: TransportCounters) => void>()
  return {
    getTransportCounters: () => ({ ...value }),
    subscribeTransport(fn: (next: TransportCounters) => void) {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    resetTransport() {
      value = { ...EMPTY_TRANSPORT_COUNTERS }
      for (const fn of subs) fn({ ...value })
    },
    recordTransport(event: TransportCounterEvent) {
      value = applyTransportCounterEvent(value, event)
      for (const fn of subs) fn({ ...value })
    },
    recordTransportBatch(events: readonly TransportCounterEvent[]) {
      for (const event of events) value = applyTransportCounterEvent(value, event)
      for (const fn of subs) fn({ ...value })
    },
  }
}

const demoContext = (scene: LabScene): ArchiveCurrentContext => ({
  conversationId: scene === 'empty' ? null : 'demo-dialog',
  conversationTitle: fixtureTitle(scene),
  projectId: 'demo-project',
  projectTitle: 'Разработка приложения',
})
export function createMockChatGptArchive(scene: LabScene) {
  let count = fixtureSize(scene)
  let phase: HistoryLoaderState['phase'] = scene === 'loading' ? 'scrolling' : 'idle'
  let stopped = false
  let session = 0
  const context = demoContext(scene)
  const savedListeners = new Set<() => void>()
  const idAt = (index: number) => `demo-msg-${index + 1}`
  // Metadata navigation and rendered canonical records share one opaque identity.
  const keyAt = (index: number) => JSON.stringify(['demo-verified-account', 'demo-dialog', idAt(index)])
  const indexOf = (id: string) => {
    const value = Number(id.replace('demo-msg-', '')) - 1
    return Number.isInteger(value) && value >= 0 && value < count ? value : -1
  }
  const rawAt = (index: number) => ({
    id: idAt(index),
    create_time: 1760000000 + index * 90,
    author: { role: index % 2 ? 'assistant' : 'user' },
    recipient: 'all',
    channel: index % 2 ? 'final' : null,
    status: 'finished_successfully',
    end_turn: Boolean(index % 2),
    metadata: {
      parent_id: index === 0 ? null : idAt(index === 8 ? 5 : index - 1),
      model_slug: 'synthetic-model',
    },
    content: {
      content_type: 'text',
      parts: [`Синтетическое сообщение ${index + 1}; здесь нет пользовательских данных`],
    },
  })
  const recordAt = (index: number) => {
    const record = normalizeConversationMessage(
      rawAt(index),
      'demo-dialog',
      'demo-project',
      1800000000000,
    )
    if (!record) throw Error('Synthetic archive record cannot be normalized')
    return { ...record, messageKey: keyAt(index) }
  }
  const threadBetween = (first: number, last: number) =>
    buildArchiveThread(
      Array.from({ length: Math.max(0, last - first) }, (_, offset) => recordAt(first + offset)),
    )
  const integrity = () =>
    conversationIntegrityFromGraph(
      Array.from({ length: count }, (_, index) => ({
        id: idAt(index),
        parentId: rawAt(index).metadata.parent_id,
        parentKnown: true,
      })),
      {
        startReached: count > 0,
        endReached: count > 0 && count % 2 === 0,
        headId: count ? idAt(count - 1) : null,
      },
    )
  const makeWindow = async (first: number, last: number, request?: ArchiveWindowRequest) => {
    await sleep(scene === 'loading' ? 300 : 15)
    if (scene === 'error') throw Error('Synthetic Reader unavailable')
    if (request?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (request?.expectedRevision != null && request.expectedRevision !== count)
      throw Error('archive.error.sourceChanged')
    return {
      thread: threadBetween(first, last),
      olderCursor: first < last ? { messageId: idAt(first), sourceCreateTime: null } : null,
      newerCursor: first < last ? { messageId: idAt(last - 1), sourceCreateTime: null } : null,
      hasOlderStored: first > 0,
      hasNewerStored: last < count,
      loadedRecordCount: last - first,
      totalKnownRecordCount: count,
      hasUnsequencedRecords: false,
      source: 'saved' as const,
      sourceRevision: count,
      sourceInstanceId: 'synthetic-canonical-v1',
      accountId: 'demo-verified-account',
    }
  }
  const state = (): HistoryLoaderState => ({
    phase,
    sessionId: session,
    conversationId: context.conversationId,
    knownMessageCount: count,
    hasOlderServerHistory: scene === 'empty' ? false : null,
    pagesLoaded: phase === 'scrolling' ? 2 : 0,
    consecutiveErrors: 0,
  })
  const saved = () =>
    Array.from({ length: Math.min(count, 200) }, (_, i) => ({
      id: `demo-msg-${i + 1}`,
      text: `Синтетическое сообщение ${i + 1}; здесь нет пользовательских данных`,
      coverage: i % 3 ? 'complete' : 'contains_opaque',
    }))
  const notify = () => {
    window.dispatchEvent(new CustomEvent(HISTORY_LOADER_STATE_EVENT, { detail: state() }))
    for (const listener of savedListeners) listener()
  }
  const adapter = {
    collectionInsideExportOnly: false,
    currentConversationId: () => context.conversationId,
    currentProjectId: () => context.projectId,
    currentAccountId: () => (scene === 'empty' ? null : 'demo-verified-account'),
    async getCurrentContext() {
      if (scene === 'error') throw Error('DEMO source unavailable')
      return { ...context }
    },
    async getCoverage(id: string) {
      if (scene === 'error') throw Error('DEMO coverage failure')
      return {
        conversationId: id,
        knownMessageCount: count,
        visibleMessageCount: count,
        internalRecordCount: Math.round(count * 3),
        completeAtLastRead: false,
        lastFullReadAt: null,
        hasOlderServerHistory: null,
        integrity: integrity(),
      }
    },
    subscribeContextChange: (_cb: () => void) => () => undefined,
    liveSavedUpdates: true,
    subscribeExportChanges: (_id: string, listener: () => void) => {
      savedListeners.add(listener)
      return () => {
        savedListeners.delete(listener)
      }
    },
    async getRangeMessageIds(_id: string, firstId: string, lastId: string) {
      const first = indexOf(firstId),
        last = indexOf(lastId)
      if (first < 0 || last < 0) throw Error('archive.error.messageMissing')
      return Array.from({ length: Math.abs(last - first) + 1 }, (_, offset) =>
        idAt(Math.min(first, last) + offset),
      )
    },
    async getBranchPath(_id: string, tip: string) {
      const path: string[] = []
      let index = indexOf(tip)
      if (index < 0) throw Error('archive.error.messageMissing')
      while (index >= 0) {
        path.push(idAt(index))
        const parent = rawAt(index).metadata.parent_id
        index = parent ? indexOf(parent) : -1
      }
      return path.reverse()
    },
    async getMessageVersions(_id: string, messageId: string) {
      const index = indexOf(messageId)
      if (index < 0) throw Error('archive.error.messageMissing')
      const older = normalizeConversationMessage(
        {
          ...rawAt(index),
          content: { content_type: 'text', parts: [`Синтетическое сообщение ${index + 1}`] },
        },
        'demo-dialog',
        null,
        1800000000000,
      )
      if (!older) throw Error('Synthetic source version cannot be normalized')
      return [
        {
          observedAtMs: 1800000000000,
          decision: 'initial',
          thread: buildArchiveThread([{ ...older, messageKey: keyAt(index) }]),
        },
        {
          observedAtMs: 1800000001000,
          decision: 'advance',
          thread: buildArchiveThread([recordAt(index)]),
        },
      ]
    },
    async getTimeline() {
      return Array.from({ length: count }, (_, index) => ({
        id: idAt(index),
        key: keyAt(index),
        parentId: rawAt(index).metadata.parent_id,
        label: index % 2 ? 'Assistant' : 'User',
        preview: rawAt(index).content.parts[0] ?? '',
        uncertain: false,
      }))
    },
    getCollectionState: () => state(),
    async collectCurrent() {
      if (stopped) stopped = false
      phase = 'preparing'
      session++
      notify()
      await sleep(180)
      if (stopped) return
      phase = 'scrolling'
      notify()
      await sleep(220)
      if (stopped) return
      count += 5
      phase = 'complete'
      notify()
    },
    stopCollection() {
      stopped = true
      phase = 'cancelled'
      notify()
    },
    async clearAll() {
      throw Error('Preview prohibits persistence mutations')
    },
    listExportFormats: () => [{ id: 'json', label: 'JSON', mimeType: 'application/json' }],
    async exportConversation() {
      throw Error('Only explicit synthetic export is available')
    },
    async listProjects() {
      return [{ projectId: 'demo-project', title: 'Разработка приложения' }]
    },
    async listConversations() {
      return count
        ? [
            {
              conversationId: 'demo-dialog',
              projectId: 'demo-project',
              title: context.conversationTitle,
              updatedAt: Date.now(),
              lastSeenAt: Date.now(),
              archiveState: 'partial' as const,
              branchSourceConversationId: null,
              branchSourceTitle: null,
            },
          ]
        : []
    },
    async getConversation(id: string) {
      if (!count) return undefined
      return {
        conversationId: id,
        projectId: 'demo-project',
        title: context.conversationTitle,
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
        archiveState: 'partial' as const,
        branchSourceConversationId: null,
        branchSourceTitle: null,
      }
    },
    async listMessages() {
      return []
    },
    async getThread() {
      return threadBetween(0, count)
    },
    async getThreadWindow(
      _id: string,
      cursor?: ArchiveWindowCursor | null,
      direction: 'first' | 'older' | 'newer' = 'older',
      request?: ArchiveWindowRequest,
    ) {
      const index = cursor ? indexOf(cursor.messageId) : -1
      const end =
        direction === 'first'
          ? Math.min(160, count)
          : direction === 'older'
            ? cursor
              ? index
              : count
            : Math.min(count, index + 161)
      const start =
        direction === 'first' ? 0 : direction === 'older' ? Math.max(0, end - 160) : index + 1
      return makeWindow(start, end, request)
    },
    async getPositionWindow(
      _id: string,
      position: 'first' | 'middle' | 'latest',
      request?: ArchiveWindowRequest,
    ) {
      const start =
        position === 'first'
          ? 0
          : position === 'middle'
            ? Math.max(0, Math.floor((count - 160) / 2))
            : Math.max(0, count - 160)
      return makeWindow(start, Math.min(count, start + 160), request)
    },
    async getMessageWindow(_id: string, messageId: string, request?: ArchiveWindowRequest) {
      const index = indexOf(messageId)
      if (index < 0) throw Error('archive.error.messageMissing')
      return makeWindow(Math.max(0, index - 80), Math.min(count, index + 81), request)
    },
  } as unknown as ArchiveDataAdapter
  const fixedArchive: FixedChatGptView = {
    currentConversationId: () => context.conversationId,
    async listCurrent() {
      return saved()
    },
    async exportCurrent() {
      return new Blob([JSON.stringify(saved())], { type: 'application/json' })
    },
    async savedCurrent() {
      return count
    },
    async savedCurrentSummary() {
      return { messages: count, internalElements: count * 3, toolCalls: count * 2, reasoning: count }
    },
    captureFailed: () => scene === 'error',
    async listSavedConversations() {
      return count
        ? [
            {
              conversationId: 'demo-dialog',
              projectId: 'demo-project',
              title: context.conversationTitle,
            },
          ]
        : []
    },
    async listSavedProjects() {
      return [{ projectId: 'demo-project', title: 'Разработка приложения' }]
    },
    async readConversation() {
      return saved().map((row) => ({
        id: row.id,
        raw: { id: row.id, text: row.text },
        canonical: {},
        observedAtMs: Date.now(),
      }))
    },
    async exportConversation() {
      return new Blob([JSON.stringify(saved())], { type: 'application/json' })
    },
    async exportUserConversation(_id, _options, signal) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      return {
        blob: new Blob([JSON.stringify(saved())], { type: 'application/json' }),
        extension: 'json',
        packaged: false,
        complete: false,
        includedAssets: 0,
        missingAssets: 0,
      }
    },
    async savedCount() {
      return count
    },
    async hasMessagesBefore() {
      return false
    },
    async hasMessagesAfter() {
      return false
    },
    async windowConversation() {
      return []
    },
    async collectCurrent() {
      await adapter.collectCurrent()
    },
    stopCollection() {
      adapter.stopCollection?.({ reason: 'user' })
    },
    subscribeSaved(listener) {
      const callback = () => listener('demo-dialog')
      savedListeners.add(callback)
      return () => {
        savedListeners.delete(callback)
      }
    },
    async messageVersions() {
      return []
    },
    backupPort() {
      throw Error('Synthetic backup uses the isolated Lab memory stage')
    },
    async sourceRevision() {
      return 1
    },
    async sourceInstanceId() {
      return 'synthetic-canonical-v1'
    },
    async timelineMessages() {
      return Array.from({ length: count }, (_, index) => ({
        id: idAt(index),
        parentId: rawAt(index).metadata.parent_id,
        parentKnown: true,
        role: rawAt(index).author.role,
        channel: rawAt(index).channel,
        recipient: 'all',
        preview: rawAt(index).content.parts[0] ?? '',
        sourceCreateTime: rawAt(index).create_time,
      }))
    },
    async branchPath() {
      return []
    },
    async rangeMessageIds(_id, firstId, lastId) {
      const rows = Array.from({ length: count }, (_, index) => `demo-msg-${index + 1}`)
      const first = rows.indexOf(firstId),
        last = rows.indexOf(lastId)
      if (first < 0 || last < 0) throw Error('archive.error.messageMissing')
      return rows.slice(Math.min(first, last), Math.max(first, last) + 1)
    },
    async integrity() {
      return integrity()
    },
    async windowAroundMessage() {
      return []
    },
  }
  return { adapter, fixedArchive, getCount: () => count }
}

export function createMockVkArchive(scene: LabScene, method: LabMethod, inConversation = true) {
  const size = fixtureSize(scene)
  const peer = inConversation ? 9001 : null
  const rows: VkMessage[] = Array.from(
    { length: inConversation ? Math.min(size, 3000) : 0 },
    (_, i) => ({
      id: i + 1001,
      peer_id: 9001,
      date: 1760000000 + i * 90,
      from_id: i % 2 ? 33 : 44,
      out: i % 2,
      ...(i === 1
        ? {
            attachments: [
              {
                type: 'photo',
                photo: {
                  sizes: [{ url: 'https://example.invalid/demo-photo.png', width: 640, height: 480 }],
                },
              },
            ],
          }
        : i === 4
          ? {
              attachments: [
                {
                  type: 'doc',
                  doc: {
                    title: 'Методичка.pdf',
                    ext: 'pdf',
                    size: 12800,
                    url: 'https://example.invalid/demo-doc.pdf',
                  },
                },
              ],
            }
          : {}),
      text: `Сообщение ${i + 1}: обсуждаем план следующего выпуска.`,
    }),
  )
  let cancelled = false
  let fullScanAt: number | null = null
  let options: ArchiveOptions = {
    peerId: peer ?? 0,
    mode: 'recent',
    limit: 100,
    from: '',
    through: '',
    pageSize: 100,
    delay: 500,
    media: false,
  }
  let status: ArchiveStatus = {
    archiveRevision: 0,
    version: '1.0.0',
    folder: null,
    activePeerId: peer,
    blockedReason: scene === 'error' ? 'Доступ к источнику отсутствует' : null,
    busy: false,
    folderPending: false,
    options,
    progress: {
      phase: scene === 'loading' ? 'Dexie: сообщения' : 'Ожидание',
      done: scene === 'loading' ? 11 : 0,
      total: scene === 'loading' ? 100 : 0,
    },
    messages: rows.length,
    checkpoint: null,
  }
  const listeners = new Set<(value: ArchiveStatus) => void>()
  const announce = () => {
    status = { ...status, options: { ...options }, progress: { ...status.progress } }
    for (const cb of listeners) cb(status)
  }
  const api: ArchiveApi = {
    version: '1.0.0',
    configure(value) {
      options = { ...options, ...value }
      status = { ...status, options }
      announce()
      return status
    },
    status() {
      return status
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    async selectFolder() {
      return status
    },
    async useFolder() {
      return status
    },
    async run() {
      return { matched: rows.length, newCount: 0, saved: 0, files: 0, folder: 'Тестовый архив' }
    },
    async resume() {
      return { matched: rows.length, newCount: 0, saved: 0, files: 0, folder: 'Тестовый архив' }
    },
    stop() {
      cancelled = true
      status = { ...status, busy: false, progress: { ...status.progress, phase: 'Отменено' } }
      announce()
    },
    show() {},
    hide() {},
    async buildViewer() {
      return { messages: rows.length }
    },
    async captureFixed(limit = 100) {
      if (!peer || status.blockedReason) throw Error('Synthetic peer unavailable')
      if (limit !== 'all' && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000))
        throw Error('Invalid synthetic capture limit')
      const requested = limit === 'all' ? rows.length : Math.min(limit, rows.length)
      cancelled = false
      status = {
        ...status,
        busy: true,
        progress: { phase: 'Dexie: сообщения', done: 0, total: requested },
      }
      announce()
      await sleep(230)
      if (cancelled)
        return {
          saved: 0,
          alreadySaved: 0,
          available: rows.length,
          complete: false,
          attachmentReferences: 0,
        }
      const saved = Math.min(requested, 8)
      const complete = requested >= rows.length
      fullScanAt = complete ? Date.now() : null
      status = {
        ...status,
        archiveRevision: (status.archiveRevision ?? 0) + 1,
        busy: false,
        progress: {
          phase: complete ? 'Dexie: сохранено' : 'Dexie: частично',
          done: requested,
          total: requested,
          newCount: saved,
          scanned: requested,
          attachmentReferences: 0,
        },
        messages: rows.length,
      }
      announce()
      return {
        saved,
        alreadySaved: Math.max(0, requested - saved),
        available: rows.length,
        complete,
        attachmentReferences: 0,
      }
    },
    async countFixed() {
      if (!peer || status.blockedReason) throw Error('Synthetic peer unavailable')
      return rows.length
    },
    async resolveParticipants(userIds: readonly number[]) {
      return userIds
        .filter((id) => id === 33 || id === 44)
        .map((id) => ({
          id,
          name: id === 33 ? 'Анна Смирнова' : 'Алексей Иванов',
          avatarUrl: null,
        }))
    },
    async readFixed(limit = 80, after?: number) {
      return rows.filter((m) => after === undefined || m.id > after).slice(0, limit)
    },
    async timelineFixed(signal) {
      signal?.throwIfAborted()
      if (!peer || status.blockedReason) throw Error('Synthetic peer unavailable')
      if (scene === 'loading') await sleep(300)
      signal?.throwIfAborted()
      return rows.map((row) => ({
        id: row.id,
        date: row.date ?? null,
        senderId: row.from_id ?? null,
        outgoing: row.out === true || row.out === 1,
        text: row.text?.slice(0, 160) ?? null,
      }))
    },
    async coverageFixed() {
      if (!peer || status.blockedReason) throw Error('Synthetic peer unavailable')
      const first = rows[0],
        last = rows.at(-1),
        verified = fullScanAt !== null
      return {
        savedCount: rows.length,
        reportedCount: verified ? rows.length : null,
        first: first ? { id: first.id, text: first.text ?? null, date: first.date ?? null } : null,
        last: last ? { id: last.id, text: last.text ?? null, date: last.date ?? null } : null,
        observedAtMs: fullScanAt,
        verification: verified ? 'session-scan' : 'unknown',
        integrity: linearArchiveIntegrity({
          savedCount: rows.length,
          reportedCount: verified ? rows.length : null,
          firstId: first ? String(first.id) : null,
          lastId: last ? String(last.id) : null,
          startReached: verified,
          endReached: verified,
          countStable: verified,
          current: verified,
        }),
      }
    },
    async rangeFixed(firstId, lastId, signal) {
      signal?.throwIfAborted()
      if (!peer || status.blockedReason) throw Error('Synthetic peer unavailable')
      if (
        ![firstId, lastId].every((id) => Number.isSafeInteger(id) && id > 0) ||
        !rows.some((row) => row.id === firstId) ||
        !rows.some((row) => row.id === lastId)
      )
        throw Error('Synthetic range endpoint unavailable')
      const selected = rows.filter(
        (row) => row.id >= Math.min(firstId, lastId) && row.id <= Math.max(firstId, lastId),
      )
      const first = selected[0],
        last = selected.at(-1)
      if (!first || !last) throw Error('Synthetic range is empty')
      return { messageIds: selected.map((row) => row.id), first, last }
    },
    async exportUserConversation(choice, onProgress) {
      if (!peer || status.blockedReason) throw Error('Synthetic peer unavailable')
      const ownerId = 'ui-lab-owner'
      return createVkUserExport(
        {
          async countMessages() {
            return rows.length
          },
          async listMessages(_peer, limit, after) {
            return rows
              .filter((row) => after === undefined || row.id > after)
              .slice(0, limit)
              .map((row) => ({
                key: JSON.stringify([ownerId, peer, row.id]),
                ownerId,
                peerId: peer,
                messageId: row.id,
                schemaVersion: 1 as const,
                date: row.date,
                senderId: row.from_id ?? null,
                outgoing: row.out === true || row.out === 1,
                text: row.text ?? null,
                attachmentCount: row.attachments?.length ?? null,
              }))
          },
          async getOriginal(_peer, id) {
            const raw = rows.find((row) => row.id === id)
            return raw
              ? {
                  key: JSON.stringify([ownerId, peer, id]),
                  ownerId,
                  sourceVersion: 'ui-lab',
                  recordedAtMs: 0,
                  raw: structuredClone(raw),
                }
              : undefined
          },
        },
        peer,
        choice,
        () => {
          if (status.blockedReason) throw Error('Synthetic peer unavailable')
        },
        onProgress,
        await api.coverageFixed?.(),
      )
    },
    async exportUserZip(choice, onProgress) {
      return (await api.exportUserConversation({ ...choice, packaging: 'zip' }, onProgress)).blob
    },
    async downloadAttachmentFixed(_messageId, _assetKey, signal) {
      signal?.throwIfAborted()
      throw Error('Synthetic attachment bytes unavailable; no provider request was made')
    },
    async exportFixed() {
      return new Blob([JSON.stringify(rows)], { type: 'application/json' })
    },
    async backupPortable() {
      throw Error('Operator recovery is intentionally disabled in UI lab')
    },
    async inspectPortable() {
      throw Error('Operator recovery is intentionally disabled in UI lab')
    },
    async restorePortable() {
      throw Error('Operator recovery is intentionally disabled in UI lab')
    },
    getMessages: () => [...rows],
    previewMessages({ limit, offset = 0, query = '' }) {
      const found = rows.filter((m) => (m.text || '').includes(query))
      return { messages: found.slice(offset, offset + limit), matching: found.length }
    },
    previewAttachments() {
      return {}
    },
    destroy() {
      listeners.clear()
    },
  }
  const globalName = instanceKey('VKExport', 'vk-booster:prod')
  Object.defineProperty(globalThis, globalName, { value: api, writable: true, configurable: true })
  const target = method === 'tampermonkey' ? ('userscript' as const) : ('chromium' as const)
  let captured: unknown = null
  setVkPreferencesPersistence({
    scopeId: 'all-in-one:dev',
    target,
    read: async () =>
      captured as Awaited<
        ReturnType<NonNullable<Parameters<typeof setVkPreferencesPersistence>[0]>['read']>
      >,
    write: async (value) => {
      captured = { ...value }
    },
  })
  return {
    api,
    dispose: () => {
      setVkPreferencesPersistence(null)
      delete (globalThis as Record<string, unknown>)[globalName]
    },
  }
}
