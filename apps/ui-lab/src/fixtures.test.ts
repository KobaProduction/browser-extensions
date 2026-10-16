import { expect, test } from 'bun:test'
import {
  createMockChatGptArchive,
  createMockSettingsAdapter,
  createMockVkArchive,
  fixtureSize,
} from './fixtures'

test('ChatGPT fake archive distinguishes empty, populated and large fixtures', async () => {
  expect(fixtureSize('empty')).toBe(0)
  expect(fixtureSize('saved')).toBe(32)
  expect(fixtureSize('long')).toBe(3000)
  const saved = createMockChatGptArchive('saved')
  expect(saved.fixedArchive.savedCurrentSummary).toBeDefined()
  expect(await saved.fixedArchive.savedCurrent()).toBe(32)
  expect((await saved.adapter.getCoverage('demo-dialog'))?.visibleMessageCount).toBe(32)
  await expect(createMockChatGptArchive('error').adapter.getCurrentContext()).rejects.toThrow('DEMO')
})

test('fake preferences update only memory and do not enter browser storage', async () => {
  const settings = createMockSettingsAdapter()
  const initial = await settings.get()
  await settings.update({ language: 'en' })
  expect((await settings.get()).language).toBe('en')
  expect(initial.language).not.toBe('en')
})

test('ChatGPT timeline, bounded Reader and saved variants share opaque record identities', async () => {
  const { adapter } = createMockChatGptArchive('saved')
  const timeline = await adapter.getTimeline?.('demo-dialog')
  const window = await adapter.getThreadWindow?.('demo-dialog', null, 'first')
  expect(timeline?.length).toBe(32)
  expect(window).toBeDefined()
  const keys = new Map(timeline?.map((point) => [point.id, point.key]))
  for (const turn of window?.thread.turns ?? []) {
    for (const item of [...turn.messages, ...turn.details]) {
      expect(item.record.messageKey).toBe(keys.get(item.record.messageId))
    }
  }
  const versions = await adapter.getMessageVersions?.('demo-dialog', 'demo-msg-8')
  expect(versions?.length).toBe(2)
  for (const version of versions ?? []) {
    for (const turn of version.thread.turns) {
      for (const item of [...turn.messages, ...turn.details])
        expect(item.record.messageKey).toBe(keys.get('demo-msg-8'))
    }
  }
})

test('VK fixture has deterministic records and its capture never touches a live provider', async () => {
  const { api, dispose } = createMockVkArchive('saved', 'tampermonkey')
  try {
    expect(api.status().messages).toBe(32)
    expect((await api.readFixed(10)).length).toBe(10)
    expect(await api.countFixed()).toBe(32)
    expect(await api.coverageFixed?.()).toMatchObject({
      verification: 'unknown',
      reportedCount: null,
      first: { id: 1001 },
      last: { id: 1032 },
      integrity: { chain: 'unknown' },
    })
    expect((await api.timelineFixed?.())?.length).toBe(32)
    expect((await api.rangeFixed?.(1025, 1005))?.messageIds).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 1005),
    )
    expect((await api.resolveParticipants([33, 44])).map((p) => p.name)).toEqual([
      'Анна Смирнова',
      'Алексей Иванов',
    ])
    expect((await api.exportUserZip({ chunkRows: 100, includeReferences: true })).type).toBe(
      'application/zip',
    )
    const readable = await api.exportUserConversation({
      chunkRows: 100,
      includeReferences: true,
      format: 'markdown',
      packaging: 'none',
    })
    expect(readable).toMatchObject({ extension: 'md', recordCount: 32, attachmentFilesIncluded: 0 })
    expect(await readable.blob.text()).toContain('https://example.invalid/demo-photo.png')
    await expect(api.downloadAttachmentFixed(1002, '1002:root:0:photo')).rejects.toThrow(
      'Synthetic attachment bytes unavailable',
    )
    expect(await api.captureFixed(10)).toMatchObject({
      saved: 8,
      alreadySaved: 2,
      available: 32,
      complete: false,
      attachmentReferences: 0,
    })
    expect(api.status().progress.phase).toBe('Dexie: частично')
    expect((await api.coverageFixed?.())?.integrity.chain).toBe('unknown')
    expect(await api.captureFixed('all')).toMatchObject({
      saved: 8,
      alreadySaved: 24,
      available: 32,
      complete: true,
      attachmentReferences: 0,
    })
    expect(api.status().progress.phase).toBe('Dexie: сохранено')
    expect(await api.coverageFixed?.()).toMatchObject({
      verification: 'session-scan',
      reportedCount: 32,
      integrity: {
        start: 'verified',
        end: 'verified',
        chain: 'verified',
        firstMessageId: '1001',
        lastMessageId: '1032',
      },
    })
    await expect(api.restorePortable(new Blob(), { settings: true, indexeddb: true })).rejects.toThrow(
      'disabled',
    )
  } finally {
    dispose()
  }
})
