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
  expect(text).toContain('api.readFixed(')
  expect(text).toContain('api.exportFixed(')
  expect(text).not.toContain('<ArchiveManager')
  expect(text).toContain('Параметры сохранения')
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
})
