import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'

const overlay = readFileSync(new URL('./Overlay.vue', import.meta.url), 'utf8')
const panel = readFileSync(new URL('./ControlCenterPanel.vue', import.meta.url), 'utf8')
const menu = readFileSync(new URL('./QuickMenu.vue', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

test('standalone launcher snaps to a viewport edge and opens a compact quick menu', () => {
  expect(overlay).toContain('dockSide.value')
  expect(overlay).toContain('storeEdge()')
  expect(overlay).toContain('dockPosition()')
  expect(overlay).toContain('if (standalone.value)')
  expect(overlay).toContain('matchingFeatures.value.length === 1')
  expect(overlay).toContain("click?.mode === 'action'")
  const pointerDown = overlay.split('function onPointerDown')[1]?.split('function onPointerMove')[0]
  expect(pointerDown).not.toContain('quickOpen.value = false')
  expect(overlay).toContain('if (!dragStart.moved && standalone.value) quickOpen.value = false')
  expect(overlay).toContain('quickOpen.value = !quickOpen.value')
  expect(overlay).toContain('<QuickMenu')
  expect(overlay).toContain('standalone ? quickOpen : open')
  expect(css).toContain('.booster-quick-menu')
  expect(overlay).toContain('quickMenuHeight.value')
  expect(overlay).toContain('@resize="quickMenuHeight = $event"')
  expect(css).toContain('max-height: min(480px, calc(100dvh - 16px))')
  expect(css).toContain('.booster-launcher-docked')
})

test('standalone full settings show method/version and hide duplicate shared navigation', () => {
  expect(panel).toContain('feature.match(props.runtime.context.url)')
  expect(panel).toContain('matchingFeatures.value.length === 1')
  expect(panel).not.toContain('props.runtime.features.length === 1')
  expect(panel).toContain('booster-control-standalone')
  expect(panel).toContain('v-if="!standalone" class="booster-settings-nav"')
  expect(panel).toContain('singleFeature.presentation.installation')
  expect(panel).toContain('singleFeature.presentation.version')
  expect(overlay).toContain('floatingPanel ? workspaceStyle : undefined')
  expect(overlay).toContain('v-if="launcher && (!standalone || !open)"')
  expect(overlay).toContain('Boolean(singleFeature.value)')
})

test('shared compact menu retains accessible actions and installation toggle', () => {
  for (const [name, text] of [
    ['Overlay.vue', overlay],
    ['QuickMenu.vue', menu],
  ]) {
    const { descriptor, errors } = parse(text, { filename: name })
    expect(errors).toHaveLength(0)
    const result = compileTemplate({
      source: descriptor.template?.content ?? '',
      filename: name,
      id: 'edge-quick-menu',
    })
    expect(result.errors).toHaveLength(0)
  }
  expect(menu).toContain('v-for="action in actions"')
  expect(menu).toContain('action.availableWhenDisabled')
  expect(menu).toContain('action.enabled')
  expect(menu).toContain('v-for="metric in metrics"')
  expect(menu).toContain('role="switch"')
  expect(menu).toContain(':aria-checked="enabled"')
  expect(menu).toContain('{{ version }}')
  expect(menu).toContain('{{ installation }}')
})
