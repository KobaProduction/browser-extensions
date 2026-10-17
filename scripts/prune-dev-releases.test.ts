import { expect, test } from 'bun:test'
import { planDevReleasePruning, type ReleaseRecord } from './prune-dev-releases'

const release = (id: number, tag_name: string, patch: Partial<ReleaseRecord> = {}): ReleaseRecord => ({
  id,
  tag_name,
  prerelease: true,
  draft: false,
  published_at: `2026-10-${String(id).padStart(2, '0')}T00:00:00Z`,
  assets: [{ name: 'module.user.js' }, { name: 'module-extension.zip' }],
  ...patch,
})
test('retention removes only old DEV publications and preserves every stable, draft and unknown release', () => {
  const rows = [
    release(1, 'vk-booster/v2.3.10-dev.36'),
    release(2, 'dev-vk-booster/v1.1.48'),
    release(3, 'vk-booster/v1.1.0', { prerelease: false }),
    release(4, 'dev-vk-booster/v1.1.49', { draft: true }),
    release(5, 'unrelated/v1.0.0'),
    release(6, 'dev-chatgpt-booster/v2.0.47'),
    release(7, 'dev-all-in-one/v0.5.48'),
  ]
  const plan = planDevReleasePruning(rows)
  expect(plan.keep.map((row) => row.id)).toEqual([2, 6, 7])
  expect(plan.remove.map((row) => row.id)).toEqual([1])
})
test('a provider publication pins its own complete release without pruning sibling products', () => {
  const rows = [
    release(1, 'dev-vk-booster/v1.1.48'),
    release(2, 'dev-vk-booster/v1.1.49'),
    release(3, 'dev-chatgpt-booster/v2.0.47'),
  ]
  expect(
    planDevReleasePruning(rows, 'vk-booster', rows[1]?.tag_name).remove.map((row) => row.id),
  ).toEqual([1])
  expect(() => planDevReleasePruning(rows, 'vk-booster', 'dev-vk-booster/v1.1.50')).toThrow('missing')
  expect(() => planDevReleasePruning(rows, 'unknown')).toThrow('Unknown')
  expect(() => planDevReleasePruning(rows, 'vk-booster', rows[0]?.tag_name)).toThrow('obsolete')
})
test('incomplete or stable artifacts cannot authorize deletion of existing DEV downloads', () => {
  expect(() => planDevReleasePruning([release(1, 'dev-vk-booster/v1.1.48', { assets: [] })])).toThrow(
    'incomplete',
  )
  expect(() =>
    planDevReleasePruning(
      [release(1, 'dev-vk-booster/v1.1.48', { prerelease: false })],
      'vk-booster',
      'dev-vk-booster/v1.1.48',
    ),
  ).toThrow('missing')
})

test('rolling prerelease replaces historical versioned DEV records', () => {
  const plan = planDevReleasePruning(
    [release(8, 'dev-all-in-one/v0.5.47'), release(9, 'rolling-dev/all-in-one')],
    'all-in-one',
    'rolling-dev/all-in-one',
  )
  expect(plan.remove.map((row) => row.id)).toEqual([8])
})
