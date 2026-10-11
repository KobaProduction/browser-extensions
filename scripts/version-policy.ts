import { readFile } from 'node:fs/promises'
import { impactedProductVersions } from './catalog'
import { FROZEN_VK_VERSION, HISTORICAL_VK_BASE } from './vk-version-freeze'

const versions = ['vk-booster', 'chatgpt-booster', 'all-in-one'] as const
export type ProductVersion = (typeof versions)[number]

export function semverCompare(left: string, right: string): number {
  const parse = (version: string) => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
      throw new Error(`Invalid product semver ${version}`)
    return version.split('.').map(Number)
  }
  const a = parse(left),
    b = parse(right)
  for (let i = 0; i < 3; i++) {
    const l = a[i],
      r = b[i]
    if (l === undefined || r === undefined || !Number.isSafeInteger(l) || !Number.isSafeInteger(r))
      throw new Error('Unsupported product version')
    if (l !== r) return Math.sign(l - r)
  }
  return 0
}
/** PR source-impact contract: VK v1 remains frozen before the first approved PROD while
 * aggregate and other genuinely affected products advance independently.
 * DEV build IDs, rather than product semver, identify VK test releases. */
export function validateVersionPolicy(
  paths: readonly string[],
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): void {
  const productPaths = paths.filter(
    (path) =>
      !path.startsWith('scripts/') &&
      !path.startsWith('.github/') &&
      !path.startsWith('docs/') &&
      path !== 'package.json' &&
      path !== 'bun.lock' &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path),
  )
  const required = new Set(impactedProductVersions(productPaths))
  for (const id of versions) {
    const from = before[id],
      to = after[id]
    if (!from || !to) throw new Error(`Missing ${id} version metadata`)
    const cmp = semverCompare(to, from)
    if (id === 'vk-booster') {
      // One explicit pre-first-PROD baseline reset from the historical 2.3.10
      // source is allowed only when VK source actually changes. Never treat
      // docs-only edits as authorization to downgrade an installed product.
      const firstV1 =
        from === HISTORICAL_VK_BASE && to === FROZEN_VK_VERSION && required.has('vk-booster')
      if (!firstV1 && (from !== FROZEN_VK_VERSION || to !== FROZEN_VK_VERSION))
        throw new Error(`VK v1 pre-PROD base must remain ${FROZEN_VK_VERSION} (${from} -> ${to})`)
      continue
    }
    if (required.has(id) && cmp <= 0)
      throw new Error(`${id} must bump its version for changed product sources (${from} -> ${to})`)
    if (!required.has(id) && cmp !== 0)
      throw new Error(`Unrelated ${id} must retain its version (${from} -> ${to})`)
  }
}

if (import.meta.main) {
  const base = process.env.BASE_SHA
  const head = process.env.HEAD_SHA || 'HEAD'
  if (!base) {
    console.log('No PR base SHA: independent version policy is checked in release CI only')
    process.exit(0)
  }
  const diff = await Bun.$`git diff --name-only ${base}...${head}`.quiet().nothrow()
  if (diff.exitCode !== 0) throw Error('Unable to calculate product changes for version policy')
  const paths = diff.stdout.toString().trim().split('\n').filter(Boolean)
  const manifestPath = (id: string) =>
    id === 'all-in-one' ? 'apps/all-in-one.json' : `modules/${id}/module.json`
  const before: Record<string, string> = {},
    after: Record<string, string> = {}
  for (const id of versions) {
    const path = manifestPath(id)
    const old = await Bun.$`git show ${base}:${path}`.quiet().nothrow()
    if (old.exitCode !== 0) throw Error(`Missing base manifest ${path}`)
    before[id] = (JSON.parse(old.stdout.toString()) as { version: string }).version
    after[id] = (JSON.parse(await readFile(path, 'utf8')) as { version: string }).version
  }
  validateVersionPolicy(paths, before, after)
  console.log(`Independent versions validated: ${JSON.stringify(after)}`)
}
