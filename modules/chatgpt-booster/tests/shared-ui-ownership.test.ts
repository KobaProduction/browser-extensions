import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

const ui = new URL('../packages/ui/src/', import.meta.url)
const shared = new URL('../../../packages/ui/src/components/booster/', import.meta.url)

const consumers: Record<string, string[]> = {
  'ArchiveBrowser.vue': ['Button', 'Popover', 'Select', 'Collapsible'],
  'ArchiveRecord.vue': ['FloatingInfoPopover', 'JsonViewer', 'ModalSurface'],
  'BoosterOverlay.vue': ['ModalSurface'],
  'ControlCenterPanel.vue': ['ModalSurface'],
  'RecordMetaBadges.vue': ['FloatingInfoPopover'],
  'ScopeArchiveControl.vue': ['FloatingInfoPopover'],
  'ToolInspector.vue': ['FloatingInfoPopover', 'JsonViewer', 'Collapsible'],
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
    const compiled = compileTemplate({
      source: descriptor.template?.content ?? '',
      filename: name,
      id: 'shared-ui-ownership',
    })
    expect(compiled.errors).toHaveLength(0)
  }
})

test('Reader registry buttons survive TypeScript erasure as runtime components', () => {
  const filename = 'ArchiveBrowser.vue'
  const { descriptor } = parse(readFileSync(new URL(filename, ui), 'utf8'), { filename })
  const script = compileScript(descriptor, { id: 'reader-runtime-components' })
  expect(script.bindings.Button).toBe('setup-maybe-ref')
  const template = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename,
    id: 'reader-runtime-components',
    compilerOptions: { bindingMetadata: script.bindings },
  })
  expect(template.errors).toHaveLength(0)
  expect(template.code).toContain('$setup["Button"]')
  expect(template.code).not.toContain('_resolveComponent("Button")')
})

test('shared modal preserves floating behavior and native focus management', () => {
  const modal = readFileSync(new URL('ModalSurface.vue', shared), 'utf8')
  expect(modal).toContain('floating?: boolean')
  expect(modal).toContain('surfaceStyle?: Record<string, string>')
  expect(modal).toContain('<Dialog :open="true" :modal="!floating"')
  expect(modal).toContain('<DialogContent')
  expect(modal).toContain('<DialogTitle')
  expect(modal).toContain(':style="surfaceStyle"')
  expect(modal).toContain('@interact-outside="interactOutside"')
  expect(modal).toContain("emit('close')")
})
