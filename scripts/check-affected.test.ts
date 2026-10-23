import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkPlan, pushUpdates, runCommands } from './check-affected'
import { onlyPackageScriptsChanged } from './package-impact'

const chat = 'modules/chatgpt-booster/src/capture.ts'
const vk = 'modules/vk-booster/src/archive.ts'
const shared = 'packages/archive/src/graph.ts'
const graph = new Map([
  [shared, []],
  [chat, [shared]],
  [vk, [shared]],
  ['modules/chatgpt-booster/src/capture.test.ts', [chat]],
  ['modules/vk-booster/src/archive.test.ts', [vk]],
  ['scripts/check-affected.ts', []],
  ['scripts/check-affected.test.ts', ['scripts/check-affected.ts', '.githooks/pre-push']],
])

test('private provider edits check only that provider and its aggregate build', () => {
  const plan = checkPlan([chat], graph)
  expect(plan.roots).toEqual([chat])
  expect(plan.tests).toEqual(['modules/chatgpt-booster/src/capture.test.ts'])
  expect(plan.builds).toEqual(['chatgpt-booster', 'all-in-one'])
  expect(plan.lint).toEqual([chat])
})

test('shared sources include actual reverse consumers, while docs run no code gate', () => {
  expect(checkPlan([shared], graph).roots).toEqual([chat, vk, shared].sort())
  expect(checkPlan([shared], graph).tests).toHaveLength(2)
  const docs = checkPlan(['README.md'], graph)
  expect(docs.roots).toEqual([])
  expect(docs.tests).toEqual([])
  expect(docs.builds).toEqual([])
})

test('hook and script-alias changes do not rebuild providers or select all tests', () => {
  const plan = checkPlan(['package.json', '.githooks/pre-push'], graph, false, false)
  expect(plan.roots).toEqual([])
  expect(plan.tests).toEqual(['scripts/check-affected.test.ts'])
  expect(plan.builds).toEqual([])
  expect(checkPlan([], graph, true).builds).toHaveLength(3)
  expect(checkPlan([], graph, true).tests).toHaveLength(3)
})

test('only scripts may be ignored as package metadata; dependencies remain relevant', () => {
  const before = { name: 'fixture', scripts: { check: 'old' }, dependencies: { vue: '3' } }
  const after = { ...before, scripts: { check: 'new' } }
  expect(onlyPackageScriptsChanged(JSON.stringify(before), JSON.stringify(after))).toBe(true)
  expect(
    onlyPackageScriptsChanged(
      JSON.stringify(before),
      JSON.stringify({ ...after, dependencies: { vue: '4' } }),
    ),
  ).toBe(false)
  expect(onlyPackageScriptsChanged('{}', 'invalid')).toBe(false)
})

test('pre-push reads exact ref updates, handles deletions and rejects malformed input', () => {
  const head = 'a'.repeat(40),
    base = 'b'.repeat(40),
    zero = '0'.repeat(40)
  expect(pushUpdates(`refs/heads/main ${head} refs/heads/main ${base}\n`)).toEqual([
    { localRef: 'refs/heads/main', head, remoteRef: 'refs/heads/main', base },
  ])
  expect(pushUpdates(`(delete) ${zero} refs/heads/old ${base}`)).toEqual([])
  expect(pushUpdates(`refs/heads/new ${head} refs/heads/new ${zero}`)[0]?.base).toBe(zero)
  expect(() => pushUpdates('not git input')).toThrow()
})

test('a failed real prerequisite stops all subsequent quality-gate commands', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quality-failure-'))
  const marker = join(directory, 'must-not-run')
  try {
    await expect(
      runCommands([
        ['bun', '-e', 'process.exit(23)'],
        ['bun', '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected')`],
      ]),
    ).rejects.toThrow('Quality gate failed (23)')
    expect(await Bun.file(marker).exists()).toBe(false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('exact push range includes every unpushed commit and excludes dirty/untracked files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quality-range-'))
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: directory, stderr: 'pipe' })
    if (!result.success) throw Error('Fixture git command failed')
    return result.stdout.toString().trim()
  }
  try {
    git('init', '-q')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    writeFileSync(join(directory, 'base.ts'), 'export {}')
    git('add', '.')
    git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    for (const name of ['first.ts', 'second.ts']) {
      writeFileSync(join(directory, name), 'export {}')
      git('add', name)
      git('commit', '-qm', name)
    }
    writeFileSync(join(directory, 'base.ts'), 'export const dirty = true')
    writeFileSync(join(directory, 'untracked.ts'), 'export {}')
    const script = resolve('scripts/test-affected.ts')
    const result = Bun.spawnSync(
      [
        'bun',
        '-e',
        `const m=await import(${JSON.stringify(script)});console.log(JSON.stringify(await m.changedTestInputs({workingTree:false})))`,
      ],
      {
        cwd: directory,
        env: { ...process.env, BASE_SHA: base, HEAD_SHA: git('rev-parse', 'HEAD') },
        stderr: 'pipe',
      },
    )
    if (!result.success) throw Error(result.stderr.toString())
    expect(JSON.parse(result.stdout.toString())).toEqual(['first.ts', 'second.ts'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 20_000)
