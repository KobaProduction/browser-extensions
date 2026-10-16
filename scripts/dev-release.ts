import { channelVersion } from './channels'

const products = ['vk-booster', 'chatgpt-booster', 'all-in-one'] as const
type Product = (typeof products)[number]
const isProduct = (id: string): id is Product => products.some((product) => product === id)

export interface DevRelease {
  readonly counter: number
  readonly tag: string
  readonly title: string
  readonly reused: boolean
}

/** A separate counter for each product across ALL base versions.
 * Read the old 'product/vX.Y.Z-dev.N' tags during the naming transition.
 * Never consume a sibling product's number or touch stable release tags. */
export function nextDevRelease(
  id: string,
  baseVersion: string,
  tags: readonly string[],
  tagsAtCommit: readonly string[] = [],
): DevRelease {
  if (!isProduct(id)) throw Error('Unknown DEV product')
  channelVersion(baseVersion, 'prod', 1)
  const legacy = new RegExp(`^${id}/v[0-9]+\\.[0-9]+\\.[0-9]+-dev\\.([0-9]+)$`)
  const prefixed = new RegExp(`^dev-${id}/v[0-9]+\\.[0-9]+\\.([0-9]+)$`)
  let latest = 0
  for (const tag of tags) {
    const match = legacy.exec(tag) ?? prefixed.exec(tag)
    if (!match) continue
    const number = Number(match[1])
    if (!Number.isSafeInteger(number)) throw Error('Invalid historical DEV counter')
    latest = Math.max(latest, number)
  }
  const parts = baseVersion.split('.')
  const major = Number(parts[0])
  const minor = Number(parts[1])
  const patch = Number(parts[2])
  const sourcePrefix = `dev-${id}/v${major}.${minor}.`
  // Re-running the same validated commit must not publish a new release
  // just because its previous tag already exists. Recover a partly
  // completed channel publication against the same immutable release.
  const already = tagsAtCommit.filter((tag) => tag.startsWith(sourcePrefix) && prefixed.test(tag))
  if (already.length > 1) throw Error('Ambiguous DEV releases for source commit')
  if (already.length === 1) {
    const tag = already[0]
    if (!tag || !tags.includes(tag)) throw Error('DEV tag history inconsistent')
    const count = Number(prefixed.exec(tag)?.[1])
    if (!Number.isSafeInteger(count) || count < patch || count < 1 || count > 65535)
      throw Error('Invalid DEV release for source commit')
    return {
      counter: count,
      tag,
      title: `dev-${id} v${major}.${minor}.${count}`,
      reused: true,
    }
  }
  const counter = Math.max(latest, patch) + 1
  const numeric = channelVersion(baseVersion, 'dev', counter)
  return {
    counter,
    tag: `dev-${id}/v${numeric}`,
    title: `dev-${id} v${numeric}`,
    reused: false,
  }
}

if (import.meta.main) {
  const id = process.argv[2]
  const version = process.argv[3]
  if (!id || !version) throw Error('Usage: bun scripts/dev-release.ts PRODUCT BASE_VERSION')
  const result = Bun.spawnSync(['git', 'tag', '--list'])
  if (!result.success) throw Error('Cannot inspect DEV tag history')
  const tags = new TextDecoder().decode(result.stdout).split('\n').filter(Boolean)
  const sha = process.env.GITHUB_SHA
  const atCommit = sha ? Bun.spawnSync(['git', 'tag', '--points-at', sha, '--list']) : null
  if (atCommit && !atCommit.success) throw Error('Cannot inspect source DEV tags')
  const sourceTags = atCommit
    ? new TextDecoder().decode(atCommit.stdout).split('\n').filter(Boolean)
    : []
  const release = nextDevRelease(id, version, tags, sourceTags)
  console.log([release.counter, release.tag, release.title, release.reused ? '1' : '0'].join('|'))
}
