import { expect, test } from 'bun:test'
import { decodeArchiveClone } from '@kobaproduction/browser-archive'
import { DEFAULT_CAPTURE_RULE, normalizeSettings, type SettingsAdapter } from '@chatgpt-booster/core'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedChatGptCapture } from './archive-fixed-runtime'
import type { ConversationStateStore } from './conversation-state'

test('native page -> consented fixed Dexie v1 -> saved Reader -> explicit gzip, no legacy migration', async () => {
  const previousLocation = globalThis.location
  Object.assign(globalThis, { location: new URL('https://chatgpt.com/c/fixed-chat-1') })
  let listener: ((detail: ConversationArchiveEventDetail) => void) | undefined
  let account = 'synthetic-owner'
  let epoch = 0
  const state = {
    verifiedAccountId: () => account,
    listSnapshots: () => [],
    accountEpoch: () => epoch,
    header: (id: string) => id === 'fixed-chat-1'
      ? { conversationId: id, projectId: null, title: 'Synthetic chat' }
      : undefined,
    subscribePages(callback: typeof listener) {
      listener = callback
      return () => { listener = undefined }
    },
  } as unknown as ConversationStateStore
  let consent = false
  const settings = {
    get: async () => normalizeSettings({
      enabled: true,
      archive: { defaultRule: { ...DEFAULT_CAPTURE_RULE, enabled: consent },
        projects: {}, conversations: {} },
    }),
  } as unknown as SettingsAdapter
  const service = new FixedChatGptCapture(
    state, settings, 'Tampermonkey', undefined, { indexedDB, IDBKeyRange },
  )
  const message = {
    id: 'msg-1',
    author: { role: 'assistant' },
    channel: 'final',
    content: { content_type: 'multimodal_text', parts: ['Synthetic fixed source'] },
    extraFutureField: { leftOpaque: true },
  }
  const page: ConversationArchiveEventDetail = {
    kind: 'conversation-page', accountId: account,
    conversationId: 'fixed-chat-1', timestamp: 1790000000000,
    sourceUrl: 'https://chatgpt.com/backend-api/conversation/fixed-chat-1',
    payload: { conversation_id: 'fixed-chat-1', messages: [message] },
  }
  try {
    service.start()
    listener?.(page)
    expect(await service.savedCurrent()).toBe(0)
    consent = true
    listener?.(page)
    expect(await service.savedCurrent()).toBe(1)
    const preview = await service.listCurrent()
    expect(preview).toEqual([{ id: 'msg-1', text: 'Synthetic fixed source', coverage: 'typed' }])
    listener?.(page)
    expect(await service.savedCurrent()).toBe(1)
    // Changed source must not silently overwrite immutable original snapshots.
    listener?.({ ...page, payload: { ...page.payload, messages: [
      { ...message, content: { content_type: 'multimodal_text', parts: ['Edited source'] } },
    ] } })
    expect(await service.savedCurrent()).toBe(1)
    expect(service.captureFailed()).toBe(true)
    const exportBlob = await service.exportCurrent()
    const data = await new Response(exportBlob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    const rows = data.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(rows[0]).toMatchObject({
      kind: 'header', schema: 'koba-fixed-chatgpt-v1', completeness: 'unknown',
    })
    expect(rows[1]).toMatchObject({ kind: 'message' })
    expect(decodeArchiveClone((rows[1]?.snapshot as { raw: unknown }).raw)).toEqual(message)
    expect(rows.at(-1)).toMatchObject({ kind: 'footer', count: 1 })
    account = 'another-owner'
    epoch++
    await expect(service.listCurrent()).resolves.toHaveLength(0)
    listener?.({ ...page, accountId: 'synthetic-owner' })
    expect(await service.savedCurrent()).toBe(0)
  } finally {
    await service.stop()
    Object.assign(globalThis, { location: previousLocation })
  }
})
