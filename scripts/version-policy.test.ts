import { expect, test } from 'bun:test'
import { semverCompare, validateVersionPolicy } from './version-policy'

const base = { 'vk-booster': '1.0.0', 'chatgpt-booster': '0.8.99', 'all-in-one': '0.4.8' }
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
      'vk-booster': '2.3.11',
    }),
  ).toThrow('Unrelated vk-booster')
})
test('VK functionality advances its minor version and its aggregate independently of PROD', () => {
  const before = { ...chatRelease },
    after = { ...before, 'vk-booster': '1.1.0', 'all-in-one': '0.5.1' }
  expect(() => validateVersionPolicy(['modules/vk-booster/src/index.ts'], before, after)).not.toThrow()
  expect(() =>
    validateVersionPolicy(['modules/vk-booster/src/index.ts'], before, {
      ...after,
      'vk-booster': before['vk-booster'],
    }),
  ).toThrow('vk-booster must bump')
  expect(() =>
    validateVersionPolicy(['modules/vk-booster/src/index.ts'], before, {
      ...after,
      'all-in-one': before['all-in-one'],
    }),
  ).toThrow('all-in-one')
})
test('shared domain change advances every affected product', () => {
  const before = { ...chatRelease },
    after = { ...before, 'vk-booster': '1.0.1', 'chatgpt-booster': '2.0.2', 'all-in-one': '0.5.1' }
  expect(() => validateVersionPolicy(['packages/archive/src/index.ts'], before, after)).not.toThrow()
})
test('non-runtime only changes do not demand a bump', () => {
  expect(() =>
    validateVersionPolicy(['docs/README.md', '.github/workflows/ci.yml'], chatRelease, chatRelease),
  ).not.toThrow()
  expect(semverCompare('2.0.1', '0.8.99')).toBe(1)
})

test('VK v3 is rejected even if no VK source file changed', () => {
  expect(() =>
    validateVersionPolicy(['docs/vk-booster/README.md'], chatRelease, {
      ...chatRelease,
      'vk-booster': '3.0.0',
    }),
  ).toThrow('Unrelated vk-booster')
})

test('VK versions cannot silently downgrade historical products or skip source increments', () => {
  const previous = { ...chatRelease, 'vk-booster': '2.3.10' }
  const next = { ...previous, 'vk-booster': '1.0.0', 'all-in-one': '0.5.1' }
  expect(() => validateVersionPolicy(['modules/vk-booster/src/index.ts'], previous, next)).toThrow(
    'vk-booster must bump',
  )
  expect(() => validateVersionPolicy(['docs/vk-booster/README.md'], previous, next)).toThrow(
    'Unrelated vk-booster',
  )
  expect(() =>
    validateVersionPolicy(['modules/vk-booster/src/index.ts'], previous, {
      ...next,
      'vk-booster': '2.3.10',
    }),
  ).toThrow('vk-booster must bump')
})

test('source-only quality assertions do not force unrelated product versions', () => {
  expect(() =>
    validateVersionPolicy(
      ['packages/ui/src/theme.test.ts', 'modules/vk-booster/tests/vk-panel-integration.test.ts'],
      chatRelease,
      chatRelease,
    ),
  ).not.toThrow()
})
