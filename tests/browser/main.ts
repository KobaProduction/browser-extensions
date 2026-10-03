import { buildArchiveThread } from '../../packages/chatgpt/src/archive-records'
import {
  type ArchiveExportOptions,
  type BoosterSettings,
  DEFAULT_CAPTURE_RULE,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
  snapshotSettings,
} from '../../packages/core/src'
import {
  downloadArchiveExport,
  serializeArchiveExport,
} from '../../packages/features/src/archive-export'
import { ConversationArchiveStore } from '../../packages/features/src/archive-store'
import { ConversationArchiveModule } from '../../packages/features/src/conversation-archive'
import { HistoryLoaderModule } from '../../packages/features/src/history-loader'
import { ARCHIVE_EVENT, TRANSPORT_CHANNEL } from '../../packages/observer/src'
import { mountBoosterUi } from '../../packages/ui/src/mount'
import { runLoaderCancellationTests, runLoaderScrollTest } from './loader'
import { runUiTests } from './ui'

const store = new ConversationArchiveStore()
const projectA = 'g-p-11111111111111111111111111111111'
const projectB = 'g-p-22222222222222222222222222222222'
const listeners = new Set<(settings: BoosterSettings) => void>()
let current = normalizeSettings(
  JSON.parse(localStorage.getItem('fixture-settings') ?? 'null') ?? undefined,
)
const settings: SettingsAdapter = {
  async get() {
    return snapshotSettings(current)
  },
  async set(value) {
    current = snapshotSettings(value)
    localStorage.setItem('fixture-settings', JSON.stringify(current))
    for (const listener of listeners) listener(snapshotSettings(current))
  },
  async update(patch) {
    await this.set(mergeSettings(current, patch))
    return snapshotSettings(current)
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
const context = {
  conversationId: 'fixture-current',
  conversationTitle: 'Проверка панели и архива',
  projectId: projectA,
  projectTitle: 'Koba Infrastructure · тест',
}
function raw(id: string, role: string, text: string, parent?: string) {
  return {
    id,
    author: { role },
    recipient: 'all',
    channel: role === 'assistant' ? 'final' : null,
    content: { content_type: 'text', parts: [text] },
    create_time: 1700000000,
    metadata: parent ? { parent_id: parent } : {},
    status: 'finished_successfully',
  }
}
function page(
  id: string,
  messages: Record<string, unknown>[],
  patch: Record<string, unknown> = {},
) {
  return {
    kind: 'conversation-page' as const,
    conversationId: id,
    timestamp: Date.now(),
    sourceUrl: 'fixture://history',
    readId: 'fixture-read',
    readStartedAt: Date.now(),
    isInitial: true,
    requestedBefore: null,
    payload: {
      conversation_id: id,
      title: id,
      gizmo_id: null,
      ...patch,
      messages,
      page_info: {
        start_cursor: 'start',
        end_cursor: 'end',
        has_previous_page: false,
        has_next_page: false,
        ...((patch.page_info as object) ?? {}),
      },
    },
  }
}
const report: { name: string; pass: boolean; detail?: string }[] = []
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    report.push({ name, pass: true })
  } catch (error) {
    report.push({
      name,
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
async function until(fn: () => Promise<boolean>, timeout = 2500) {
  const started = Date.now()
  while (!(await fn())) {
    if (Date.now() - started > timeout) throw new Error('fixture wait timed out')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
async function runStorageTests() {
  report.length = 0
  const prefix = `runtime-${Date.now()}-`
  await check('duplicate page and IDs: idempotent upsert with accurate summary', async () => {
    const id = `${prefix}duplicate`,
      u = raw('u', 'user', 'Hello'),
      a = raw('a', 'assistant', 'Answer', 'u')
    const payload = page(id, [u, u, a])
    const first = await store.ingest(payload)
    const second = await store.ingest(payload)
    assert(
      first?.insertedMessages === 2 && second?.insertedMessages === 0,
      'duplicate insert count',
    )
    assert((await store.getCoverage(id))?.visibleMessageCount === 2, 'reply count')
    assert((await store.listMessages(id)).length === 2, 'duplicate rows')
    await store.ingest(page(id, [raw('a', 'assistant', 'Edited answer', 'u')]))
    assert((await store.listMessages(id)).length === 2, 'semantic update duplicated ID')
  })
  await check(
    'concurrent ingestion uses real serial IndexedDB read/write transactions',
    async () => {
      const id = `${prefix}concurrent`
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          store.ingest(page(id, [raw(`u${i}`, 'user', `reply ${i}`)])),
        ),
      )
      assert((await store.getCoverage(id))?.knownMessageCount === 8, 'lost record count')
      assert((await store.listMessages(id)).length === 8, 'lost rows')
    },
  )
  await check('revocation while DB reads are in flight produces no put', async () => {
    let checks = 0
    const id = `${prefix}revoked`
    const result = await store.ingest(
      page(id, [raw('u', 'user', 'Must not persist')]),
      () => ++checks < 3,
    )
    assert(checks === 3 && result === undefined, 'commit guard did not run')
    assert(!(await store.getConversation(id)), 'revoked conversation persisted')
    assert((await store.listMessages(id)).length === 0, 'revoked messages persisted')
  })
  await check('concurrent null project title never erases an observed name', async () => {
    const id = `${prefix}project`
    await Promise.all([
      store.upsertProject(id, 'Observed project'),
      store.upsertProject(id, null),
      store.upsertProject(id, '  '),
    ])
    assert(
      (await store.listProjects()).find((p) => p.projectId === id)?.title === 'Observed project',
      'lost name',
    )
  })
  await check('project removal updates all normalized message links', async () => {
    const id = `${prefix}move`
    await store.ingest(
      page(id, [raw('u', 'user', 'First'), raw('a', 'assistant', 'Second', 'u')], {
        gizmo_id: projectA,
        gizmo_type: 'snorlax',
      }),
    )
    await store.ingest(page(id, [raw('u', 'user', 'First')], { gizmo_id: null }))
    assert((await store.getConversation(id))?.projectId === null, 'stale conversation project')
    assert(
      (await store.listMessages(id)).every((message) => message.projectId === null),
      'stale message project',
    )
  })
  await check(
    'basic export excludes conversation raw and nested records with real stored objects',
    async () => {
      const id = `${prefix}export`
      await store.ingest(
        page(
          id,
          [
            raw('u', 'user', 'Public text'),
            { ...raw('tool', 'tool', 'TOOL_PRIVATE'), recipient: 'tool.test' },
          ],
          { private_metadata: 'STORAGE_PRIVATE' },
        ),
      )
      const conversation = await store.getConversation(id)
      assert(conversation, 'missing export fixture')
      const options = normalizeSettings().export
      const result = serializeArchiveExport(
        conversation,
        buildArchiveThread(await store.listMessages(id)),
        options,
        { verified: false },
      )
      assert(
        !result.text.includes('STORAGE_PRIVATE') && !result.text.includes('TOOL_PRIVATE'),
        'basic export metadata leak',
      )
    },
  )
  await check(
    'selective/manual capture and cancellation: local event fixture, no network',
    async () => {
      const id = `${prefix}capture`
      const href = location.href
      const previous = snapshotSettings(current)
      const capture = new ConversationArchiveModule(store, settings)
      history.replaceState(null, '', `/c/${id}`)
      await settings.set(normalizeSettings())
      await capture.start()
      const ticketKey = 'chatgpt-booster:manual-collection'
      try {
        const emitPage = (messages: Record<string, unknown>[]) =>
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: location.origin,
              source: window,
              data: { channel: TRANSPORT_CHANNEL, type: ARCHIVE_EVENT, detail: page(id, messages) },
            }),
          )
        emitPage([raw('denied', 'user', 'No consent')])
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert(!(await store.getConversation(id)), 'default-deny failed')
        await settings.update({
          archive: {
            conversations: {
              [id]: {
                ...DEFAULT_CAPTURE_RULE,
                enabled: false,
                reasoning: false,
                internal: false,
                tools: true,
              },
            },
          },
        })
        const startedAt = Date.now()
        sessionStorage.setItem(
          ticketKey,
          JSON.stringify({ conversationId: id, startedAt, expiresAt: startedAt + 60000 }),
        )
        emitPage([
          raw('u', 'user', 'Manual reply'),
          { ...raw('r', 'assistant', 'REASONING_EXCLUDED', 'u'), channel: 'analysis' },
          raw('t', 'tool', 'Tool result', 'u'),
        ])
        await until(async () => (await store.listMessages(id)).length === 2)
        const records = await store.listMessages(id)
        assert(!records.some((record) => record.messageId === 'r'), 'manual ignored categories')
        capture.finishCollection()
        emitPage([raw('after', 'user', 'After cancellation')])
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert((await store.listMessages(id)).length === 2, 'cancelled capture continued')
      } finally {
        capture.stop()
        sessionStorage.removeItem(ticketKey)
        history.replaceState(null, '', href)
        await settings.set(previous)
      }
    },
  )
  return report
}
async function seed() {
  await Promise.all([
    store.upsertProject(projectA, context.projectTitle),
    store.upsertProject(projectB, 'Другой проект · тест'),
  ])
  const messages: Record<string, unknown>[] = []
  for (let i = 0; i < 55; i++) {
    const u = `user-${String(i).padStart(3, '0')}`
    messages.push({ ...raw(u, 'user', `Вопрос ${i + 1}`), create_time: 1700000000 + i * 2 })
    messages.push({
      ...raw(`tool-${i}`, 'tool', `Результат инструмента ${i + 1}`, u),
      create_time: 1700000000 + i * 2 + 0.2,
      author: { role: 'tool', name: 'fixture.lookup' },
    })
    messages.push({
      ...raw(`answer-${i}`, 'assistant', `Ответ ${i + 1}: только тестовые данные.`, u),
      create_time: 1700000000 + i * 2 + 1,
    })
  }
  await store.ingest(
    page(context.conversationId, messages, {
      title: context.conversationTitle,
      gizmo_id: projectA,
      gizmo_type: 'snorlax',
    }),
  )
  await store.ingest(
    page('fixture-other', [raw('u', 'user', 'Other')], {
      title: 'Другой диалог',
      gizmo_id: projectB,
      gizmo_type: 'snorlax',
    }),
  )
}
const exports: { text: string; mime: string; extension: string }[] = []
const adapter = {
  getCurrentContext: async () => ({ ...context }),
  currentConversationId: () => context.conversationId,
  currentProjectId: () => context.projectId,
  listProjects: () => store.listProjects(),
  listConversations: () => store.listConversations(),
  getConversation: (id: string) => store.getConversation(id),
  getCoverage: (id: string) => store.getCoverage(id),
  listMessages: (id: string) => store.listMessages(id),
  getThread: async (id: string) => buildArchiveThread(await store.listMessages(id)),
  collectCurrent: async () => {
    throw new Error('archive.error.noChat')
  },
  exportConversation: async (id: string, options: ArchiveExportOptions) => {
    const c = await store.getConversation(id)
    if (!c) throw new Error('archive.error.noChat')
    const result = serializeArchiveExport(
      c,
      buildArchiveThread(await store.listMessages(id)),
      options,
      { verified: false, fixture: true },
    )
    exports.push(result)
    downloadArchiveExport(result, c.title)
  },
}
await seed()
mountBoosterUi({ settingsAdapter: settings, archiveAdapter: adapter, target: 'userscript' })
Object.assign(window, {
  extension2Harness: {
    ready: true,
    runStorageTests,
    runUiTests: () => runUiTests(settings),
    runLoaderCancellationTests,
    runLoaderScrollTest: () => runLoaderScrollTest(store),
    settings,
    context,
    exports,
    store,
    HistoryLoaderModule,
    ConversationArchiveModule,
  },
})
const status = document.querySelector('#fixture-status')
if (status) status.textContent = 'Fixture ready. Use the edge toolkit.'
