import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { vkBoosterFeature } from './index'

const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const build = readFileSync(new URL('../../../scripts/build.ts', import.meta.url), 'utf8')
const validate = readFileSync(new URL('../../../scripts/validate.ts', import.meta.url), 'utf8')
const manifest = JSON.parse(
  readFileSync(new URL('../../../apps/extension/src/manifest.json', import.meta.url), 'utf8'),
) as { content_scripts: Array<{ matches: string[] }> }

test('VK launcher matches the whole VK site but chat capture is guarded by current peer', () => {
  for (const host of ['vk.com', 'vk.ru']) {
    for (const path of ['/feed', '/id12', '/club14', '/im', '/im/convo/123'])
      expect(vkBoosterFeature.match(new URL(`https://${host}${path}`))).toBe(true)
  }
  expect(vkBoosterFeature.match(new URL('https://chatgpt.com/'))).toBe(false)
  expect(src).toContain('conversationPeerFromLocation(location) !== null')
  expect(src).toContain('enabled:')
})

test('standalone and aggregate user/extension delivery match entire VK origins', () => {
  for (const host of ['vk.com', 'vk.ru']) {
    const origin = `https://${host}/*`
    expect(build).toContain(`// @match        ${origin}`)
    expect(manifest.content_scripts[0]?.matches).toContain(origin)
  }
  expect(validate).toContain("user.includes('// @match        https://vk.ru/*')")
})
