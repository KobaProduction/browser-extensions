const products = ['vk-booster', 'chatgpt-booster', 'all-in-one'] as const
type Product = (typeof products)[number]
export interface ReleaseRecord {
  id: number
  tag_name: string
  prerelease: boolean
  draft: boolean
  published_at: string | null
  assets: readonly { name: string }[]
}
function productOf(tag: string): Product | undefined {
  return products.find((product) =>
    new RegExp(
      `^(?:dev-${product}|dev-${product}/v[0-9]+\\.[0-9]+\\.[0-9]+|${product}/v[0-9]+\\.[0-9]+\\.[0-9]+-dev\\.[0-9]+)$`,
    ).test(tag),
  )
}
/** Stable/draft/unknown releases never enter the deletion plan. Git tags are retained. */
export function planDevReleasePruning(
  releases: readonly ReleaseRecord[],
  product?: string,
  keepTag?: string,
) {
  if (product && !products.some((value) => value === product)) throw Error('Unknown DEV product')
  if (keepTag && !product) throw Error('A pinned release requires its product')
  const keep: ReleaseRecord[] = [],
    remove: ReleaseRecord[] = []
  for (const owner of products.filter((value) => !product || value === product)) {
    const rows = releases
      .filter((row) => row.prerelease && !row.draft && productOf(row.tag_name) === owner)
      .sort((a, b) => Date.parse(b.published_at ?? '') - Date.parse(a.published_at ?? '') || b.id - a.id)
    const retained = keepTag ? rows.find((row) => row.tag_name === keepTag) : rows[0]
    if (keepTag && !retained) throw Error('Published DEV release to retain is missing')
    if (!retained) continue
    if (rows[0]?.id !== retained.id && retained.tag_name !== `dev-${owner}`)
      throw Error('Cannot prune against an obsolete release')
    if (
      !retained.assets.some((asset) => asset.name.endsWith('.user.js')) ||
      !retained.assets.some((asset) => asset.name.endsWith('-extension.zip'))
    )
      throw Error(`Retained DEV release has incomplete artifacts: ${retained.tag_name}`)
    keep.push(retained)
    remove.push(...rows.filter((row) => row.id !== retained.id))
  }
  return { keep, remove }
}
if (import.meta.main) {
  const repository = process.env.GITHUB_REPOSITORY ?? 'KobaProduction/browser-extensions'
  if (repository !== 'KobaProduction/browser-extensions') throw Error('Unexpected release repository')
  const apply = process.argv.includes('--apply'),
    token = process.env.GH_TOKEN
  if (apply && !token) throw Error('Applying release retention requires GH_TOKEN')
  const value = (name: string) =>
    process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Koba-dev-retention',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  async function request(path: string, method = 'GET'): Promise<unknown> {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      method,
      headers,
    })
    if (method === 'DELETE' && response.status === 404) return null
    if (!response.ok) throw Error(`Release API ${method} failed: ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  const releases: ReleaseRecord[] = []
  for (let page = 1; ; page++) {
    if (page > 100) throw Error('Release listing exceeded its bound')
    const rows = (await request(`releases?per_page=100&page=${page}`)) as ReleaseRecord[]
    releases.push(...rows)
    if (rows.length < 100) break
  }
  const plan = planDevReleasePruning(releases, value('--product'), value('--keep-tag'))
  console.log(
    JSON.stringify(
      {
        apply,
        keep: plan.keep.map((row) => row.tag_name),
        remove: plan.remove.map((row) => row.tag_name),
      },
      null,
      2,
    ),
  )
  if (apply) {
    for (const row of plan.remove) {
      const retained = plan.keep.find((item) => productOf(item.tag_name) === productOf(row.tag_name))
      if (!retained) throw Error('Missing retained product release')
      const currentKeep = (await request(`releases/${retained.id}`)) as ReleaseRecord
      planDevReleasePruning([currentKeep], productOf(row.tag_name), retained.tag_name)
      const current = (await request(`releases/${row.id}`)) as ReleaseRecord
      if (!current.prerelease || current.draft || current.tag_name !== row.tag_name)
        throw Error('Release classification changed; refusing deletion')
      await request(`releases/${row.id}`, 'DELETE')
      console.log(`Removed obsolete DEV release: ${row.tag_name}`)
    }
  }
}
