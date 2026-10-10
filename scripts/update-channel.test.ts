import { expect, test } from 'bun:test'
import { manifest, userscriptChannelUrl } from './catalog'

for (const id of ['vk-booster', 'chatgpt-booster', 'all-in-one']) {
  test(id + ': independent stable PROD Tampermonkey channel', async () => {
    const data = await manifest(id)
    expect(data.release).toBe(true)
    expect(userscriptChannelUrl(id, 'prod')).toBe(
      'https://raw.githubusercontent.com/KobaProduction/browser-extensions/prod/userscripts/' +
        id +
        '.user.js',
    )
    expect(data.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
}
test('unsafe user script module IDs are rejected', () => {
  expect(() => userscriptChannelUrl('../other', 'dev')).toThrow('Invalid')
})
