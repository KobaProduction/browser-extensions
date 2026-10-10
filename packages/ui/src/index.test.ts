import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const source = async (p: string) => readFile(new URL(p, import.meta.url), 'utf8')
test('shared shadcn-vue button is sourced from Booster patterns', async () => {
  const s = await source('./components/ui/button/Button.vue')
  expect(s).toContain('focus-visible:ring-2')
  expect(s).toContain("variant === 'default'")
  expect(s).toContain('disabled:opacity-50')
})
test('shared badge is a neutral primitive with no provider knowledge', async () => {
  const s = await source('./components/ui/badge/Badge.vue')
  expect(s).toContain('defineProps')
  expect(s).not.toContain('vk.ru')
  expect(s).not.toContain('chatgpt.com')
})
