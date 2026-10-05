import { buildArchiveThread } from '../../packages/chatgpt/src/archive-records'
import { mountArchiveScopeControls } from '../../packages/chatgpt/src/archive-scope-controls'
import {
  type ArchiveExportOptions,
  type BoosterSettings,
  DEFAULT_CAPTURE_RULE,
  HISTORY_LOADER_START_EVENT,
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
import { ConversationDecoratorsModule } from '../../packages/features/src/conversation-decorators'
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
  await check(
    'scope control injection is idempotent, inert to host navigation and cleans up',
    async () => {
      const href = location.href
      const id = `${prefix}scope-control`
      const nav = document.createElement('nav')
      const row = document.createElement('li')
      const link = document.createElement('a')
      link.href = `/c/${id}`
      link.textContent = 'Fixture scope chat'
      row.append(link)
      nav.append(row)
      document.body.append(nav)
      let opened = 0
      try {
        history.replaceState(null, '', `/c/${id}`)
        const mount = (host: HTMLElement) => {
          const shadow = host.attachShadow({ mode: 'open' })
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = 'Archive status'
          button.addEventListener('click', () => opened++)
          shadow.append(button)
          return { update() {}, unmount() {} }
        }
        const controls = mountArchiveScopeControls({ visible: () => true, mount })
        const count = () =>
          row.querySelectorAll('[data-chatgpt-booster="archive-scope-control"]').length
        assert(count() === 1, 'scope control was not injected exactly once')
        controls.update({ visible: () => true, mount })
        controls.update({ visible: () => true, mount })
        assert(count() === 1, 'scope control duplicated after update')
        const host = row.querySelector<HTMLElement>(
          '[data-chatgpt-booster="archive-scope-control"]',
        )
        const button = host?.shadowRoot?.querySelector<HTMLButtonElement>('button')
        assert(button, 'scope control button missing')
        const before = location.href
        button.click()
        assert(opened === 1, 'scope control action did not fire once')
        assert(location.href === before, 'scope control click navigated the host')
        controls.stop()
        assert(count() === 0, 'scope control was not removed on stop')
      } finally {
        nav.remove()
        history.replaceState(null, '', href)
      }
    },
  )

  await check(
    'conversation decorators attach to native action rows, react to append changes and clean up',
    async () => {
      const href = location.href
      const id = prefix + 'decorators'
      const main = document.createElement('main')
      const module = new ConversationDecoratorsModule(settings, store)
      const turn = (messageId: string, role: 'user' | 'assistant') => {
        const section = document.createElement('section')
        section.dataset.testid = 'conversation-turn-' + messageId
        const body = document.createElement('div')
        body.dataset.messageId = messageId
        body.dataset.messageAuthorRole = role
        body.textContent = role === 'user' ? 'Fixture user' : 'Fixture assistant'
        const actions = document.createElement('div')
        const copy = document.createElement('button')
        copy.dataset.testid = 'copy-turn-action-button'
        copy.setAttribute('aria-label', role === 'user' ? 'Copy message' : 'Copy answer')
        actions.append(copy)
        section.append(body, actions)
        return { section, body, actions }
      }
      try {
        history.replaceState(null, '', '/c/' + id)
        const first = turn('decorator-user', 'user')
        main.append(first.section)
        document.body.append(main)
        await store.ingest(
          page(id, [
            {
              ...raw('decorator-user', 'user', 'Fixture user'),
              create_time: 1700000100,
            },
          ]),
        )
        await module.start()
        await until(
          async () =>
            first.actions.querySelector('[data-chatgpt-booster="message-metadata"]') !== null,
        )
        assert(
          first.actions.querySelectorAll('[data-chatgpt-booster="message-metadata"]').length === 1,
          'initial message decorator duplicated',
        )

        const second = turn('decorator-answer', 'assistant')
        await store.ingest(
          page(id, [
            {
              ...raw('decorator-answer', 'assistant', 'Fixture assistant', 'decorator-user'),
              create_time: 1700000101,
              metadata: {
                parent_id: 'decorator-user',
                model_slug: 'gpt-5.6-sol',
                reasoning_effort: 'high',
              },
            },
          ]),
        )
        main.append(second.section)
        await until(
          async () =>
            second.actions.querySelector('[data-chatgpt-booster="message-metadata"]') !== null,
        )
        const host = second.actions.querySelector<HTMLElement>(
          '[data-chatgpt-booster="message-metadata"]',
        )
        assert(host?.shadowRoot, 'assistant metadata shadow root missing')
        assert(
          host.shadowRoot.querySelectorAll('.booster-meta-trigger').length === 2,
          'assistant did not receive time and model metadata triggers',
        )

        second.body.append(document.createElement('span'))
        await new Promise((resolve) => setTimeout(resolve, 220))
        assert(
          second.actions.querySelectorAll('[data-chatgpt-booster="message-metadata"]').length === 1,
          'message mutation duplicated decorator',
        )

        module.stop()
        assert(
          main.querySelectorAll('[data-chatgpt-booster="message-metadata"]').length === 0,
          'message decorators were not removed on stop',
        )
      } finally {
        module.stop()
        main.remove()
        history.replaceState(null, '', href)
      }
    },
  )

  await check(
    'late Booster start recovers current chat into transient cache without pretending it is persisted',
    async () => {
      const href = location.href
      const id = prefix + 'late-bootstrap'
      const main = document.createElement('main')
      const displacedMains = [...document.querySelectorAll('main')].map((element) => {
        const placeholder = document.createComment('late-bootstrap-main')
        element.replaceWith(placeholder)
        return { element, placeholder }
      })
      const module = new ConversationDecoratorsModule(settings, store)
      const transientCapture = new ConversationArchiveModule(store, settings)
      const transientAdapter = createArchiveUiAdapter(store, transientCapture)
      const turn = (messageId: string, role: 'user' | 'assistant', text: string) => {
        const section = document.createElement('section')
        section.dataset.testid = 'conversation-turn-' + messageId
        const body = document.createElement('div')
        body.dataset.messageId = messageId
        body.dataset.messageAuthorRole = role
        body.textContent = text
        const actions = document.createElement('div')
        const copy = document.createElement('button')
        copy.dataset.testid = 'copy-turn-action-button'
        copy.setAttribute('aria-label', role === 'user' ? 'Copy message' : 'Copy answer')
        actions.append(copy)
        section.append(body, actions)
        return section
      }
      try {
        history.replaceState(null, '', '/c/' + id)
        main.append(
          turn('late-user', 'user', 'Already rendered before Booster'),
          turn('late-answer', 'assistant', 'Already rendered answer'),
        )
        document.body.append(main)

        assert(
          !(await store.getConversation(id)),
          'late-start fixture unexpectedly persisted already',
        )
        await module.start()
        await until(async () => {
          const ids = new Set(
            store.getDomSnapshot(id)?.records.map((record) => record.messageId) ?? [],
          )
          return ids.has('late-user') && ids.has('late-answer')
        })

        assert(
          (await store.listMessages(id)).length === 0,
          'DOM fallback leaked into persistent archive messages',
        )
        assert(
          (await transientAdapter.listConversations()).some(
            (conversation) => conversation.conversationId === id,
          ),
          'DOM fallback did not surface current conversation in archive cache',
        )
        assert(
          (await transientAdapter.getThread(id)).messageCount === 2,
          'DOM fallback did not surface visible messages in current thread',
        )
        assert(
          (await transientAdapter.getCoverage(id))?.completeAtLastRead === false,
          'DOM fallback incorrectly claimed complete history',
        )

        const server = page(id, [
          { ...raw('late-user', 'user', 'Server user'), create_time: 1700000200 },
          {
            ...raw('late-answer', 'assistant', 'Server answer', 'late-user'),
            create_time: 1700000201,
          },
        ])
        await store.ingestPreload(server)
        await until(async () => store.getDomSnapshot(id) === undefined)
        assert(
          (await transientAdapter.getThread(id)).messageCount === 2,
          'server preload did not replace DOM fallback cleanly',
        )
      } finally {
        module.stop()
        main.remove()
        for (const { element, placeholder } of displacedMains) placeholder.replaceWith(element)
        history.replaceState(null, '', href)
      }
    },
  )

  await check('full-export capture evidence detects filtered and lossless reads', async () => {
    const id = `${prefix}capture-evidence`
    const legacy = page(id, [raw('u-legacy', 'user', 'Legacy')])
    legacy.readId = `${id}-legacy`
    await store.ingest(legacy)
    const legacyEvidence = await store.getCaptureEvidence(id, legacy.readId)
    assert(legacyEvidence.verified === false, 'legacy page without capture metadata was trusted')
    assert(legacyEvidence.omittedRecordCount === null, 'legacy omission evidence should be unknown')

    const filtered = page(id, [raw('u-filtered', 'user', 'Visible')])
    filtered.readId = `${id}-filtered`
    ;(filtered.payload as Record<string, unknown>).booster_capture = {
      reasoning: false,
      tools: false,
      internal: false,
      omittedRecords: 3,
    }
    await store.ingest(filtered)
    const filteredEvidence = await store.getCaptureEvidence(id, filtered.readId)
    assert(filteredEvidence.verified === false, 'filtered read was marked capture-complete')
    assert(filteredEvidence.omittedRecordCount === 3, 'filtered omission count was lost')

    const full = page(id, [raw('u-full', 'user', 'Visible again')])
    full.readId = `${id}-full`
    ;(full.payload as Record<string, unknown>).booster_capture = {
      reasoning: true,
      tools: true,
      internal: true,
      omittedRecords: 0,
    }
    await store.ingest(full)
    const fullEvidence = await store.getCaptureEvidence(id, full.readId)
    assert(fullEvidence.verified === true, 'lossless read was not capture-verified')
    assert(fullEvidence.omittedRecordCount === 0, 'lossless omission count incorrect')
  })

  await check('manual collection starts in-place without reloading the tab', async () => {
    const previous = await settings.get()
    const href = location.href
    const id = `${prefix}manual-no-reload`
    const capture = new ConversationArchiveModule(store, settings)
    let starts = 0
    const onStart = () => starts++
    try {
      history.replaceState(null, '', `/c/${id}`)
      await settings.update({ enabled: true })
      await capture.start()
      window.addEventListener(HISTORY_LOADER_START_EVENT, onStart)
      const timeOrigin = performance.timeOrigin
      await capture.collectCurrent()
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert(performance.timeOrigin === timeOrigin, 'manual collection reloaded the document')
      assert(starts === 1, 'history loader was not started directly')
      assert(collectionTicket()?.conversationId === id, 'manual ticket was not scoped to this chat')
      capture.finishCollection()
    } finally {
      window.removeEventListener(HISTORY_LOADER_START_EVENT, onStart)
      capture.stop()
      sessionStorage.removeItem('chatgpt-booster:manual-collection')
      history.replaceState(null, '', href)
      await settings.set(previous)
    }
  })
  await check(
    'preload caches the current chat while autosave is off and manual collection promotes it',
    async () => {
      const previous = await settings.get()
      const href = location.href
      const id = `${prefix}preload`
      const capture = new ConversationArchiveModule(store, settings)
      const preload = page(
        id,
        [
          raw('preload-user', 'user', 'Preloaded question'),
          raw('preload-answer', 'assistant', 'Preloaded answer', 'preload-user'),
        ],
        {
          title: 'Preload fixture',
          page_info: {
            start_cursor: 'preload-start',
            end_cursor: 'preload-end',
            has_previous_page: true,
            has_next_page: false,
          },
        },
      )
      try {
        history.replaceState(null, '', `/c/${id}`)
        await settings.update({
          enabled: true,
          archive: { defaultRule: { ...DEFAULT_CAPTURE_RULE, enabled: false } },
        })
        await store.ingestPreload({
          ...preload,
          readId: 'fixture-read-old',
          readStartedAt: preload.readStartedAt - 5000,
          timestamp: preload.timestamp - 5000,
          payload: {
            ...preload.payload,
            messages: [raw('stale-preload', 'user', 'Old preload must not leak')],
          },
        })
        await store.ingestPreload(preload)
        assert(
          !(await store.getConversation(id)),
          'preload incorrectly became a persistent archive',
        )
        const initialSnapshot = await store.getPreloadSnapshot(id)
        assert(
          initialSnapshot?.coverage.visibleMessageCount === 2,
          'initial preload message count is wrong',
        )
        await store.ingestPreload({
          ...preload,
          isInitial: false,
          requestedBefore: 'preload-start',
          timestamp: preload.timestamp + 100,
          payload: {
            ...preload.payload,
            messages: [
              raw('preload-older-user', 'user', 'Older question'),
              raw('preload-older-answer', 'assistant', 'Older answer', 'preload-older-user'),
            ],
            page_info: {
              start_cursor: 'preload-oldest',
              end_cursor: 'preload-before',
              has_previous_page: false,
              has_next_page: true,
            },
          },
        })
        const snapshot = await store.getPreloadSnapshot(id)
        assert(
          snapshot?.coverage.visibleMessageCount === 4,
          'preload did not grow after continuation',
        )
        assert(
          !snapshot?.records.some((record) => record.messageId === 'stale-preload'),
          'older preload read contaminated the current snapshot',
        )
        const ui = createArchiveUiAdapter(store, capture)
        assert(
          (await ui.getCoverage(id))?.visibleMessageCount === 4,
          'UI does not expose growing preload count',
        )
        await capture.start()
        await capture.collectCurrent()
        assert(
          (await store.getConversation(id))?.conversationId === id,
          'manual collection did not promote preload',
        )
        assert((await store.listMessages(id)).length === 4, 'promoted preload records are missing')
        capture.finishCollection()
      } finally {
        capture.stop()
        sessionStorage.removeItem('chatgpt-booster:manual-collection')
        history.replaceState(null, '', href)
        await settings.set(previous)
      }
    },
  )
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
    if (i === 0) {
      messages.push({
        ...raw(
          'reasoning-0',
          'assistant',
          '### План\n\n**Проверить** данные и затем сравнить результат.',
          u,
        ),
        channel: 'analysis',
        content: {
          content_type: 'thoughts',
          thoughts: ['### План\n\n**Проверить** данные и затем сравнить результат.'],
        },
        create_time: 1700000000.05,
      })
      messages.push({
        ...raw(
          'tool-call-0',
          'assistant',
          'await tools.mcp__Koba_GitHub__github_agent_get_file({ repository: "fixture/repo" })',
          u,
        ),
        channel: 'analysis',
        recipient: 'functions.exec',
        content: {
          content_type: 'text',
          parts: [
            'await tools.mcp__Koba_GitHub__github_agent_get_file({ repository: "fixture/repo" })',
          ],
        },
        metadata: {
          parent_id: u,
          reasoning_effort: 'high',
          model_slug: 'gpt-5.6-sol',
          tool_url: 'https://github.com/KobaProduction/chatgpt-booster',
          tool_icons: [
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"%3E%3Crect width="8" height="8" rx="2" fill="%23000"/%3E%3C/svg%3E',
          ],
        },
        create_time: 1700000000.1,
      })
    }
    messages.push({
      ...raw(`tool-${i}`, 'tool', `Результат инструмента ${i + 1}`, u),
      create_time: 1700000000 + i * 2 + 0.2,
      author: { role: 'tool', name: 'fixture.lookup' },
    })
    messages.push({
      ...raw(
        `answer-${i}`,
        'assistant',
        i === 0
          ? '## Ответ 1\n\nЭто **Markdown** с `code`.\n\n- первый пункт\n- второй пункт'
          : `Ответ ${i + 1}: только тестовые данные.`,
        u,
      ),
      create_time: 1700000000 + i * 2 + 1,
      ...(i === 0
        ? {
            update_time: 1700000004,
            metadata: {
              parent_id: u,
              model_slug: 'gpt-5.6-sol',
              resolved_model_slug: 'gpt-5.6-sol',
              reasoning_effort: 'high',
              edited: true,
            },
          }
        : {}),
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
async function runPerformanceTests() {
  const results: Array<Record<string, unknown> & { name: string; pass: boolean }> = []

  {
    const id = `perf-read-model-${Date.now()}`
    await store.ingest(
      page(id, [
        raw('perf-user', 'user', 'Question'),
        raw('perf-answer', 'assistant', 'Answer', 'perf-user'),
      ]),
    )
    const originalListMessages = store.listMessages.bind(store)
    const originalGetPreloadSnapshot = store.getPreloadSnapshot.bind(store)
    const originalGetCoverage = store.getCoverage.bind(store)
    let listMessagesCalls = 0
    let preloadCalls = 0
    let coverageCalls = 0
    store.listMessages = async (conversationId) => {
      listMessagesCalls += 1
      return await originalListMessages(conversationId)
    }
    store.getPreloadSnapshot = async (conversationId) => {
      preloadCalls += 1
      return await originalGetPreloadSnapshot(conversationId)
    }
    store.getCoverage = async (conversationId) => {
      coverageCalls += 1
      return await originalGetCoverage(conversationId)
    }
    try {
      const ui = createArchiveUiAdapter(store, new ConversationArchiveModule(store, settings))
      const started = performance.now()
      await Promise.all([ui.getThread(id), ui.getCoverage(id)])
      const elapsedMs = performance.now() - started
      const pass = listMessagesCalls === 1 && preloadCalls === 1 && coverageCalls === 1
      results.push({
        name: 'coalesce concurrent archive read model',
        pass,
        elapsedMs,
        listMessagesCalls,
        preloadCalls,
        coverageCalls,
      })
    } finally {
      store.listMessages = originalListMessages
      store.getPreloadSnapshot = originalGetPreloadSnapshot
      store.getCoverage = originalGetCoverage
    }
  }

  {
    const href = location.href
    const id = `perf-current-${Date.now()}`
    const project = `g-p-${'b'.repeat(32)}`
    await store.ingest(
      page(id, [raw('perf-current-user', 'user', 'Question')], { gizmo_id: project }),
    )
    await store.upsertProject(project, 'Performance Project')
    const originalGetConversation = store.getConversation.bind(store)
    const originalGetProject = store.getProject.bind(store)
    const originalListProjects = store.listProjects.bind(store)
    let conversationReads = 0
    let projectReads = 0
    let projectListReads = 0
    store.getConversation = async (conversationId) => {
      conversationReads += 1
      return await originalGetConversation(conversationId)
    }
    store.getProject = async (projectId) => {
      projectReads += 1
      return await originalGetProject(projectId)
    }
    store.listProjects = async () => {
      projectListReads += 1
      return await originalListProjects()
    }
    try {
      history.replaceState(null, '', `/g/${project}/c/${id}`)
      const ui = createArchiveUiAdapter(store, new ConversationArchiveModule(store, settings))
      const started = performance.now()
      await Promise.all([ui.getCurrentContext(), ui.getConversation(id)])
      const elapsedMs = performance.now() - started
      results.push({
        name: 'coalesce current context conversation and use keyed project read',
        pass: conversationReads === 1 && projectReads === 1 && projectListReads === 0,
        elapsedMs,
        conversationReads,
        projectReads,
        projectListReads,
      })
    } finally {
      history.replaceState(null, '', href)
      store.getConversation = originalGetConversation
      store.getProject = originalGetProject
      store.listProjects = originalListProjects
    }
  }

  {
    const id = `perf-preload-${Date.now()}`
    const preload = page(id, [raw('perf-preload-user', 'user', 'Preloaded question')], {
      title: 'Performance preload',
      page_info: {
        start_cursor: 'perf-start',
        end_cursor: 'perf-end',
        has_previous_page: false,
        has_next_page: false,
      },
    })
    const originalGetAll = IDBObjectStore.prototype.getAll
    let preloadGetAllCalls = 0
    IDBObjectStore.prototype.getAll = function (
      query?: IDBValidKey | IDBKeyRange | null,
      count?: number,
    ) {
      if (this.name === 'preloadPages') preloadGetAllCalls += 1
      return originalGetAll.call(this, query, count)
    }
    try {
      const started = performance.now()
      await store.ingestPreload(preload)
      const elapsedMs = performance.now() - started
      results.push({
        name: 'preload ingest avoids full-store getAll materialization',
        pass: preloadGetAllCalls === 0,
        elapsedMs,
        preloadGetAllCalls,
      })
    } finally {
      IDBObjectStore.prototype.getAll = originalGetAll
    }
  }

  {
    const id = `perf-scope-${Date.now()}`
    const nav = document.createElement('nav')
    const row = document.createElement('li')
    const link = document.createElement('a')
    link.href = `/c/${id}`
    link.textContent = 'Performance scope chat'
    row.append(link)
    nav.append(row)
    document.body.append(nav)

    let updates = 0
    const main = document.querySelector('main')
    const streamingNode = document.createElement('span')
    const controls = mountArchiveScopeControls({
      visible: () => true,
      mount: () => ({
        update() {
          updates += 1
        },
        unmount() {},
      }),
    })
    try {
      const beforeStreaming = updates
      main?.append(streamingNode)
      await new Promise((resolve) => setTimeout(resolve, 260))
      const afterStreaming = updates

      link.href = `/c/${id}-changed`
      await new Promise((resolve) => setTimeout(resolve, 320))
      const afterSidebar = updates

      results.push({
        name: 'scope controls ignore unrelated conversation mutations',
        pass: afterStreaming === beforeStreaming && afterSidebar > afterStreaming,
        beforeStreaming,
        afterStreaming,
        afterSidebar,
      })
    } finally {
      controls.stop()
      streamingNode.remove()
      nav.remove()
    }
  }

  return results
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
  listExportFormats: () => [
    {
      id: 'json',
      label: 'JSON',
      mimeType: 'application/json',
      fileExtension: 'json',
      isDefault: true,
    },
    {
      id: 'markdown',
      label: 'Markdown',
      mimeType: 'text/markdown',
      fileExtension: 'md',
      isDefault: false,
    },
  ],
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
      extension: result.extension,
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
    runPerformanceTests,
    settings,
    context,
    exports,
    store,
    HistoryLoaderModule,
    ConversationArchiveModule,
    ConversationDecoratorsModule,
  },
})
const status = document.querySelector('#fixture-status')
if (status) status.textContent = 'Fixture ready. Use the edge toolkit.'
