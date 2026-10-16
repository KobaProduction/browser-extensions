import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { buttonVariants } from './components/ui/button'

const source = async (p: string) => readFile(new URL(p, import.meta.url), 'utf8')
test('shared registry button delegates semantics and variants to Reka', async () => {
  const s = await source('./components/ui/button/Button.vue')
  expect(s).toContain('Primitive')
  expect(s).toContain('buttonVariants')
  expect(buttonVariants({ variant: 'default' })).toContain('bg-primary')
  expect(buttonVariants({ variant: 'outline' })).toContain('border-input')
  expect(buttonVariants()).toContain('disabled:pointer-events-none')
  expect(buttonVariants()).toContain('focus-visible:ring-ring')
})
test('shared badge is a neutral primitive with no provider knowledge', async () => {
  const s = await source('./components/ui/badge/Badge.vue')
  expect(s).toContain('defineProps')
  expect(s).not.toContain('vk.ru')
  expect(s).not.toContain('chatgpt.com')
})
