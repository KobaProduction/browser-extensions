import { readFile } from 'node:fs/promises'
import { $ } from 'bun'
import { impactedProductVersions } from './catalog'

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
    changed = impactedProductVersions(diff.stdout.toString().split('\n').filter(Boolean))
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
