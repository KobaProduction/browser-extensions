import { expect, test } from 'bun:test'
import { manifest, userscriptChannelUrl } from './catalog'

for (const id of ['vk-booster', 'all-in-one']) {
  test(id + ': stable Tampermonkey update channel independent of build artifacts', async () => {
    const data = await manifest(id)
    expect(data.release).toBe(true)
    expect(userscriptChannelUrl(id)).toBe(
      'https://raw.githubusercontent.com/KobaProduction/browser-extensions/distribution/userscripts/' +
        id +
        '.user.js',
    )
    expect(data.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
}
test('unsafe user script module IDs are rejected', () => {
  expect(() => userscriptChannelUrl('../other')).toThrow('Invalid')
})
