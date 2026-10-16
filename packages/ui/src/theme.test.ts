import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

test('shell imports the shared semantic theme with ShadowRoot utility defaults', async () => {
  const css = await readFile(new URL('../../shell/src/styles.css', import.meta.url), 'utf8')
  const theme = await readFile(new URL('./theme.css', import.meta.url), 'utf8')
  expect(css).toContain('ui/src/theme.css')
  expect(theme).toContain('--primary: oklch(')
  expect(theme).toContain('--tw-border-style: solid')
  expect(theme).toContain('--tw-translate-y: 0')
  expect(css).toContain('.booster-launcher')
  expect(css).toContain('.booster-modal-backdrop')
  expect(css).toContain('.settings-catalog')
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
  expect(vk).toContain('<ConversationCollectionAction')
  const collection = await readFile(
    new URL('../../widgets/src/ConversationCollectionAction.vue', import.meta.url),
    'utf8',
  )
  expect(collection).toContain('<ArchiveProgressBar')
  expect(vk).not.toContain('<ArchiveManager')
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
  expect(shared).toContain('<Progress')
  expect(shared).not.toContain('<progress')
})
