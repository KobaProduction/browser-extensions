import { expect, test } from 'bun:test'
import { readScenario } from './scenes'

test('lab scenarios are allowlisted and never treat a URL as a provider connection', () => {
  expect(readScenario('?product=vk&scene=error&view=quick&method=chromium&side=left')).toEqual({
    product: 'vk',
    scene: 'error',
    view: 'quick',
    method: 'chromium',
    side: 'left',
  })
  expect(readScenario('?product=https://chatgpt.com&scene=<script>&method=token&view=delete')).toEqual({
    product: 'chatgpt',
    scene: 'saved',
    view: 'settings',
    method: 'tampermonkey',
    side: 'right',
  })
})

test('lab fixture files cannot call live network or IndexedDB directly', async () => {
  const source = await Bun.file(new URL('./fixtures.ts', import.meta.url)).text()
  expect(source).not.toMatch(
    /\bfetch\(|\bindexedDB\.|\bXMLHttpRequest\(|\bchrome\.storage\.|\bGM_xmlhttpRequest\b/,
  )
  const markup = await Bun.file(new URL('../preview.html', import.meta.url)).text()
  expect(markup).not.toContain('chatgpt.com')
  expect(markup).not.toContain('vk.com')
})

test('standalone shell CSS cannot override provider settings layout via descendant selector', async () => {
  const css = await Bun.file(new URL('../../../packages/shell/src/styles.css', import.meta.url)).text()
  expect(css).toContain('.booster-control-standalone > .booster-settings-layout')
  expect(css).toContain(
    '.booster-control-standalone > .booster-settings-layout > .booster-settings-content',
  )
  expect(css).not.toContain('.booster-control-standalone .booster-settings-layout {')
})
