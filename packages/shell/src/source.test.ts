import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

// Interaction assertions live in behavioral unit and browser suites. This gate
// catches broken SFC composition instead of pinning obsolete rendered markup.
for (const name of [
  'Overlay.vue',
  'ControlCenterPanel.vue',
  'QuickMenu.vue',
  'LauncherIndicators.vue',
  'SiteToolsEntry.vue',
])
  test(`${name} compiles as a shared Vue surface`, () => {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: name })
    expect(errors).toHaveLength(0)
    const script = compileScript(descriptor, { id: `shared-${name}` })
    const template = compileTemplate({
      source: descriptor.template?.content ?? '',
      filename: name,
      id: `shared-${name}`,
      compilerOptions: { bindingMetadata: script.bindings },
    })
    expect(template.errors).toHaveLength(0)
  })
