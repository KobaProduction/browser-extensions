/** Deliberately synthetic UI-only ports. No real provider/network/storage access. */
import {
  type ArchiveCurrentContext,
  type ArchiveThreadView,
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
import type { FixedChatGptView } from '@chatgpt-booster/features'
import type { ArchiveDataAdapter } from '@chatgpt-booster/ui'
import { instanceKey } from '@kobaproduction/browser-core'
import { setVkPreferencesPersistence } from '../../../modules/vk-booster/src/features/chat-export/model/durable-preferences'
import type {
  ArchiveApi,
  ArchiveOptions,
  ArchiveStatus,
  VkMessage,
} from '../../../modules/vk-booster/src/features/chat-export/model/types'
import type { LabMethod, LabScene } from './scenes'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
export const fixtureSize = (scene: LabScene) => (scene === 'empty' ? 0 : scene === 'long' ? 3000 : 32)
export const fixtureTitle = (scene: LabScene) =>
  scene === 'long'
    ? 'DEMO: исключительно длинное синтетическое название диалога — проверка переноса и выхода элементов за пределы viewport'
    : 'DEMO: сбор истории ChatGPT и архива VK'

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
  projectTitle: 'DEMO: интерфейс без реального аккаунта',
})
const emptyThread = (): ArchiveThreadView => ({
  turns: [],
  messageCount: 0,
  recordCount: 0,
  detailCount: 0,
})
export function createMockChatGptArchive(scene: LabScene) {
  let count = fixtureSize(scene)
  let phase: HistoryLoaderState['phase'] = scene === 'loading' ? 'scrolling' : 'idle'
  let stopped = false
  let session = 0
  const context = demoContext(scene)
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
  const notify = () =>
    window.dispatchEvent(new CustomEvent(HISTORY_LOADER_STATE_EVENT, { detail: state() }))
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
      }
    },
    subscribeContextChange: (_cb: () => void) => () => undefined,
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
    listExportFormats: () => [{ id: 'json', label: 'DEMO JSON', mimeType: 'application/json' }],
    async exportConversation() {
      throw Error('Only explicit synthetic export is available')
    },
    async listProjects() {
      return [{ projectId: 'demo-project', title: 'DEMO: проект' }]
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
      return emptyThread()
    },
    async getThreadWindow() {
      return {
        thread: emptyThread(),
        olderCursor: null,
        newerCursor: null,
        hasOlderStored: false,
        hasNewerStored: false,
        loadedRecordCount: 0,
        totalKnownRecordCount: count,
        hasUnsequencedRecords: false,
        source: 'saved' as const,
        sourceRevision: null,
        sourceInstanceId: null,
        accountId: 'demo-verified-account',
      }
    },
  } as unknown as ArchiveDataAdapter
  const fixedArchive = {
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
      return [{ projectId: 'demo-project', title: 'DEMO: проект' }]
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
  } as FixedChatGptView
  return { adapter, fixedArchive, getCount: () => count }
}

export function createMockVkArchive(scene: LabScene, method: LabMethod) {
  const size = fixtureSize(scene)
  const peer = scene === 'empty' ? null : 9001
  const rows: VkMessage[] = Array.from({ length: Math.min(size, 3000) }, (_, i) => ({
    id: i + 1001,
    peer_id: 9001,
    date: 1760000000 + i * 90,
    from_id: i % 2 ? 33 : 44,
    text: `DEMO VK ${i + 1}: только синтетический пример переписки.`,
  }))
  let cancelled = false
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
    version: '1.0.0',
    folder: null,
    activePeerId: peer,
    blockedReason: scene === 'error' ? 'DEMO: доступ к источнику отсутствует' : null,
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
      return { matched: rows.length, newCount: 0, saved: 0, files: 0, folder: 'DEMO' }
    },
    async resume() {
      return { matched: rows.length, newCount: 0, saved: 0, files: 0, folder: 'DEMO' }
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
      status = {
        ...status,
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
    async readFixed(limit = 80, after?: number) {
      return rows.filter((m) => after === undefined || m.id > after).slice(0, limit)
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
