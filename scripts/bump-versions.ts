import { readdir, readFile, writeFile } from 'node:fs/promises'
import { impactedProductVersions } from './catalog'

export function bumpPatch(version: string): string {
  const parts = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!parts) throw new Error('Expected simple semver MAJOR.MINOR.PATCH')
  const patch = Number(parts[3])
  if (!Number.isSafeInteger(patch + 1)) throw new Error('Version patch overflow')
  return `${parts[1]}.${parts[2]}.${patch + 1}`
}
/** Explicitly supply the changed *implementation* paths. Only their modules
 * and the aggregate change; shared implementation updates every consumer. */
export function planVersionBumps(
  paths: readonly string[],
  versions: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    impactedProductVersions(paths).map((id) => {
      const current = versions[id]
      if (!current) throw new Error(`Missing version for ${id}`)
      return [id, bumpPatch(current)]
    }),
  )
}

if (import.meta.main) {
  const changedPaths = process.argv.slice(2)
  if (!changedPaths.length)
    throw Error('Provide changed implementation paths; this command never guesses which modules changed')
  const manifests: Record<string, { file: string; data: { version: string } }> = {}
  for (const id of ['vk-booster', 'chatgpt-booster', 'all-in-one']) {
    const file = id === 'all-in-one' ? 'apps/all-in-one.json' : `modules/${id}/module.json`
    manifests[id] = { file, data: JSON.parse(await readFile(file, 'utf8')) }
  }
  const versions = Object.fromEntries(
    Object.entries(manifests).map(([id, entry]) => [id, entry.data.version]),
  )
  const next = planVersionBumps(changedPaths, versions)
  for (const [id, version] of Object.entries(next)) {
    const entry = manifests[id]
    if (!entry) throw new Error(`Unknown manifest ${id}`)
    const oldVersion = versions[id]
    entry.data.version = version
    await writeFile(entry.file, JSON.stringify(entry.data, null, 2) + '\n')
    if (id !== 'all-in-one') {
      const root = `modules/${id}/package.json`
      const parent = JSON.parse(await readFile(root, 'utf8')) as { version: string }
      parent.version = version
      await writeFile(root, JSON.stringify(parent, null, 2) + '\n')
    }
    if (id === 'chatgpt-booster') {
      for (const child of await readdir('modules/chatgpt-booster/packages', { withFileTypes: true })) {
        if (!child.isDirectory()) continue
        const file = `modules/chatgpt-booster/packages/${child.name}/package.json`
        const source = JSON.parse(await readFile(file, 'utf8')) as { version: string }
        source.version = version
        await writeFile(file, JSON.stringify(source, null, 2) + '\n')
      }
      const file = 'modules/chatgpt-booster/packages/core/src/version.ts'
      const original = await readFile(file, 'utf8')
      const previous = `export const BOOSTER_BASE_VERSION = '${oldVersion}'`
      if (!original.includes(previous)) throw Error('Unexpected ChatGPT runtime version source')
      await writeFile(
        file,
        original.replace(previous, `export const BOOSTER_BASE_VERSION = '${version}'`),
      )
    }
    if (id === 'vk-booster') {
      for (const file of [
        'modules/vk-booster/src/features/chat-export/model/archive-engine.ts',
        'modules/vk-booster/src/index.test.ts',
      ]) {
        const source = await readFile(file, 'utf8')
        if (!oldVersion || !source.includes(oldVersion))
          throw Error(`Unexpected VK runtime/test version source in ${file}`)
        await writeFile(file, source.replace(oldVersion, version))
      }
    }
  }
  if (Object.keys(next).length) {
    // Workspace package manifests are pinned by bun.lock. Keep them coherent
    // with the module's newly selected version in the same command.
    const install = await Bun.$`bun install`.quiet().nothrow()
    if (install.exitCode !== 0)
      throw Error('Unable to update Bun workspace lockfile after version bumps')
  }
  console.log(JSON.stringify(next))
}
