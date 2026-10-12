import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'

test('common collection control displays progress but delegates actual source capture', () => {
  const source = readFileSync(new URL('./ConversationCollectionAction.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  expect(errors).toHaveLength(0)
  expect(
    compileTemplate({
      source: descriptor.template?.content ?? '',
      id: 'collection',
      filename: 'ConversationCollectionAction.vue',
    }).errors,
  ).toHaveLength(0)
  expect(source).toContain("emit('start')")
  expect(source).toContain("emit('stop')")
  expect(source).toContain('ArchiveProgressBar')
  expect(source).toContain("import { Button } from '@kobaproduction/browser-ui'")
  expect(source).toContain('variant="outline"')
  expect(source).not.toMatch(/vk\.ru|chatgpt\.com|IndexedDB|Dexie/)
})
