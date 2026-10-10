import { expect, test } from 'bun:test'
import { semverCompare, validateVersionPolicy } from './version-policy'

const base = { 'vk-booster': '2.3.8', 'chatgpt-booster': '0.8.99', 'all-in-one': '0.4.8' }
const chatRelease = { ...base, 'chatgpt-booster': '2.0.1', 'all-in-one': '0.5.0' }
test('initial ChatGPT v2 release and aggregate bump do not alter existing VK version', () => {
  expect(() =>
    validateVersionPolicy(
      [
        'modules/chatgpt-booster/module.json',
        'apps/all-in-one.json',
        'scripts/build-chatgpt.ts',
        'scripts/build.ts',
        'bun.lock',
      ],
      base,
      chatRelease,
    ),
  ).not.toThrow()
})
test('future ChatGPT-only source changes require ChatGPT and aggregate version bumps', () => {
  const before = { ...chatRelease },
    after = { ...before, 'chatgpt-booster': '2.0.2', 'all-in-one': '0.5.1' }
  expect(() =>
    validateVersionPolicy(['modules/chatgpt-booster/packages/features/src/index.ts'], before, after),
  ).not.toThrow()
  expect(() =>
    validateVersionPolicy(['modules/chatgpt-booster/packages/features/src/index.ts'], before, {
      ...after,
      'all-in-one': '0.5.0',
    }),
  ).toThrow('all-in-one')
  expect(() =>
    validateVersionPolicy(['modules/chatgpt-booster/packages/features/src/index.ts'], before, {
      ...after,
      'vk-booster': '2.3.9',
    }),
  ).toThrow('Unrelated vk-booster')
})
test('VK-only source change does not force a ChatGPT version bump', () => {
  const before = { ...chatRelease },
    after = { ...before, 'vk-booster': '2.3.9', 'all-in-one': '0.5.1' }
  expect(() => validateVersionPolicy(['modules/vk-booster/src/index.ts'], before, after)).not.toThrow()
})
test('shared domain change requires every product and aggregator to bump', () => {
  const before = { ...chatRelease },
    after = { ...before, 'vk-booster': '2.3.9', 'chatgpt-booster': '2.0.2', 'all-in-one': '0.5.1' }
  expect(() => validateVersionPolicy(['packages/archive/src/index.ts'], before, after)).not.toThrow()
})
test('non-runtime only changes do not demand a bump', () => {
  expect(() =>
    validateVersionPolicy(['docs/README.md', '.github/workflows/ci.yml'], chatRelease, chatRelease),
  ).not.toThrow()
  expect(semverCompare('2.0.1', '0.8.99')).toBe(1)
})
