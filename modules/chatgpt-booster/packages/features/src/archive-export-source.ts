import { encodeArchiveClone } from '@kobaproduction/browser-archive'

export interface PreparedArchiveOriginal {
  value: unknown
  encoding?: 'archive-clone-v1'
}

/** JSON source payloads retain their familiar shape. Native clone values need
 * an explicit codec; JSON.stringify would silently erase them. */
export function isLosslessJsonSource(value: unknown): boolean {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }]
  const seen = new Set<object>()
  while (stack.length) {
    const item = stack.pop()
    if (!item) break
    if (item.depth > 150) return false
    const current = item.value
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) return false
      continue
    }
    if (typeof current !== 'object' || seen.has(current)) return false
    seen.add(current)
    if (Array.isArray(current)) {
      if (
        Object.keys(current).some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length)
      )
        return false
      for (let index = 0; index < current.length; index++) {
        if (!Object.hasOwn(current, index)) return false
        stack.push({ value: current[index], depth: item.depth + 1 })
      }
    } else {
      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) return false
      for (const entry of Object.values(current)) stack.push({ value: entry, depth: item.depth + 1 })
    }
  }
  return true
}

export async function prepareArchiveOriginal(value: unknown): Promise<PreparedArchiveOriginal> {
  return isLosslessJsonSource(value)
    ? { value }
    : { value: await encodeArchiveClone(value), encoding: 'archive-clone-v1' }
}
