import { readFile } from 'node:fs/promises'
import { $ } from 'bun'
import { impactedProductVersions } from './catalog'

/** A lockfile-only dependency update affects every consumer. But `bun install`
 * also rewrites workspace version labels when a single private Booster bumps.
 * Those labels are not a change to a dependency used by another product.
 * Only suppress such a lockfile delta when *every other field* is equal.
 * Any unknown format, dependency diff or unmatched product fails closed to
 * the conservative all-consumer build plan. */
export function onlyProviderVersionLockChange(
  before: string,
  after: string,
  paths: readonly string[],
): boolean {
  const chatgpt = paths.some((path) => path.startsWith('modules/chatgpt-booster/'))
  const vk = paths.some((path) => path.startsWith('modules/vk-booster/'))
  if (!chatgpt && !vk) return false
  try {
    const left = Bun.JSONC.parse(before) as { workspaces?: Record<string, { version?: string }> }
    const right = Bun.JSONC.parse(after) as { workspaces?: Record<string, { version?: string }> }
    if (!left?.workspaces || !right?.workspaces) return false
    let changedVersions = 0
    for (const [name, entry] of Object.entries(left.workspaces)) {
      const matchesChat =
        chatgpt &&
        (name === 'modules/chatgpt-booster' || name.startsWith('modules/chatgpt-booster/packages/'))
      const matchesVk = vk && name === 'modules/vk-booster'
      if (!matchesChat && !matchesVk) continue
      const next = right.workspaces[name]
      if (!next) return false
      if (entry.version !== next.version) changedVersions++
      delete entry.version
      delete next.version
    }
    return changedVersions > 0 && JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

/** A channel advances only when code of that product or a bundled dependency changes. */
export async function devChannelCandidates(
  base: string,
  head = 'HEAD',
): Promise<Array<{ id: string; version: string }>> {
  const all = ['vk-booster', 'chatgpt-booster', 'all-in-one']
  // A newly initialized channel receives one known baseline, never a partial installation.
  const initial = !base || /^0{40}$/.test(base)
  let changed = initial ? all : []
  if (!initial) {
    const diff = await $`git diff --name-only ${base} ${head}`.quiet().nothrow()
    if (diff.exitCode !== 0) throw new Error('Cannot establish changed source set for dev')
    const paths = diff.stdout.toString().split('\n').filter(Boolean)
    if (paths.includes('bun.lock')) {
      const oldLock = await $`git show ${base}:bun.lock`.quiet().nothrow()
      const newLock = await $`git show ${head}:bun.lock`.quiet().nothrow()
      if (
        oldLock.exitCode === 0 &&
        newLock.exitCode === 0 &&
        onlyProviderVersionLockChange(oldLock.stdout.toString(), newLock.stdout.toString(), paths)
      )
        paths.splice(paths.indexOf('bun.lock'), 1)
    }
    changed = impactedProductVersions(paths)
  }
  return await Promise.all(
    changed.map(async (id) => {
      const file = id === 'all-in-one' ? 'apps/all-in-one.json' : `modules/${id}/module.json`
      const module = JSON.parse(await readFile(file, 'utf8')) as { version: string; release: boolean }
      // Even not-yet-promoted modules may be included in dev, never implicitly in prod.
      return { id, version: module.version }
    }),
  )
}
if (import.meta.main) {
  const base = process.argv.find((x) => x.startsWith('--base='))?.slice('--base='.length) ?? ''
  const head = process.argv.find((x) => x.startsWith('--head='))?.slice('--head='.length) ?? 'HEAD'
  for (const p of await devChannelCandidates(base, head)) console.log(p.id + '|' + p.version)
}
