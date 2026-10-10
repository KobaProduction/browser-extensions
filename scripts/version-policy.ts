import { readFile } from 'node:fs/promises'
import { impactedProductVersions } from './catalog'
import { VK_FROZEN_BASE_VERSION } from './version-freeze'

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
/** PR code-impact contract: provider changes bump their own product and
 * all-in-one, shared packages bump all products, docs/CI don't bump anything.
 * Tooling files have separate review and do not silently bump VK for ChatGPT
 * packaging fixes; a shared runtime change belongs under packages/. */
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
      path !== 'bun.lock',
  )
  const required = new Set(impactedProductVersions(productPaths))
  for (const id of versions) {
    const from = before[id],
      to = after[id]
    if (!from || !to) throw new Error(`Missing ${id} version metadata`)
    const cmp = semverCompare(to, from)
    // Owner-approved VK 3.0.0 is intentionally frozen. This also validates
    // the one-time transition from 2.x to 3.0.0 on an actual VK change.
    // Future VK-only pushes still advance DEV -dev.<run> via channel-plan.
    if (id === 'vk-booster' && (from === VK_FROZEN_BASE_VERSION || to === VK_FROZEN_BASE_VERSION)) {
      if (to !== VK_FROZEN_BASE_VERSION) throw new Error('VK Booster base version is frozen at 3.0.0')
      if (from !== VK_FROZEN_BASE_VERSION && !required.has(id))
        throw new Error('VK 3.0.0 transition requires a VK source change')
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
