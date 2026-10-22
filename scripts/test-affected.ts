import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

const slash = (path: string) => path.replaceAll('\\', '/')
export const isTest = (path: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
const eligible = (path: string) =>
  /^(apps|modules|packages|scripts)\//.test(path) &&
  !/(^|\/)(dist|node_modules|browser)(\/|$)/.test(path)

/** Reverse imports include shared consumers, without running an unrelated provider suite. */
export function relatedTests(
  changed: readonly string[],
  dependencies: ReadonlyMap<string, readonly string[]>,
) {
  const consumers = new Map<string, Set<string>>()
  for (const [file, imports] of dependencies)
    for (const dependency of imports) {
      const entries = consumers.get(dependency) ?? new Set<string>()
      entries.add(file)
      consumers.set(dependency, entries)
    }
  const visited = new Set(changed)
  const queue = [...changed]
  for (const file of queue)
    for (const consumer of consumers.get(file) ?? [])
      if (!visited.has(consumer)) {
        visited.add(consumer)
        queue.push(consumer)
      }
  return [...visited].filter((file) => isTest(file) && dependencies.has(file)).sort()
}

async function git(...args: string[]) {
  const result = await Bun.$`git ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) throw Error(`git ${args[0]} failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

export async function changedTestInputs() {
  const files = new Set<string>()
  const add = (output: string) => {
    for (const file of output.split('\0').filter(Boolean)) files.add(slash(file))
  }
  const base = process.env.BASE_SHA
  const head = process.env.HEAD_SHA || 'HEAD'
  if (base && /^0+$/.test(base)) add(await git('ls-tree', '-r', '--name-only', '-z', head))
  else if (base) add(await git('diff', '--name-only', '-z', `${base}...${head}`))
  else {
    const upstream = await Bun.$`git rev-parse --abbrev-ref @{upstream}`.quiet().nothrow()
    if (upstream.exitCode === 0)
      add(await git('diff', '--name-only', '-z', `${upstream.stdout.toString().trim()}...HEAD`))
    else throw Error('Set BASE_SHA or pass --files when no upstream comparison is available')
  }
  add(await git('diff', '--name-only', '-z', 'HEAD'))
  add(await git('ls-files', '--others', '--exclude-standard', '-z'))
  return [...files].sort()
}

export async function dependencyGraph() {
  const root = process.cwd()
  const files = (await git('ls-files', '--cached', '--others', '--exclude-standard', '-z'))
    .split('\0')
    .filter(eligible)
  const inventory = new Set(files)
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options
  const cache = ts.createModuleResolutionCache(root, slash, options)
  const graph = new Map<string, string[]>()
  for (const file of files) {
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const dependencies = new Set<string>()
    if (/\.(vue|[cm]?[jt]sx?)$/.test(file)) {
      const scripts = file.endsWith('.vue')
        ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
            .map((match) => match[1])
            .join('\n')
        : source
      for (const imported of ts.preProcessFile(scripts, true, true).importedFiles) {
        const resolved = ts.resolveModuleName(
          imported.fileName,
          resolve(file),
          options,
          ts.sys,
          cache,
        ).resolvedModule
        if (resolved) {
          const path = slash(
            relative(root, ts.sys.realpath?.(resolved.resolvedFileName) ?? resolved.resolvedFileName),
          )
          if (inventory.has(path)) dependencies.add(path)
        }
        if (imported.fileName.startsWith('.')) {
          const path = slash(relative(root, resolve(dirname(file), imported.fileName)))
          for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`])
            if (inventory.has(candidate)) dependencies.add(candidate)
        }
      }
      // Fixtures and source-contract tests also read literal paths rather than importing them.
      for (const match of source.matchAll(/(?:new URL|readFile(?:Sync)?)\(\s*['"]([^'"]+)['"]/g)) {
        const literal = match[1]
        if (!literal) continue
        for (const path of [literal, slash(relative(root, resolve(dirname(file), literal)))])
          if (inventory.has(path)) dependencies.add(path)
      }
    }
    if (/\.(vue|[cm]?[jt]sx?)$/.test(file)) {
      dependencies.add('tsconfig.json')
      dependencies.add('bunfig.toml')
    }
    graph.set(file, [...dependencies])
  }
  return graph
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const graph = await dependencyGraph()
  const fileIndex = args.indexOf('--files')
  const changed =
    fileIndex >= 0
      ? args
          .slice(fileIndex + 1)
          .filter((arg) => !arg.startsWith('--'))
          .map((file) => slash(relative(process.cwd(), resolve(file))))
      : await changedTestInputs()
  const tests = args.includes('--all')
    ? [...graph.keys()].filter(isTest).sort()
    : relatedTests(changed, graph)
  console.log(`Acceptance tests: ${tests.length}; changed inputs: ${changed.length}`)
  for (const file of tests) console.log(`  ${file}`)
  const uncovered = changed.filter(
    (file) =>
      eligible(file) &&
      /\.(ts|vue)$/.test(file) &&
      !isTest(file) &&
      relatedTests([file], graph).length === 0,
  )
  for (const file of uncovered)
    console.log(`  No linked unit test: ${file} (use the relevant browser/build acceptance)`)
  if (!args.includes('--plan') && tests.length) {
    // Bun treats bare filenames as filters; ./ forces exact file paths.
    const result = Bun.spawn(['bun', 'test', ...tests.map((file) => `./${file}`)], {
      stdout: 'inherit',
      stderr: 'inherit',
    })
    process.exitCode = await result.exited
  }
}
