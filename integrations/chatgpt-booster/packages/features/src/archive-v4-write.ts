/** Derived identity only. Original parsed native JSON is never reordered or rewritten. */
export function canonicalSourceJson(source: unknown): string {
  type Frame =
    | { kind: 'value'; value: unknown }
    | { kind: 'text'; text: string }
    | { kind: 'leave'; object: object }
  const stack: Frame[] = [{ kind: 'value', value: source }]
  const ancestors = new Set<object>()
  const parts: string[] = []
  while (stack.length) {
    const frame = stack.pop()
    if (!frame) break
    if (frame.kind === 'text') {
      parts.push(frame.text)
      continue
    }
    if (frame.kind === 'leave') {
      ancestors.delete(frame.object)
      continue
    }
    const value = frame.value
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      parts.push(JSON.stringify(value))
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      parts.push(JSON.stringify(value))
      continue
    }
    if (!value || typeof value !== 'object' || ancestors.has(value))
      throw new Error('archive.error.incompatibleSource')
    const array = Array.isArray(value)
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error('archive.error.incompatibleSource')
    ancestors.add(value)
    stack.push({ kind: 'leave', object: value }, { kind: 'text', text: array ? ']' : '}' })
    // Native arrays can be very large. Generate numeric indexes on demand
    // instead of allocating a second full array of index strings for hashing.
    const keys = array ? undefined : Object.keys(value).sort()
    const count = array ? value.length : (keys?.length ?? 0)
    for (let i = count - 1; i >= 0; i--) {
      const name = array ? String(i) : keys?.[i]
      if (name === undefined) continue
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      // Native JSON has data properties, not getters, holes, undefined or toJSON hooks.
      if (!descriptor || !Object.hasOwn(descriptor, 'value'))
        throw new Error('archive.error.incompatibleSource')
      stack.push({ kind: 'value', value: descriptor.value })
      if (!array) stack.push({ kind: 'text', text: `${JSON.stringify(name)}:` })
      if (i > 0) stack.push({ kind: 'text', text: ',' })
    }
    parts.push(array ? '[' : '{')
  }
  return parts.join('')
}

/** Hash before opening a readwrite transaction: crypto work is not an IDB request. */
export async function sourceFingerprint(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return `sha256-json-v1:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`
}

export function archiveWriteAllowed(
  signal: AbortSignal | undefined,
  authorized: () => boolean,
): boolean {
  return !signal?.aborted && authorized()
}

/** A scope stays revoked even when account/policy later return to their old values. */
export function archiveWriteScope(signals: readonly (AbortSignal | undefined)[]) {
  const controller = new AbortController()
  const abort = () =>
    controller.abort(new DOMException('Archive write permission revoked', 'AbortError'))
  for (const signal of signals) {
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  }
  return {
    signal: controller.signal,
    close: () => {
      for (const signal of signals) signal?.removeEventListener('abort', abort)
    },
  }
}

/**
 * Track only actively queued native-source writes. A native catalog can mention
 * thousands of conversations; after each capture settles it must not retain an
 * AbortController forever. Shared leases keep every concurrent write for one
 * conversation revocable by a single strict-contract rejection.
 */
export class ArchiveSourceWriteRegistry {
  readonly #entries = new Map<string, { controller: AbortController; holders: number }>()

  acquire(sourceId: string) {
    let entry = this.#entries.get(sourceId)
    if (!entry) {
      entry = { controller: new AbortController(), holders: 0 }
      this.#entries.set(sourceId, entry)
    }
    entry.holders++
    const owned = entry
    let released = false
    return {
      signal: owned.controller.signal,
      release: () => {
        if (released) return
        released = true
        owned.holders--
        if (owned.holders === 0 && this.#entries.get(sourceId) === owned)
          this.#entries.delete(sourceId)
      },
    }
  }

  revoke(sourceId: string) {
    this.#entries
      .get(sourceId)
      ?.controller.abort(new DOMException('Archive source contract rejected', 'AbortError'))
  }

  clear() {
    for (const entry of this.#entries.values())
      entry.controller.abort(new DOMException('Archive context revoked', 'AbortError'))
    this.#entries.clear()
  }

  get activeSources(): number {
    return this.#entries.size
  }
}

/** Revoke pending writes through the actual transaction, not just a late result filter. */
export function guardArchiveTransaction(tx: IDBTransaction, signal?: AbortSignal) {
  const abort = () => {
    try {
      tx.abort()
    } catch {
      /* Commit may already have completed. */
    }
  }
  const detach = () => signal?.removeEventListener('abort', abort)
  tx.addEventListener('complete', detach, { once: true })
  tx.addEventListener('abort', detach, { once: true })
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  return detach
}
