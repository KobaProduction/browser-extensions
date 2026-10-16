import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import {
  findPlatformSettingsNav,
  type LayoutBox,
  settingsNavigationWarnings,
} from './navigation-diagnostics'

function box(left: number, top: number, width: number, height: number): LayoutBox {
  return { left, top, width, right: left + width, bottom: top + height }
}

test('embedded provider navigation is not a second platform navigation', () => {
  const document = new Window().document
  document.body.innerHTML = `<div class="booster-modal-surface">
    <section class="booster-control-center booster-control-standalone">
      <div class="booster-settings-layout"><main class="booster-settings-content">
        <section class="booster-control-center booster-control-embedded">
          <div class="booster-settings-layout"><nav class="booster-settings-nav"></nav></div>
        </section>
      </main></div>
    </section>
  </div>`
  const root = document.body as unknown as ParentNode
  expect(Boolean(findPlatformSettingsNav(root))).toBe(false)
  const outer = document.querySelector('.booster-control-standalone > .booster-settings-layout')
  const duplicate = document.createElement('nav')
  duplicate.className = 'booster-settings-nav'
  outer?.prepend(duplicate)
  expect(findPlatformSettingsNav(root)).toBe(duplicate)
})

test('mobile navigation spans a top row rather than a desktop sidebar', () => {
  expect(
    settingsNavigationWarnings({
      viewportWidth: 390,
      columns: 1,
      navigation: box(16, 160, 358, 94),
      content: box(16, 254, 358, 350),
    }),
  ).toEqual([])
})

test('desktop uses one shared catalog above the content', () => {
  expect(
    settingsNavigationWarnings({
      viewportWidth: 1365,
      columns: 1,
      navigation: box(220, 160, 870, 94),
      content: box(234, 254, 842, 400),
    }),
  ).toEqual([])
})

test('actual width, overlap and responsive-grid regressions remain failures', () => {
  const mobile = {
    viewportWidth: 390,
    columns: 1,
    navigation: box(16, 160, 358, 94),
    content: box(16, 254, 358, 350),
  }
  expect(settingsNavigationWarnings({ ...mobile, columns: 2 })).not.toEqual([])
  expect(settingsNavigationWarnings({ ...mobile, content: box(16, 200, 358, 350) })).not.toEqual([])
  expect(settingsNavigationWarnings({ ...mobile, navigation: box(-16, 160, 440, 94) })).not.toEqual([])
  const desktop = {
    viewportWidth: 1365,
    columns: 1,
    navigation: box(220, 160, 870, 94),
    content: box(234, 254, 842, 400),
  }
  expect(settingsNavigationWarnings({ ...desktop, columns: 2 })).not.toEqual([])
  expect(settingsNavigationWarnings({ ...desktop, navigation: box(0, 160, 800, 400) })).not.toEqual([])
  expect(settingsNavigationWarnings({ ...desktop, content: box(340, 160, 720, 400) })).not.toEqual([])
})
