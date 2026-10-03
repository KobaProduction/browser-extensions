import type { SettingsAdapter } from '../../packages/core/src'
import { translate } from '../../packages/ui/src/i18n'

const delay = () => new Promise((resolve) => setTimeout(resolve, 100))
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
function shadow() {
  const root = document.getElementById('chatgpt-booster-root')?.shadowRoot
  if (!root) throw new Error('Booster shadow root missing')
  return root
}
function button(selector: string) {
  const element = shadow().querySelector<HTMLButtonElement>(selector)
  if (!element) throw new Error(`Button missing: ${selector}`)
  return element
}
function bounds(element: Element) {
  const r = element.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}
export async function runUiTests(settings: SettingsAdapter) {
  const result: { name: string; pass: boolean; detail?: unknown }[] = []
  const previous = await settings.get()
  async function check(name: string, fn: () => Promise<unknown>) {
    try {
      const detail = await fn()
      result.push({ name, pass: true, detail })
    } catch (error) {
      result.push({
        name,
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  async function close() {
    for (
      let i = 0;
      i < 2 && button('.booster-dock-toggle').getAttribute('aria-expanded') === 'true';
      i++
    ) {
      button('.booster-dock-toggle').click()
      await delay()
    }
  }
  try {
    await close()
    await settings.update({ launcher: { side: 'right', heightRatio: 0.65 }, language: 'ru' })
    await delay()
    await check(
      'right edge and stable toggle, no host layout shift, repeated click closes',
      async () => {
        const main = document.querySelector('main')
        assert(main, 'main missing')
        const hostBefore = bounds(main),
          before = bounds(button('.booster-dock-toggle'))
        assert(Math.abs(before.right - innerWidth) < 1, 'not flush with right edge')
        button('.booster-dock-toggle').click()
        await delay()
        const panel = shadow().querySelector('.booster-dock-shell')
        assert(panel, 'panel missing')
        assert(same(before, bounds(button('.booster-dock-toggle'))), 'toggle moved on expand')
        assert(same(hostBefore, bounds(main)), 'host main changed geometry')
        assert(
          bounds(panel).x >= 0 && bounds(panel).bottom <= innerHeight && bounds(panel).y >= 0,
          'panel outside viewport',
        )
        assert(!panel.textContent?.includes('g-p-1111'), 'raw project ID shown as name')
        assert(
          panel.textContent?.includes('110') && panel.textContent?.includes('55'),
          'reply/detail counts missing',
        )
        button('.booster-dock-toggle').click()
        await delay()
        assert(!shadow().querySelector('.booster-dock-shell'), 'repeat click did not close')
        return { viewport: [innerWidth, innerHeight], anchor: before }
      },
    )
    await check(
      'pointer handler drop snaps left and persists height ratio (synthetic pointer)',
      async () => {
        const toggle = button('.booster-dock-toggle'),
          before = bounds(toggle)
        const x = before.x + 22,
          y = before.y + 22,
          targetY = (innerHeight - 44) * 0.2 + 22
        toggle.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 41,
            button: 0,
            bubbles: true,
            clientX: x,
            clientY: y,
          }),
        )
        toggle.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 41,
            button: 0,
            bubbles: true,
            clientX: 22,
            clientY: targetY,
          }),
        )
        toggle.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId: 41,
            button: 0,
            bubbles: true,
            clientX: 22,
            clientY: targetY,
          }),
        )
        toggle.click()
        await delay()
        const saved = (await settings.get()).launcher
        assert(
          saved.side === 'left' && Math.abs(saved.heightRatio - 0.2) < 0.002,
          'dock preference incorrect',
        )
        assert(bounds(toggle).x === 0, 'not flush left')
        assert(toggle.getAttribute('aria-expanded') === 'false', 'drag toggled panel')
        toggle.click()
        await delay()
        const panel = shadow().querySelector('.booster-dock-shell')
        assert(panel, 'no left panel')
        assert(bounds(panel).x === 0 && bounds(panel).bottom <= innerHeight, 'left panel overflows')
        assert(
          shadow().querySelector('.booster-dock.grow-down'),
          'panel did not choose downward space',
        )
        await close()
        return { side: saved.side, ratio: saved.heightRatio }
      },
    )
    await check(
      'archive opens current project only, nested records are lazy, no composer',
      async () => {
        button('.booster-dock-toggle').click()
        await delay()
        button('.booster-dock-actions > button:nth-child(3)').click()
        await delay()
        const reader = shadow().querySelector('.booster-reader')
        assert(reader, 'no archive')
        const projects = [...reader.querySelectorAll<HTMLButtonElement>('.booster-group-toggle')]
        const active = projects.find((p) => p.textContent?.includes('Koba Infrastructure'))
        const other = projects.find((p) => p.textContent?.includes('Другой проект'))
        assert(
          active?.getAttribute('aria-expanded') === 'true' &&
            other?.getAttribute('aria-expanded') === 'false',
          'wrong expanded projects',
        )
        assert(
          reader.querySelectorAll('.booster-exchange').length === 40,
          'initial rendering is not bounded to 40 exchanges',
        )
        assert(
          !reader.querySelector('.booster-record-tool_result'),
          'nested details rendered before opening',
        )
        const disclosure = reader.querySelector<HTMLDetailsElement>('.booster-exchange-details')
        assert(disclosure, 'no disclosure')
        disclosure.open = true
        await delay()
        assert(reader.querySelector('.booster-record-tool_result'), 'nested tool record missing')
        assert(
          !reader.querySelector('textarea,[contenteditable="true"],form'),
          'reader contains a composer or edit form',
        )
        const buttons = [...reader.querySelectorAll<HTMLButtonElement>('button')]
        const more = buttons.find((b) => b.textContent?.trim() === translate('ru', 'reader.more'))
        assert(more, 'show more missing')
        more.click()
        await delay()
        assert(
          reader.querySelectorAll('.booster-exchange').length === 55,
          'show more did not render remaining exchanges',
        )
        other.click()
        await delay()
        assert(other.getAttribute('aria-expanded') === 'true', 'other project cannot be expanded')
        await close()
        return { initialExchanges: 40, expandedExchanges: 55, replyCount: 110, nestedCount: 55 }
      },
    )
    return result
  } finally {
    await close()
    await settings.set(previous)
  }
}
