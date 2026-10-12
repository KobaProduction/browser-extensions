import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'

test('VK Dexie is sole UI archive source with a dedicated Reader and persisted settings', () => {
  const text = readFileSync(new URL('./ArchivePanel.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(text, { filename: 'ArchivePanel.vue' })
  expect(errors).toHaveLength(0)
  const result = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename: 'ArchivePanel.vue',
    id: 'vk-fixed-dexie',
  })
  expect(result.errors).toHaveLength(0)
  const adapter = readFileSync(new URL('../model/chat-collection-port.ts', import.meta.url), 'utf8')
  expect(adapter).toContain('api.captureFixed(')
  expect(text).toContain('collector.start()')
  // The strict durable settings validator does not accept ArchiveOptions.peerId.
  expect(text).not.toContain('...api.status().options')
  expect(text).toContain('const { mode, from, through, media } = api.status().options')
  expect(text).toContain('limit: fixedLimit.value')
  expect(text).toContain('pageSize: requestPageSize.value')
  expect(text).toContain('delay: requestDelay.value')
  expect(text).toContain('api.readFixed(')
  expect(text).toContain('api.exportUserZip(')
  expect(text).toContain('enterTab(item.id)')
  expect(text).toContain("if (view === 'reader' && !fixedPreview.value.length")
  expect(text).toContain('<ArchiveMessageHeader')
  expect(text).toContain("message.out === 1 || message.out === true ? 'justify-end' : 'justify-start'")
  expect(text).not.toContain('<ArchiveManager')
  expect(text).toContain('Параметры сохранения')
  expect(text).toContain('Сохранить параметры')
  expect(text).toContain('Пауза между страницами')
  expect(text).toContain('Следующие 80')
})

test('VK export workflow exposes complete scan, bounded page controls and truthful media stage', () => {
  const source = readFileSync(new URL('./ArchivePanel.vue', import.meta.url), 'utf8')
  expect(source).toContain("captureRange === 'all'")
  expect(source).toContain("captureRange === 'recent'")
  expect(source).toContain('Сообщений за запрос')
  expect(source).toContain('Пауза между запросами')
  expect(source).toContain('requestPageSize')
  expect(source).toContain('requestDelay')
  expect(source).toContain('1 · История переписки')
  expect(source).toContain('2 · Вложения и файлы')
  expect(source).toContain('бинарные файлы не скачаны')
  expect(source).toContain('!hasVerifiedPeer')
  expect(source).toContain('vkRequestedView.value = null')
  expect(source).toContain('document.body.append(link)')
  expect(source).toContain('link.remove()')
  expect(source).toContain('vkArchiveErrorMessage(error)')
  expect(source).toContain('Экспорт ZIP · параметры')
  expect(source).toContain('Подготовить ZIP')
  expect(source).toContain('Скачать ZIP')
  expect(source).toContain("if (requested === 'export') {")
  expect(source).toContain('showUserExportOptions()')
  expect(source).not.toContain('void exportDexie()')
  expect(source).toContain('readArchiveMedia(response')
  expect(source).toContain('Загрузить оригинал')
})
