import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const read = async (name: string) => readFile(new URL(name, import.meta.url), 'utf8')
test('shared launcher uses the ChatGPT Booster draggable overlay contract', async () => {
  const source = await read('./Overlay.vue')
  expect(source).toContain('onPointerDown')
  expect(source).toContain('onPointerMove')
  expect(source).toContain('savePosition')
  expect(source).toContain('ModalSurface')
  expect(source).toContain('surface-class="booster-modal-surface"')
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

test('launcher matches shared ChatGPT Booster icon rather than legacy B glyph', async () => {
  const overlay = await read('./Overlay.vue')
  const style = await read('./styles.css')
  expect(overlay).toContain('<Layers3 v-else class="booster-launcher-icon"')
  expect(overlay).toContain('<X v-if="open" class="booster-launcher-icon"')
  expect(overlay).not.toContain('<span>B</span>')
  expect(style).toContain('.booster-launcher-icon')
})

test('central shell allows supplied feature views without provider-specific imports', async () => {
  const source = await read('./ControlCenterPanel.vue')
  expect(source).toMatch(/views:\s*Record<string,\s*Component>/)
  expect(source).toContain('booster-settings-nav')
  expect(source).not.toContain('VKArchive')
  expect(source).not.toContain('chatgpt.com')
})
