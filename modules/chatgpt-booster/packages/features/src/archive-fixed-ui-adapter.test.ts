import { expect, test } from 'bun:test'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { DEFAULT_CAPTURE_RULE, normalizeSettings, type SettingsAdapter } from '@chatgpt-booster/core'
import { ArchiveCollectionSession } from './archive-collection-session'
import { FixedChatGptCapture } from './archive-fixed-runtime'
import { createFixedArchiveUiAdapter } from './archive-fixed-ui-adapter'
import type { ConversationStateStore } from './conversation-state'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import { readFileSync } from 'node:fs'

test('active ChatGPT composition no longer constructs native v4 writer, reader or migration engine', () => {
  const source = readFileSync(new URL('./page-runtime.ts', import.meta.url), 'utf8')
  expect(source).toContain('createFixedArchiveUiAdapter')
  expect(source).toContain('FixedChatGptCapture')
  for (const old of ['new ArchiveV4Store(', 'new ArchiveV4CaptureModule(', 'new ArchiveV4Reader(',
    'createArchiveV4UiAdapter(', 'archiveWarmup', 'archiveStore.warmup()'])
    expect(source).not.toContain(old)
})

test('fixed saved Reader facade reads, windows, counts and exports without accessing an older archive', async () => {
  const previousLocation = globalThis.location
  Object.assign(globalThis, { location: new URL('https://chatgpt.com/c/fixed-reader') })
  let listener: ((page: ConversationArchiveEventDetail) => void) | undefined
  const memory = {
    verifiedAccountId: () => 'owner-fixed',
    accountEpoch: () => 1,
    header: (id: string) => ({ conversationId: id, projectId: null, title: 'Saved' }),
    listSnapshots: () => [],
    subscribePages(callback: typeof listener) {
      listener = callback
      return () => { listener = undefined }
    },
    subscribe: () => () => undefined,
  } as unknown as ConversationStateStore
  const settings = {
    get: async () => normalizeSettings({
      archive: { defaultRule: { ...DEFAULT_CAPTURE_RULE, enabled: true }, projects: {}, conversations: {} },
    }),
    subscribe: () => () => undefined,
  } as unknown as SettingsAdapter
  const service = new FixedChatGptCapture(
    memory, settings, 'Chromium', new ArchiveCollectionSession(), { indexedDB, IDBKeyRange },
  )
  try {
    service.start()
    listener?.({
      kind: 'conversation-page', accountId: 'owner-fixed',
      conversationId: 'fixed-reader', timestamp: 1800000000000,
      sourceUrl: 'https://chatgpt.com/backend-api/conversation/fixed-reader',
      payload: {
        conversation_id: 'fixed-reader', messages: [{
          id: 'm-1', author: { role: 'user' },
          content: { content_type: 'text', parts: ['Synthetic input'] },
        }],
      },
    })
    expect(await service.savedCurrent()).toBe(1)
    const adapter = createFixedArchiveUiAdapter(service, memory)
    expect(adapter.currentAccountId?.()).toBe('owner-fixed')
    expect((await adapter.listConversations()).map(x => x.conversationId)).toEqual(['fixed-reader'])
    expect((await adapter.getCoverage('fixed-reader'))?.knownMessageCount).toBe(1)
    const window = await adapter.getThreadWindow?.('fixed-reader')
    expect(window?.totalKnownRecordCount).toBe(1)
    expect(window?.accountId).toBe('owner-fixed')
    expect(window?.hasOlderStored).toBe(false)
    expect(window?.hasNewerStored).toBe(false)
    const packed = await adapter.exportConversation('fixed-reader', {
      format: 'fixed-json-gzip', packaging: 'gzip', level: 'conversation',
      reasoning: true, tools: true, internal: false, images: false, files: false,
    })
    expect(packed.complete).toBe(false)
    expect(packed.blob.size).toBeGreaterThan(0)
  } finally {
    await service.stop()
    Object.assign(globalThis, { location: previousLocation })
  }
})
