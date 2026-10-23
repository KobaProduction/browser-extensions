import allInOne from '../apps/all-in-one.json' with { type: 'json' }
import { manifest, scopeFor } from './catalog'
import { gitText, publishedReleaseVersions } from './release-versions'
export interface ReleaseCandidate {
  id: string
  version: string
  tag: string
  changed: boolean
}
export function hasRelevantChange(paths: string[], scopes: string[]): boolean {
  return paths.some((p) =>
    scopes.some((scope) => (scope.endsWith('/') ? p.startsWith(scope) : p === scope)),
  )
}
/** Scoped human-approved releases never accidentally ship unrelated
 * products. Aggregate is included only when it declares the source dependency. */
export function releaseTargets(scope: string): string[] {
  if (scope === 'all' || scope === 'shared') return ['vk-booster', 'chatgpt-booster', 'all-in-one']
  if (scope === 'all-in-one') return ['all-in-one']
  if (scope !== 'chatgpt-booster' && scope !== 'vk-booster')
    throw new Error(`Unknown release scope: ${scope}`)
  return allInOne.dependencies.includes(scope) ? [scope, 'all-in-one'] : [scope]
}

export async function releasePlan(scope = 'all') {
  const result: ReleaseCandidate[] = []
  const includeExisting = process.argv.includes('--include-existing')
  for (const id of releaseTargets(scope)) {
    if (process.env.CI) {
      const entry =
        publishedReleaseVersions()?.products[id as 'vk-booster' | 'chatgpt-booster' | 'all-in-one']
      const script = gitText('show', `origin/dev:userscripts/${id}.user.js`)
      const published = script?.match(/^\/\/ @version\s+(\S+)/m)?.[1]
      const source = gitText('rev-parse', `refs/tags/rolling-dev/${id}^{commit}`)
      const changes = entry
        ? gitText('diff', '--name-only', entry.sourceSha, 'HEAD', '--', ...scopeFor(id))
        : null
      if (!entry || published !== entry.version || source !== entry.sourceSha || changes !== '')
        throw Error(`PROD requires the successfully published DEV source/version: ${id}`)
    }
    const m = await manifest(id),
      tag = `${id}/v${m.version}`
    if (!m.release) continue
    const tags = await Bun.$`git tag --list ${tag}`.quiet().text()
    if (tags.trim() && !includeExisting) continue // exactly this release was published already
    const pattern = `${id}/v*`
    const previous = (await Bun.$`git tag --list ${pattern} --sort=-version:refname`.quiet().text())
      .trim()
      .split('\n')[0]
    const scopes = scopeFor(id)
    let changed = true
    if (previous) {
      const diff = await Bun.$`git diff --name-only ${previous} HEAD`.quiet().nothrow()
      changed =
        diff.exitCode !== 0 || hasRelevantChange(diff.stdout.toString().trim().split('\n'), scopes)
    }
    if (changed || includeExisting) result.push({ id, version: m.version, tag, changed })
  }
  return result
}
if (import.meta.main) {
  const scopeIndex = process.argv.indexOf('--scope')
  const scope = scopeIndex >= 0 ? process.argv[scopeIndex + 1] : 'all'
  const plan = await releasePlan(scope)
  if (process.argv.includes('--json')) console.log(JSON.stringify(plan))
  else if (process.argv.includes('--tsv'))
    for (const r of plan) console.log(`${r.id}|${r.version}|${r.tag}`)
  else for (const r of plan) console.log(`${r.id} ${r.tag}`)
}
