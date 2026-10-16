/** Presentation facts only; these values are not evidence of canonical data or request completion. */
export type DomFactValue = boolean | string | number
export type DomFactRoot = Document | HTMLElement
export interface DomFact {
  readonly id: string
  read(root: DomFactRoot): DomFactValue
}
export interface DomFactObserverSchema {
  readonly root: DomFactRoot
  readonly facts: readonly DomFact[]
  /** Only these attributes schedule a scan; child/text changes are observed independently. */
  readonly attributes?: readonly string[]
  onSnapshot(
    snapshot: ReadonlyMap<string, DomFactValue>,
    changed: readonly string[],
    previous: ReadonlyMap<string, DomFactValue>,
  ): void | Promise<void>
}
export interface DomFactObserver {
  /** Explicitly attach the observer and schedule the initial snapshot. Idempotent while started. */
  start(): void
  /** Schedule one coalesced scan. Reset makes its previous baseline empty. Does not start observation. */
  refresh(reset?: boolean): void
  /** Disconnect, cancel pending work and clear the baseline. Safe to call repeatedly. */
  stop(): void
}

/** Construction validates the declaration without reading or observing the DOM. */
export function createDomFactObserver(schema: DomFactObserverSchema): DomFactObserver {
  if (typeof schema.onSnapshot !== 'function') throw Error('DOM facts require a snapshot callback')
  const ids = new Set<string>()
  const facts = schema.facts.map((fact) => {
    if (
      typeof fact.id !== 'string' ||
      !fact.id.trim() ||
      ids.has(fact.id) ||
      typeof fact.read !== 'function'
    ) {
      throw Error('DOM facts require unique non-empty IDs and readers')
    }
    ids.add(fact.id)
    return { id: fact.id, read: fact.read }
  })
  const attributes = [...new Set(schema.attributes ?? [])]
  if (attributes.some((name) => typeof name !== 'string' || !name.trim()))
    throw Error('Invalid DOM fact attribute allowlist')
  const root = schema.root
  const onSnapshot = schema.onSnapshot
  let active = false
  let generation = 0
  let observer: MutationObserver | undefined
  let frame: number | undefined
  let requestFrame: ((callback: FrameRequestCallback) => number) | undefined
  let cancelFrame: ((handle: number) => void) | undefined
  let values = new Map<string, DomFactValue>()
  let resetPending = false

  function scan(epoch: number) {
    if (!active || epoch !== generation) return
    frame = undefined
    if (resetPending) {
      values.clear()
      resetPending = false
    }
    const previous = new Map(values)
    const next = new Map(values)
    const changed: string[] = []
    for (const fact of facts) {
      let value: DomFactValue
      try {
        value = fact.read(root)
      } catch {
        continue
      }
      if (!active || epoch !== generation) return
      if (
        !['boolean', 'string', 'number'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value))
      )
        continue
      if (!previous.has(fact.id) || !Object.is(previous.get(fact.id), value)) changed.push(fact.id)
      next.set(fact.id, value)
    }
    if (!active || epoch !== generation) return
    values = next
    // Copies keep consumer mutations away from the internal baseline. No-change snapshots
    // still let the provider reconcile its context; only changed IDs emit fact transitions.
    try {
      void Promise.resolve(onSnapshot(new Map(values), Object.freeze(changed), previous)).catch(() => {})
    } catch {
      /* Presentation callbacks cannot break observation or provider lifecycle. */
    }
  }
  function refresh(reset = false) {
    if (!active) return
    resetPending ||= reset
    if (frame !== undefined) return
    const epoch = generation
    frame = requestFrame?.(() => scan(epoch))
  }
  function stop() {
    active = false
    generation++
    observer?.disconnect()
    observer = undefined
    if (frame !== undefined) cancelFrame?.(frame)
    frame = undefined
    requestFrame = undefined
    cancelFrame = undefined
    values.clear()
    resetPending = false
  }
  function start() {
    if (active) return
    const document = root.nodeType === 9 ? (root as Document) : root.ownerDocument
    const view = document?.defaultView as (Window & typeof globalThis) | null | undefined
    const runtime = view ?? globalThis
    if (
      typeof runtime.MutationObserver !== 'function' ||
      typeof runtime.requestAnimationFrame !== 'function' ||
      typeof runtime.cancelAnimationFrame !== 'function'
    ) {
      throw Error('DOM fact observation is unavailable')
    }
    requestFrame = runtime.requestAnimationFrame.bind(runtime)
    cancelFrame = runtime.cancelAnimationFrame.bind(runtime)
    const epoch = ++generation
    observer = new runtime.MutationObserver(() => {
      if (active && epoch === generation) refresh()
    })
    try {
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: attributes.length > 0,
        ...(attributes.length ? { attributeFilter: attributes } : {}),
      })
      active = true
      refresh(true)
    } catch (error) {
      stop()
      throw error
    }
  }
  return { start, refresh, stop }
}
