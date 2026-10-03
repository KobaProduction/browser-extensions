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
import { serializeArchiveExport } from '../../packages/features/src/archive-export'
import { ConversationArchiveStore } from '../../packages/features/src/archive-store'
import { createArchiveUiAdapter } from '../../packages/features/src/archive-ui-adapter'
import {
  ConversationArchiveModule,
  collectionTicket,
} from '../../packages/features/src/conversation-archive'
import { HistoryLoaderModule } from '../../packages/features/src/history-loader'
import { ARCHIVE_ASSET_EVENT, ARCHIVE_EVENT, TRANSPORT_CHANNEL } from '../../packages/observer/src'
import { mountBoosterUi } from '../../packages/ui/src/mount'
import { runLoaderCancellationTests, runLoaderIsolationTests, runLoaderScrollTest } from './loader'
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
const context: {
  conversationId: string
  conversationTitle: string | null
  projectId: string | null
  projectTitle: string | null
} = {
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
  await check('attachment metadata and only verified signed resolution are persisted', async () => {
    const id = `${prefix}asset`
    const assetId = `file_${prefix.replace(/[^a-z0-9]/gi, '')}`
    await store.ingest(
      page(id, [
        {
          ...raw('attachment', 'user', 'Attachment'),
          content: {
            content_type: 'multimodal_text',
            parts: [
              {
                content_type: 'image_asset_pointer',
                asset_pointer: `sediment://${assetId}`,
                mime_type: 'image/png',
                size_bytes: 3,
                width: 1,
                height: 1,
              },
              'Attachment',
            ],
          },
          metadata: { attachments: [{ id: assetId, name: 'fixture.png', size: 3 }] },
        },
      ]),
    )
    const initial = (await store.getAssets([assetId]))[0]
    assert(
      initial?.fileName === 'fixture.png' && initial.downloadUrl === null,
      'asset placeholder missing',
    )
    assert(
      (await store.updateAssetResolution(
        {
          assetId,
          downloadUrl: `https://chatgpt.com/backend-api/estuary/content?id=${assetId}&sig=fixture`,
          fileName: 'fixture.png',
          mimeType: 'image/png',
          fileSizeBytes: 3,
          observedAt: Date.now(),
        },
        id,
      )) === true,
      'valid signed URL was rejected',
    )
    assert(
      (await store.getAssets([assetId]))[0]?.downloadUrl?.includes(`id=${assetId}`),
      'resolution missing',
    )
    assert(
      (await store.updateAssetResolution(
        {
          assetId,
          downloadUrl: `https://chatgpt.com/backend-api/estuary/content?id=${assetId}&sig=other-chat`,
          fileName: null,
          mimeType: null,
          fileSizeBytes: null,
          observedAt: Date.now(),
        },
        `${prefix}different`,
      )) === false,
      'resolver from an unrelated conversation updated a stored asset',
    )
    assert(
      (await store.updateAssetResolution(
        {
          assetId,
          downloadUrl: 'https://example.com/not-allowed',
          fileName: null,
          mimeType: null,
          fileSizeBytes: null,
          observedAt: Date.now(),
        },
        id,
      )) === false,
      'foreign resolver URL accepted',
    )
  })
  await check('asset resolver events respect capture consent', async () => {
    const id = `${prefix}asset-consent`
    const assetId = `file_${prefix.replace(/[^a-z0-9]/gi, '')}consent`
    const href = location.href
    const previous = snapshotSettings(current)
    await store.ingest(
      page(id, [
        {
          ...raw('attachment-consent', 'user', 'Attachment'),
          content: {
            content_type: 'multimodal_text',
            parts: [
              {
                content_type: 'image_asset_pointer',
                asset_pointer: `sediment://${assetId}`,
                mime_type: 'image/png',
                size_bytes: 3,
              },
            ],
          },
          metadata: { attachments: [{ id: assetId, name: 'consent.png', size: 3 }] },
        },
      ]),
    )
    const capture = new ConversationArchiveModule(store, settings)
    try {
      history.replaceState(null, '', `/c/${id}`)
      await settings.set(normalizeSettings())
      await capture.start()
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: location.origin,
          source: window,
          data: {
            channel: TRANSPORT_CHANNEL,
            type: ARCHIVE_ASSET_EVENT,
            detail: {
              assetId,
              downloadUrl: `https://chatgpt.com/backend-api/estuary/content?id=${assetId}&sig=denied`,
              fileName: 'consent.png',
              mimeType: 'image/png',
              fileSizeBytes: 3,
              observedAt: Date.now(),
            },
          },
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 120))
      assert(
        (await store.getAssets([assetId]))[0]?.downloadUrl === null,
        'disabled capture wrote asset URL',
      )
    } finally {
      capture.stop()
      history.replaceState(null, '', href)
      await settings.set(previous)
    }
  })
  await check('saved data survives policy changes and schema normalization', async () => {
    const id = prefix + 'preserved'
    await store.ingest(page(id, [raw('u', 'user', 'Keep me')]))
    await settings.update({
      archive: { conversations: { [id]: { ...DEFAULT_CAPTURE_RULE, enabled: false } } },
    })
    const normalized = normalizeSettings(await settings.get())
    assert(normalized.archive.conversations[id]?.enabled === false, 'policy did not persist')
    assert((await store.getConversation(id))?.conversationId === id, 'conversation was deleted')
    assert((await store.listMessages(id)).length === 1, 'records were deleted')
  })
  await check('manual ticket is tab/chat/time scoped', async () => {
    const ticketKey = 'chatgpt-booster:manual-collection'
    const href = location.href
    const now = Date.now()
    const id = prefix + 'ticket'
    try {
      history.replaceState(null, '', '/c/' + id)
      sessionStorage.setItem(
        ticketKey,
        JSON.stringify({
          conversationId: prefix + 'different',
          startedAt: now,
          expiresAt: now + 60_000,
        }),
      )
      assert(!collectionTicket(), 'ticket leaked to another chat')
      sessionStorage.setItem(
        ticketKey,
        JSON.stringify({
          conversationId: id,
          startedAt: now - 31 * 60_000,
          expiresAt: now + 60_000,
        }),
      )
      assert(!collectionTicket(), 'overlong ticket accepted')
      sessionStorage.setItem(
        ticketKey,
        JSON.stringify({
          conversationId: id,
          startedAt: now,
          expiresAt: now + 60_000,
        }),
      )
      assert(collectionTicket()?.conversationId === id, 'valid ticket rejected')
    } finally {
      sessionStorage.removeItem(ticketKey)
      history.replaceState(null, '', href)
    }
  })
  await check('late project title discovery is persisted to the project store', async () => {
    const href = location.href
    const project = 'g-p-' + 'a'.repeat(32)
    const chat = prefix + 'late-title'
    const link = document.createElement('a')
    link.href = '/g/' + project + '-late-title/project'
    link.textContent = 'Late project title'
    document.body.append(link)
    try {
      history.replaceState(null, '', '/g/' + project + '-late-title/c/' + chat)
      await store.upsertProject(project, null)
      const ui = createArchiveUiAdapter(store, {
        collectCurrent: async () => undefined,
      } as ConversationArchiveModule)
      const current = await ui.getCurrentContext()
      assert(current.projectTitle === 'Late project title', 'DOM title not observed')
      assert(
        (await store.listProjects()).find((item) => item.projectId === project)?.title ===
          'Late project title',
        'late title not persisted',
      )
    } finally {
      link.remove()
      history.replaceState(null, '', href)
    }
  })
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
async function appendCurrentExchange() {
  const suffix = String(Date.now())
  await store.ingest(
    page(
      context.conversationId,
      [
        {
          ...raw('runtime-user-' + suffix, 'user', 'Runtime refresh question'),
          create_time: 1800000000,
        },
        {
          ...raw(
            'runtime-answer-' + suffix,
            'assistant',
            'Runtime refresh answer',
            'runtime-user-' + suffix,
          ),
          create_time: 1800000001,
        },
      ],
      {
        title: context.conversationTitle,
        gizmo_id: context.projectId,
        gizmo_type: context.projectId ? 'snorlax' : null,
      },
    ),
  )
}
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
    return {
      packaged: false,
      complete: true,
      includedAssets: 0,
      missingAssets: 0,
      blob: new Blob([result.text], { type: `${result.mime};charset=utf-8` }),
      extension: result.extension as 'json' | 'md',
    }
  },
}
await seed()
mountBoosterUi({ settingsAdapter: settings, archiveAdapter: adapter, target: 'userscript' })
Object.assign(window, {
  extension2Harness: {
    ready: true,
    runStorageTests,
    runUiTests: () => runUiTests(settings, adapter, context, appendCurrentExchange),
    runLoaderCancellationTests,
    runLoaderIsolationTests,
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
