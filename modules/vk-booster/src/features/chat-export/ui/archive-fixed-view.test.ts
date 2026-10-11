import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'

test('new VK capture/read/export uses the one panel without replacing v2 folder actions', () => {
  const text = readFileSync(new URL('./ArchivePanel.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(text, { filename: 'ArchivePanel.vue' })
  expect(errors).toHaveLength(0)
  const result = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename: 'ArchivePanel.vue',
    id: 'vk-fixed-dexie',
  })
  expect(result.errors).toHaveLength(0)
  expect(text).toContain('api.captureFixed(')
  expect(text).toContain('api.readFixed(')
  expect(text).toContain('api.exportFixed(')
  expect(text).toContain('ArchiveManager')
  expect(text).toContain('v-if="api && status"')
})
