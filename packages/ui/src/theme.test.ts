import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

test('single shell style follows ChatGPT Booster semantic tokens rather than custom blue palette', async () => {
  const css = await readFile(new URL('../../shell/src/styles.css', import.meta.url), 'utf8')
  expect(css).toContain('--primary: oklch(')
  expect(css).toContain('.booster-launcher')
  expect(css).toContain('.booster-modal-backdrop')
  expect(css).toContain('.booster-settings-nav')
  expect(css).not.toContain('#315aa7')
})

test('archive progress is a single host-neutral widget reused by VK and ChatGPT', async () => {
  const shared = await readFile(
    new URL('./components/archive/ArchiveProgress.vue', import.meta.url),
    'utf8',
  )
  const vk = await readFile(
    new URL('../../../modules/vk-booster/src/features/chat-export/ui/ArchivePanel.vue', import.meta.url),
    'utf8',
  )
  const chatgpt = await readFile(
    new URL('../../../modules/chatgpt-booster/packages/ui/src/ArchiveExportDialog.vue', import.meta.url),
    'utf8',
  )
  expect(shared).toContain('aria-live="polite"')
  expect(shared).not.toContain('vk-booster')
  expect(shared).not.toContain('chatgpt-booster')
  expect(vk).toContain('<ArchiveManager')
  expect(chatgpt).toContain('<ArchiveProgress')
})

test('VK and ChatGPT use the same provider-neutral progress presentation', async () => {
  const { readFile } = await import('node:fs/promises')
  const vk = await readFile(new URL('../../widgets/src/ArchiveProgressBar.vue', import.meta.url), 'utf8')
  const shared = await readFile(
    new URL('./components/archive/ArchiveProgress.vue', import.meta.url),
    'utf8',
  )
  expect(vk).toContain('ArchiveProgress')
  expect(vk).not.toContain('<progress')
  expect(shared).toContain('compact')
  expect(shared).toContain('<progress')
})
