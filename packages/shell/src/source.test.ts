import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const read = async (name: string) => readFile(new URL(name, import.meta.url), 'utf8')
test('shared launcher uses the ChatGPT Booster draggable overlay contract', async () => {
  const source = await read('./Overlay.vue')
  expect(source).toContain('onPointerDown')
  expect(source).toContain('onPointerMove')
  expect(source).toContain('savePosition')
  expect(source).toContain('ModalSurface')
  expect(source).toContain('booster-modal-surface booster-modal-surface-wide')
  const modal = await read('../../ui/src/components/booster/ModalSurface.vue')
  expect(modal).toContain('booster-modal-backdrop')
  expect(modal).toContain('aria-modal="true"')
  expect(source).toContain('ControlCenterPanel')
})
test('draggable launcher supports keyboard activation without double-toggling pointer clicks', async () => {
  const source = await read('./Overlay.vue')
  expect(source).toContain('@click="onLauncherClick"')
  expect(source).toContain('event.detail === 0')
  expect(source).toContain('@pointerup="onPointerUp"')
  expect(source).toContain(':aria-expanded="open"')
  expect(source).toContain('aria-haspopup="dialog"')
})

test('central shell allows supplied feature views without provider-specific imports', async () => {
  const source = await read('./ControlCenterPanel.vue')
  expect(source).toMatch(/views:\s*Record<string,\s*Component>/)
  expect(source).toContain('booster-settings-nav')
  expect(source).not.toContain('VKArchive')
  expect(source).not.toContain('chatgpt.com')
})

test('shared shell supports a provider-neutral wide archive panel and explicit close', async () => {
  const source = await read('./Overlay.vue')
  expect(source).toContain("feature.presentation?.panel === 'wide'")
  expect(source).toContain('SHELL_CLOSE_EVENT')
  expect(source).toContain('booster-modal-surface-wide')
  expect(source).not.toContain('chatgpt-booster')
})

test('shared shell tracks navigation state for wide vs standard module presentation', async () => {
  const modal = await read('./Overlay.vue')
  const panel = await read('./ControlCenterPanel.vue')
  expect(modal).toContain('@select="selectedSection = $event"')
  expect(panel).toContain("emit('select', id)")
  expect(panel).toContain('@click="selectSection(feature.id)"')
})
