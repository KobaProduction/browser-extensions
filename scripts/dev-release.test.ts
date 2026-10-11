import { expect, test } from 'bun:test'
import { nextDevRelease } from './dev-release'

test('DEV counter continues from historical tags without touching stable tags', () => {
  const legacy = [
    'vk-booster/v2.3.10-dev.36',
    'vk-booster/v2.3.9-dev.3',
    'chatgpt-booster/v2.0.7-dev.36',
    'all-in-one/v0.5.6-dev.36',
    'vk-booster/v2.3.10',
  ]
  expect(nextDevRelease('vk-booster', '2.3.10', legacy)).toEqual({
    counter: 37,
    tag: 'dev-vk-booster/v2.3.37',
    title: 'dev-vk-booster v2.3.37',
    reused: false,
  })
  expect(nextDevRelease('chatgpt-booster', '2.0.7', legacy).counter).toBe(37)
  expect(nextDevRelease('all-in-one', '0.5.6', legacy).counter).toBe(37)
})

test('counters advance independently over different product changes and base versions', () => {
  const tags = [
    'vk-booster/v2.3.10-dev.36',
    'chatgpt-booster/v2.0.7-dev.36',
    'dev-vk-booster/v2.3.37',
    'dev-vk-booster/v2.3.38',
    'dev-chatgpt-booster/v2.0.37',
    'dev-chatgpt-booster/v2.0.38',
    'dev-all-in-one/v0.5.44',
  ]
  expect(nextDevRelease('vk-booster', '2.3.10', tags).counter).toBe(39)
  expect(nextDevRelease('chatgpt-booster', '2.0.9', tags).counter).toBe(39)
  expect(nextDevRelease('all-in-one', '0.5.6', tags).counter).toBe(45)
  expect(nextDevRelease('vk-booster', '2.3.10', []).counter).toBe(11)
})

test('ignores spoofed tags and fails closed for unknown or over-limit versions', () => {
  expect(
    nextDevRelease('vk-booster', '2.3.10', [
      'other/v9.9.9-dev.65535',
      'dev-vk-booster/v2.3.99-garbage',
      'vk-booster/v2.3.10-dev.0',
    ]).counter,
  ).toBe(11)
  expect(() => nextDevRelease('vk/../../evil', '2.3.10', [])).toThrow()
  expect(() => nextDevRelease('vk-booster', '2.3.10', ['dev-vk-booster/v2.3.65535'])).toThrow()
  expect(() => nextDevRelease('chatgpt-booster', '2.0.7-dev.1', [])).toThrow()
})

test('retry uses release already associated with exact source commit', () => {
  const tags = ['vk-booster/v2.3.10-dev.36', 'dev-vk-booster/v2.3.37', 'dev-chatgpt-booster/v2.0.37']
  expect(nextDevRelease('vk-booster', '2.3.10', tags, ['dev-vk-booster/v2.3.37'])).toEqual({
    counter: 37,
    tag: 'dev-vk-booster/v2.3.37',
    title: 'dev-vk-booster v2.3.37',
    reused: true,
  })
  // Only the matching current product/major/minor tag is reusable.
  expect(nextDevRelease('vk-booster', '2.4.0', tags, ['dev-vk-booster/v2.3.37']).counter).toBe(38)
  expect(nextDevRelease('chatgpt-booster', '2.0.7', tags, ['dev-vk-booster/v2.3.37']).counter).toBe(38)
  expect(() =>
    nextDevRelease('vk-booster', '2.3.10', tags, ['dev-vk-booster/v2.3.37', 'dev-vk-booster/v2.3.38']),
  ).toThrow('Ambiguous')
  expect(() => nextDevRelease('vk-booster', '2.3.10', tags, ['dev-vk-booster/v2.3.999'])).toThrow(
    'inconsistent',
  )
})
