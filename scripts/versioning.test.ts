import { expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { affectedModules, impactedProductVersions, manifest, scopeFor } from './catalog'
import { releaseTargets } from './release-plan'

test('product changes select only the actual provider and aggregate consumers', () => {
  expect(
    impactedProductVersions(['modules/chatgpt-booster/packages/features/src/page-runtime.ts']),
  ).toEqual(['chatgpt-booster', 'all-in-one'])
  expect(affectedModules(['modules/vk-booster/src/index.ts'])).toEqual(['vk-booster', 'all-in-one'])
  expect(impactedProductVersions(['packages/archive/src/page-fold.ts'])).toEqual([
    'vk-booster',
    'chatgpt-booster',
    'all-in-one',
  ])
  expect(impactedProductVersions(['docs/README.md', '.github/workflows/release.yml'])).toEqual([])
})
test('aggregate and release scopes retain actual dependency ownership', async () => {
  expect((await manifest('all-in-one')).dependencies).toEqual(['vk-booster', 'chatgpt-booster'])
  expect(scopeFor('all-in-one')).toContain('modules/chatgpt-booster/')
  expect(releaseTargets('chatgpt-booster')).toEqual(['chatgpt-booster', 'all-in-one'])
  expect(releaseTargets('vk-booster')).toEqual(['vk-booster', 'all-in-one'])
  expect(releaseTargets('all-in-one')).toEqual(['all-in-one'])
  expect(() => releaseTargets('unknown')).toThrow()
})
test('private workspace metadata has no separately maintained product release number', async () => {
  const paths = ['modules/chatgpt-booster/package.json', 'modules/vk-booster/package.json']
  for (const dir of await readdir('modules/chatgpt-booster/packages', { withFileTypes: true }))
    if (dir.isDirectory()) paths.push(`modules/chatgpt-booster/packages/${dir.name}/package.json`)
  for (const path of paths) expect(JSON.parse(await readFile(path, 'utf8')).version).toBe('0.0.0')
})
