import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { compileTemplate, parse } from 'vue/compiler-sfc'

const ui = new URL('../packages/ui/src/', import.meta.url)
const shared = new URL('../../../packages/ui/src/components/booster/', import.meta.url)

const consumers: Record<string, string[]> = {
  'ArchiveRecord.vue': ['FloatingInfoPopover', 'JsonViewer', 'ModalSurface'],
  'BoosterOverlay.vue': ['ModalSurface'],
  'ControlCenterPanel.vue': ['ModalSurface'],
  'RecordMetaBadges.vue': ['FloatingInfoPopover'],
  'ScopeArchiveControl.vue': ['FloatingInfoPopover'],
  'ToolInspector.vue': ['FloatingInfoPopover', 'JsonViewer'],
}

test('ChatGPT composes reusable modal, popover and JSON UI from the shared package', () => {
  for (const name of ['FloatingInfoPopover', 'JsonViewer', 'ModalSurface']) {
    expect(existsSync(new URL(`${name}.vue`, shared))).toBe(true)
    expect(existsSync(new URL(`${name}.vue`, ui))).toBe(false)
  }
  for (const [name, imports] of Object.entries(consumers)) {
    const source = readFileSync(new URL(name, ui), 'utf8')
    const { descriptor, errors } = parse(source, { filename: name })
    expect(errors).toHaveLength(0)
    expect(descriptor.scriptSetup?.content).toContain("from '@kobaproduction/browser-ui'")
    for (const component of imports) {
      expect(descriptor.scriptSetup?.content).toContain(component)
      expect(source).not.toContain(`from './${component}.vue'`)
      expect(descriptor.template?.content).toContain(`<${component}`)
    }
    const compiled = compileTemplate({ source: descriptor.template?.content ?? '', filename: name, id: 'shared-ui-ownership' })
    expect(compiled.errors).toHaveLength(0)
  }
})

test('shared modal preserves floating behavior and native focus management', () => {
  const modal = readFileSync(new URL('ModalSurface.vue', shared), 'utf8')
  expect(modal).toContain('floating?: boolean')
  expect(modal).toContain('surfaceStyle?: Record<string, string>')
  expect(modal).toContain('aria-modal')
  expect(modal).toContain('onBeforeUnmount')
  expect(modal).toContain('key(event: KeyboardEvent)')
})
