export interface SettingsCatalogEntry {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly children?: readonly SettingsCatalogEntry[]
}
/** Presentation paths only; records and provider commands never enter this tree. */
export function findSettingsCatalogPath(
  entries: readonly SettingsCatalogEntry[],
  id: string,
  depth = 0,
): readonly SettingsCatalogEntry[] | undefined {
  if (depth > 8) return undefined
  for (const entry of entries) {
    if (entry.id === id) return [entry]
    const child = entry.children?.length
      ? findSettingsCatalogPath(entry.children, id, depth + 1)
      : undefined
    if (child) return [entry, ...child]
  }
}
export function firstSettingsCatalogLeaf(
  entries: readonly SettingsCatalogEntry[],
  depth = 0,
): SettingsCatalogEntry | undefined {
  if (depth > 8) return undefined
  for (const entry of entries) {
    if (!entry.children?.length) return entry
    const child = firstSettingsCatalogLeaf(entry.children, depth + 1)
    if (child) return child
  }
}
export interface SettingsCatalogGroup {
  readonly id: string
  readonly title: string
  readonly entries: readonly SettingsCatalogEntry[]
}
