import { expect, test } from 'bun:test'
import { relatedTests } from './test-affected'

const graph = new Map([
  ['packages/archive/graph.ts', []],
  ['modules/chatgpt-booster/capture.ts', ['packages/archive/graph.ts']],
  ['modules/chatgpt-booster/capture.test.ts', ['modules/chatgpt-booster/capture.ts']],
  ['modules/vk-booster/archive.ts', ['packages/archive/graph.ts']],
  ['modules/vk-booster/archive.test.ts', ['modules/vk-booster/archive.ts']],
  ['modules/vk-booster/sounds.test.ts', []],
  ['modules/chatgpt-booster/fixture.test.ts', ['modules/chatgpt-booster/fixture.json']],
])

test('provider-private changes do not run the other provider tests', () => {
  expect(relatedTests(['modules/chatgpt-booster/capture.ts'], graph)).toEqual([
    'modules/chatgpt-booster/capture.test.ts',
  ])
})
test('shared code selects linked consumers, not their entire suites', () => {
  expect(relatedTests(['packages/archive/graph.ts'], graph)).toEqual([
    'modules/chatgpt-booster/capture.test.ts',
    'modules/vk-booster/archive.test.ts',
  ])
})
test('fixture changes and deleted dependencies still reach their tests', () => {
  expect(relatedTests(['modules/chatgpt-booster/fixture.json'], graph)).toEqual([
    'modules/chatgpt-booster/fixture.test.ts',
  ])
})
test('explicit test changes select themselves and unknown documentation selects nothing', () => {
  expect(relatedTests(['modules/vk-booster/sounds.test.ts', 'docs/README.md'], graph)).toEqual([
    'modules/vk-booster/sounds.test.ts',
  ])
})
