/** Product-neutral paged source fixture for local extension/archive simulations.
 * This module is not a production provider and never calls a remote API. */
export function createArchivePageFixture<T>(
  rows: readonly T[],
  options: { delayMs?: number; failAtOffset?: number } = {},
) {
  let requests = 0
  return {
    get requestCount() {
      return requests
    },
    async page(offset: number, limit: number): Promise<{ total: number; items: T[] }> {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
        throw Error('Invalid fixture paging arguments')
      if (options.failAtOffset !== undefined && offset >= options.failAtOffset)
        throw Error('Synthetic network interruption')
      requests++
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      return { total: rows.length, items: rows.slice(offset, offset + limit) }
    },
  }
}
