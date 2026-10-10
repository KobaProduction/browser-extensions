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

test('VK 3.0.0 is one-time authorized major transition, then immutable during development', () => {
  const beforeMajor = {
    'vk-booster': '2.3.10',
    'chatgpt-booster': '2.0.4',
    'all-in-one': '0.5.3',
  }
  const vk3 = { ...beforeMajor, 'vk-booster': '3.0.0', 'all-in-one': '0.6.0' }
  const vkChange = ['modules/vk-booster/src/model/service.ts']
  expect(() => validateVersionPolicy(vkChange, beforeMajor, vk3)).not.toThrow()
  expect(() => validateVersionPolicy(['docs/README.md'], beforeMajor, vk3)).toThrow(
    'requires a VK source change',
  )

  // An ordinary VK fix still rebuilds the aggregate, not the VK base version.
  expect(() => validateVersionPolicy(vkChange, vk3, { ...vk3, 'all-in-one': '0.6.1' })).not.toThrow()
  // Product isolation: a pure ChatGPT change never changes VK.
  expect(() =>
    validateVersionPolicy(['modules/chatgpt-booster/src/index.ts'], vk3, {
      ...vk3,
      'chatgpt-booster': '2.0.5',
      'all-in-one': '0.6.1',
    }),
  ).not.toThrow()
  // Shared runtime changes affect ChatGPT and aggregate; VK stays at 3.0.0.
  expect(() =>
    validateVersionPolicy(['packages/core/src/telemetry.ts'], vk3, {
      ...vk3,
      'chatgpt-booster': '2.0.5',
      'all-in-one': '0.6.1',
    }),
  ).not.toThrow()
  expect(() =>
    validateVersionPolicy(vkChange, vk3, { ...vk3, 'vk-booster': '3.0.1', 'all-in-one': '0.6.1' }),
  ).toThrow('frozen at 3.0.0')
  expect(() =>
    validateVersionPolicy(['docs/README.md'], vk3, { ...vk3, 'vk-booster': '3.0.1' }),
  ).toThrow('frozen at 3.0.0')
})
