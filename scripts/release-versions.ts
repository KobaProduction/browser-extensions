import { readFile } from 'node:fs/promises'

export const releaseProducts = ['vk-booster', 'chatgpt-booster', 'all-in-one'] as const
export type ReleaseProduct = (typeof releaseProducts)[number]
export interface VersionAssignment {
  version: string
  sourceSha: string
}
export interface ReleaseVersions {
  schema: 1
  products: Record<ReleaseProduct, VersionAssignment>
}

export function parseVersion(version: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('Invalid release version')
  const parts = version.split('.').map(Number)
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 65535))
    throw Error('Release version exceeds Chromium bounds')
  return parts
}

export function parseReleaseVersions(value: unknown): ReleaseVersions {
  const ledger = value as ReleaseVersions | null
  if (ledger?.schema !== 1 || !ledger.products) throw Error('Invalid release version ledger')
  for (const id of releaseProducts) {
    const entry = ledger.products[id]
    if (!entry || !/^[a-f0-9]{40}$/.test(entry.sourceSha)) throw Error(`Invalid release source: ${id}`)
    parseVersion(entry.version)
  }
  return ledger
}

export function assignReleaseVersion(
  previous: VersionAssignment,
  sourceSha: string,
  messages: readonly string[],
): VersionAssignment {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw Error('Invalid source SHA')
  const [major = 0, minor = 0, patch = 0] = parseVersion(previous.version)
  if (previous.sourceSha === sourceSha) return previous
  const breaking = messages.some((message) =>
    /^(?:[a-z]+)(?:\([^\n)]+\))?!:|^BREAKING CHANGE:/m.test(message),
  )
  const feature = messages.some((message) => /^feat(?:\([^\n)]+\))?:/m.test(message))
  const version = breaking
    ? `${major + 1}.0.0`
    : feature
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`
  parseVersion(version)
  return { version, sourceSha }
}

export function gitText(...args: string[]): string | null {
  const result = Bun.spawnSync(['git', ...args], { stderr: 'pipe' })
  return result.success ? new TextDecoder().decode(result.stdout).trim() : null
}

/** Read-only local checkout: never allocate a published version or fetch implicitly. */
export function publishedReleaseVersions(): ReleaseVersions | null {
  const source = gitText('show', 'origin/dev:release-versions.json')
  if (source !== null) return parseReleaseVersions(JSON.parse(source))
  // One-time transition from the existing published channel; no hardcoded product numbers.
  const products = {} as ReleaseVersions['products']
  for (const id of releaseProducts) {
    const sourceSha = gitText('rev-parse', `refs/tags/rolling-dev/${id}^{commit}`)
    if (!sourceSha) return null
    const script = gitText('show', `origin/dev:userscripts/${id}.user.js`)
    const version = script?.match(/^\/\/ @version\s+(\S+)/m)?.[1]
    if (!version) return null
    parseVersion(version)
    products[id] = { version, sourceSha }
  }
  return { schema: 1, products }
}

let versions: Promise<ReleaseVersions | null> | undefined
export async function productReleaseVersion(id: string): Promise<string> {
  if (!releaseProducts.some((product) => product === id)) return '0.0.0'
  versions ??= process.env.RELEASE_VERSIONS_FILE
    ? readFile(process.env.RELEASE_VERSIONS_FILE, 'utf8').then((source) =>
        parseReleaseVersions(JSON.parse(source)),
      )
    : Promise.resolve(publishedReleaseVersions())
  const ledger = await versions
  if (!ledger && process.env.CI) throw Error('CI must provide published or assigned release versions')
  return ledger?.products[id as ReleaseProduct].version ?? '0.0.0'
}
