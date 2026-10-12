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

test('VK fixture has deterministic records and its capture never touches a live provider', async () => {
  const { api, dispose } = createMockVkArchive('saved', 'tampermonkey')
  try {
    expect(api.status().messages).toBe(32)
    expect((await api.readFixed(10)).length).toBe(10)
    expect(await api.countFixed()).toBe(32)
    expect((await api.resolveParticipants([33, 44])).map((p) => p.name)).toEqual([
      'Анна Смирнова',
      'Алексей Иванов',
    ])
    expect((await api.exportUserZip({ chunkRows: 100, includeReferences: true })).type).toBe(
      'application/zip',
    )
    expect(await api.captureFixed(10)).toMatchObject({
      saved: 8,
      alreadySaved: 2,
      available: 32,
      complete: false,
      attachmentReferences: 0,
    })
    expect(api.status().progress.phase).toBe('Dexie: частично')
    expect(await api.captureFixed('all')).toMatchObject({
      saved: 8,
      alreadySaved: 24,
      available: 32,
      complete: true,
      attachmentReferences: 0,
    })
    expect(api.status().progress.phase).toBe('Dexie: сохранено')
    await expect(api.restorePortable(new Blob(), { settings: true, indexeddb: true })).rejects.toThrow(
      'disabled',
    )
  } finally {
    dispose()
  }
})
