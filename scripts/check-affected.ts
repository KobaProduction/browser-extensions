import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { affectedModules } from './catalog'
import { onlyPackageScriptsChanged } from './package-impact'
import { changedTestInputs, dependencyGraph, isTest, relatedFiles, relatedTests } from './test-affected'

const products = ['vk-booster', 'chatgpt-booster', 'all-in-one'] as const
const globalTypes = new Set(['tsconfig.json', 'package.json', 'bun.lock', 'bunfig.toml'])
const buildTools =
  /^scripts\/(?:build(?:-chatgpt|-platform)?|catalog|channels|extension-keys|release-versions)\.ts$/
const code = (file: string) => /\.(?:ts|tsx|vue)$/.test(file) && !isTest(file)

export function checkPlan(
  changed: readonly string[],
  graph: ReadonlyMap<string, readonly string[]>,
  all = false,
  packageRuntimeChanged = true,
) {
  const inputs = packageRuntimeChanged ? [...changed] : changed.filter((file) => file !== 'package.json')
  const inventory = [...graph.keys()]
  const affected =
    all || inputs.some((file) => globalTypes.has(file)) ? inventory : relatedFiles(inputs, graph)
  const roots = affected.filter((file) => graph.has(file) && code(file)).sort()
  const buildInputs = inputs.filter(
    (file) =>
      !isTest(file) &&
      (/^modules\/[^/]+\/(?:src\/|packages\/|module\.json$)/.test(file) ||
        /^packages\//.test(file) ||
        /^apps\/(?:userscript\/|extension\/|all-in-one\.json$)/.test(file) ||
        globalTypes.has(file) ||
        buildTools.test(file)),
  )
  const builds = all
    ? [...products]
    : affectedModules(buildInputs).filter(
        (id): id is (typeof products)[number] => id !== 'proxy-switcher',
      )
  return {
    roots,
    tests: all ? inventory.filter(isTest).sort() : relatedTests(inputs, graph),
    lint: all || changed.includes('biome.json') ? ['.'] : [...changed].sort(),
    builds,
    lab: all || changed.some((file) => file.startsWith('apps/ui-lab/')),
    validate: all || builds.length > 0 || changed.some((file) => file.startsWith('scripts/')),
  }
}

export function pushUpdates(input: string) {
  return input
    .trim()
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const fields = line.trim().split(/\s+/)
      const [localRef, head, remoteRef, base] = fields
      if (
        fields.length !== 4 ||
        !localRef ||
        !remoteRef ||
        !head ||
        !base ||
        !/^[a-f0-9]{40,64}$/.test(head) ||
        !/^[a-f0-9]{40,64}$/.test(base)
      )
        throw Error('Invalid Git pre-push ref input')
      return /^0+$/.test(head) ? [] : [{ localRef, head, remoteRef, base }]
    })
}

async function git(...args: string[]) {
  const result = await Bun.$`git ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) throw Error(`Cannot determine check scope: git ${args[0]} failed`)
  return result.stdout.toString().trim()
}

export async function runCommands(
  commands: readonly string[][],
  run = async (command: string[]) => {
    console.log(`$ ${command.join(' ')}`)
    return await Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' }).exited
  },
) {
  for (const command of commands) {
    const status = await run(command)
    if (status !== 0) throw Error(`Quality gate failed (${status}): ${command[0]} ${command[1]}`)
  }
}

async function check(changed: string[], all: boolean, planOnly: boolean) {
  const graph = await dependencyGraph()
  let packageRuntimeChanged = true
  if (!all && changed.includes('package.json')) {
    const base = process.env.BASE_SHA || (await git('rev-parse', '@{upstream}'))
    const before = await Bun.$`git show ${base}:package.json`.quiet().nothrow()
    if (before.exitCode === 0)
      packageRuntimeChanged = !onlyPackageScriptsChanged(
        before.stdout.toString(),
        readFileSync('package.json', 'utf8'),
      )
  }
  const plan = checkPlan(changed, graph, all, packageRuntimeChanged)
  console.log(JSON.stringify({ mode: all ? 'all (explicit)' : 'affected', changed, ...plan }, null, 2))
  if (planOnly) return
  const commands: string[][] = []
  let temporary: string | undefined
  try {
    if (plan.roots.length) {
      const directory = resolve('.local')
      mkdirSync(directory, { recursive: true })
      temporary = mkdtempSync(resolve(directory, 'quality-'))
      const config = resolve(temporary, 'tsconfig.json')
      const ambient = [...graph.keys()].filter((file) => file.endsWith('.d.ts'))
      writeFileSync(
        config,
        JSON.stringify({
          extends: resolve('tsconfig.json'),
          compilerOptions: { types: ['vite/client', 'chrome', 'bun', 'node'] },
          include: [],
          files: [...new Set([...plan.roots, ...ambient])].map((file) => resolve(file)),
        }),
      )
      commands.push(['bun', 'x', 'vue-tsc', '--noEmit', '-p', config])
    }
    const lint = plan.lint.filter((file) => existsSync(file))
    if (lint.length)
      commands.push([
        'bun',
        'x',
        'biome',
        'check',
        '--error-on-warnings',
        '--no-errors-on-unmatched',
        ...lint,
      ])
    if (plan.tests.length) commands.push(['bun', 'test', ...plan.tests.map((file) => `./${file}`)])
    if (plan.validate) commands.push(['bun', 'scripts/validate.ts'])
    for (const id of plan.builds) {
      commands.push(['bun', 'scripts/build.ts', '--module', id])
      commands.push(['bun', 'scripts/validate.ts', '--built', '--module', id])
    }
    if (plan.lab) commands.push(['bun', 'run', 'ui:lab:build'])
    await runCommands(commands)
  } finally {
    // Only this invocation's mkdtemp directory, never a caller-supplied path.
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.includes('--pre-push')) {
    const updates = pushUpdates(await Bun.stdin.text())
    for (const update of updates) {
      if ((await git('rev-parse', 'HEAD')) !== update.head)
        throw Error('Check the branch being pushed in its own checkout first')
      if (await git('diff', '--name-only', 'HEAD'))
        throw Error('Commit or stash tracked changes before validating the pushed snapshot')
      let base = update.base
      if (/^0+$/.test(base)) {
        const remote = args[args.indexOf('--pre-push') + 1]
        if (!remote) throw Error('Pre-push remote is required')
        const defaultRef = await Bun.$`git symbolic-ref ${`refs/remotes/${remote}/HEAD`}`
          .quiet()
          .nothrow()
        if (defaultRef.exitCode === 0)
          base = await git('merge-base', defaultRef.stdout.toString().trim(), update.head)
      }
      process.env.BASE_SHA = base
      process.env.HEAD_SHA = update.head
      await check(await changedTestInputs({ workingTree: false }), false, args.includes('--plan'))
    }
  } else {
    const all = args.includes('--all') || process.env.CHECK_ALL === 'true'
    await check(all ? [] : await changedTestInputs(), all, args.includes('--plan'))
  }
}
