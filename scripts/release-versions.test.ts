import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  assignReleaseVersion,
  parseReleaseVersions,
  parseVersion,
  releaseProducts,
} from './release-versions'

const oldSha = 'a'.repeat(40)
const nextSha = 'b'.repeat(40)

test('CI assigns one patch by default and retries the same source without incrementing', () => {
  const next = assignReleaseVersion({ version: '0.5.52', sourceSha: oldSha }, nextSha, [
    'Correct archive reads',
  ])
  expect(next).toEqual({ version: '0.5.53', sourceSha: nextSha })
  expect(assignReleaseVersion(next, nextSha, ['feat: ignored on retry'])).toBe(next)
})

test('commit intent selects one final semver step across the combined changes', () => {
  const prior = { version: '2.0.49', sourceSha: oldSha }
  expect(
    assignReleaseVersion(prior, nextSha, ['fix: first', 'feat(archive): export range', 'fix: review'])
      .version,
  ).toBe('2.1.0')
  expect(
    assignReleaseVersion(prior, nextSha, ['feat: new option', 'refactor!: replace public contract'])
      .version,
  ).toBe('3.0.0')
  expect(
    assignReleaseVersion(prior, nextSha, ['refactor: update\n\nBREAKING CHANGE: new contract']).version,
  ).toBe('3.0.0')
})

test('invalid source, missing products, corrupt versions and overflow fail closed', () => {
  expect(() => assignReleaseVersion({ version: '1.0.0', sourceSha: oldSha }, 'HEAD', [])).toThrow()
  expect(() => assignReleaseVersion({ version: '1.0.65535', sourceSha: oldSha }, nextSha, [])).toThrow()
  expect(() => parseVersion('01.2.3')).toThrow()
  expect(() => parseVersion('1.2.3-dev.1')).toThrow()
  expect(() => parseReleaseVersions({ schema: 1, products: {} })).toThrow()
})

test('real Git transition reads installed versions, scopes allocation and reuses reserved metadata', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'browser-release-version-'))
  const script = resolve('scripts/prepare-release-versions.ts')
  const run = (...args: string[]) => {
    const result = Bun.spawnSync(args, { cwd: fixture, env: { ...process.env, CI: 'true' } })
    if (!result.success) throw Error(new TextDecoder().decode(result.stderr))
    return new TextDecoder().decode(result.stdout).trim()
  }
  try {
    run('git', 'init', '-b', 'main')
    run('git', 'config', 'user.name', 'Synthetic release test')
    run('git', 'config', 'user.email', 'release-test@example.invalid')
    mkdirSync(join(fixture, 'userscripts'))
    const versions = ['1.1.51', '2.0.49', '0.5.52']
    for (const [index, id] of releaseProducts.entries())
      writeFileSync(
        join(fixture, 'userscripts', `${id}.user.js`),
        `// @version      ${versions[index]}\n`,
      )
    run('git', 'add', '.')
    run('git', 'commit', '-m', 'Synthetic baseline')
    const baseline = run('git', 'rev-parse', 'HEAD')
    run('git', 'update-ref', 'refs/remotes/origin/dev', baseline)
    for (const id of releaseProducts) run('git', 'tag', `rolling-dev/${id}`)
    mkdirSync(join(fixture, 'modules/chatgpt-booster'), { recursive: true })
    writeFileSync(join(fixture, 'modules/chatgpt-booster/change.ts'), 'export const synthetic = true\n')
    run('git', 'add', '.')
    run('git', 'commit', '-m', 'fix: synthetic ChatGPT behavior')
    const sourceSha = run('git', 'rev-parse', 'HEAD')
    const prepare = () => {
      const result = Bun.spawnSync(['bun', script], {
        cwd: fixture,
        env: { ...process.env, CI: 'true', GITHUB_SHA: sourceSha },
      })
      if (!result.success) throw Error(new TextDecoder().decode(result.stderr))
      return parseReleaseVersions(
        JSON.parse(readFileSync(join(fixture, '.release-versions.json'), 'utf8')),
      )
    }
    const assigned = prepare()
    expect(assigned.products['vk-booster']).toEqual({ version: '1.1.51', sourceSha: baseline })
    expect(assigned.products['chatgpt-booster']).toEqual({ version: '2.0.50', sourceSha })
    expect(assigned.products['all-in-one']).toEqual({ version: '0.5.53', sourceSha })
    writeFileSync(join(fixture, 'release-versions.json'), JSON.stringify(assigned))
    run('git', 'add', 'release-versions.json')
    run('git', 'commit', '-m', 'Synthetic reservation before a failed build')
    run('git', 'update-ref', 'refs/remotes/origin/dev', run('git', 'rev-parse', 'HEAD'))
    run('git', 'checkout', '--detach', sourceSha)
    expect(prepare()).toEqual(assigned)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
