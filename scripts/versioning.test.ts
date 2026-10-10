import { expect, test } from 'bun:test'
import { bumpPatch, planVersionBumps } from './bump-versions'
import { affectedModules, impactedProductVersions, manifest, scopeFor } from './catalog'
import { releaseTargets } from './release-plan'

const versions = { 'vk-booster': '2.3.8', 'chatgpt-booster': '2.0.1', 'all-in-one': '0.5.0' }
test('ChatGPT-only change bumps ChatGPT and aggregate, not VK', () => {
  const paths = ['modules/chatgpt-booster/packages/features/src/page-runtime.ts']
  expect(impactedProductVersions(paths)).toEqual(['chatgpt-booster', 'all-in-one'])
  expect(planVersionBumps(paths, versions)).toEqual({
    'chatgpt-booster': '2.0.2',
    'all-in-one': '0.5.1',
  })
  expect(affectedModules(paths)).toEqual(['chatgpt-booster', 'all-in-one'])
})
test('VK-only change bumps VK and aggregate, not ChatGPT', () => {
  const paths = ['modules/vk-booster/src/features/chat-export/model/archive-engine.ts']
  expect(impactedProductVersions(paths)).toEqual(['vk-booster', 'all-in-one'])
  expect(planVersionBumps(paths, versions)).toEqual({ 'vk-booster': '2.3.9', 'all-in-one': '0.5.1' })
  expect(affectedModules(paths)).toEqual(['vk-booster', 'all-in-one'])
})
test('shared domain change bumps every consumer, not disabled proxy', () => {
  expect(impactedProductVersions(['packages/archive/src/page-fold.ts'])).toEqual([
    'vk-booster',
    'chatgpt-booster',
    'all-in-one',
  ])
  expect(planVersionBumps(['packages/archive/src/page-fold.ts'], versions)).toEqual({
    'vk-booster': '2.3.9',
    'chatgpt-booster': '2.0.2',
    'all-in-one': '0.5.1',
  })
})
test('non-runtime docs and CI do not trigger product version bumps', () => {
  expect(impactedProductVersions(['docs/README.md', '.github/workflows/release.yml'])).toEqual([])
  expect(planVersionBumps(['docs/README.md'], versions)).toEqual({})
})
test('aggregate includes both actual product dependencies and scoped changes', async () => {
  expect((await manifest('all-in-one')).dependencies).toEqual(['vk-booster', 'chatgpt-booster'])
  expect(scopeFor('all-in-one')).toContain('modules/chatgpt-booster/')
  expect(scopeFor('all-in-one')).toContain('modules/vk-booster/')
  expect(bumpPatch('2.0.1')).toBe('2.0.2')
})

test('independent release scopes include only changed product and aggregate', () => {
  expect(releaseTargets('chatgpt-booster')).toEqual(['chatgpt-booster', 'all-in-one'])
  expect(releaseTargets('vk-booster')).toEqual(['vk-booster', 'all-in-one'])
  expect(releaseTargets('all-in-one')).toEqual(['all-in-one'])
  expect(releaseTargets('shared')).toEqual(['vk-booster', 'chatgpt-booster', 'all-in-one'])
  expect(() => releaseTargets('unknown')).toThrow()
})

test('all internal ChatGPT private package versions match its release manifest', async () => {
  const { readdir, readFile } = await import('node:fs/promises')
  const current = (await manifest('chatgpt-booster')).version
  const root = JSON.parse(await readFile('modules/chatgpt-booster/package.json', 'utf8')) as {
    version: string
  }
  expect(root.version).toBe(current)
  for (const dir of await readdir('modules/chatgpt-booster/packages', { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const pkg = JSON.parse(
      await readFile(`modules/chatgpt-booster/packages/${dir.name}/package.json`, 'utf8'),
    ) as { version: string }
    expect(pkg.version).toBe(current)
  }
  const source = await readFile('modules/chatgpt-booster/packages/core/src/version.ts', 'utf8')
  expect(source).toContain(`BOOSTER_BASE_VERSION = '${current}'`)
})
