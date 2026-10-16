/** DOM is only a mounting target; application state comes from provider events. */
export interface SiteInjectionTarget {
  readonly id: string
  readonly selectors: readonly string[]
  readonly enabled?: () => boolean
  readonly accepts?: (element: HTMLElement) => boolean
  /** Return cleanup for all controls/subscriptions mounted at this target. */
  mount(element: HTMLElement): () => void
}
export interface SiteInjectionSchema {
  readonly targets: readonly SiteInjectionTarget[]
  readonly root?: Document | HTMLElement
  readonly onUnavailable?: (targetId: string) => void
}
export interface SiteInjector {
  refresh(): void
  stop(): void
}

/** One observer reconciles declarative mounts across native-site SPA changes. */
export function createSiteInjector(schema: SiteInjectionSchema): SiteInjector {
  const root = schema.root ?? document
  const mounted = new Map<string, { element: HTMLElement; cleanup: () => void }>()
  const ids = new Set<string>()
  for (const target of schema.targets) {
    if (!target.id || ids.has(target.id)) throw Error('Duplicate site injection target')
    ids.add(target.id)
  }
  let stopped = false
  let scheduled = false
  function detach(id: string) {
    const current = mounted.get(id)
    mounted.delete(id)
    try {
      current?.cleanup()
    } catch {
      /* A stale site mount cannot stop other targets. */
    }
  }
  function refresh() {
    if (stopped) return
    for (const target of schema.targets) {
      let next: HTMLElement | undefined
      if (target.enabled?.() !== false) {
        for (const selector of target.selectors) {
          next = [...root.querySelectorAll<HTMLElement>(selector)].find(
            (element) => element.isConnected && target.accepts?.(element) !== false,
          )
          if (next) break
        }
      }
      if (mounted.get(target.id)?.element === next) continue
      detach(target.id)
      if (!next) {
        schema.onUnavailable?.(target.id)
        continue
      }
      try {
        mounted.set(target.id, { element: next, cleanup: target.mount(next) })
      } catch {
        schema.onUnavailable?.(target.id)
      }
    }
  }
  const observer = new MutationObserver(() => {
    if (scheduled || stopped) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      refresh()
    })
  })
  observer.observe(root, { subtree: true, childList: true })
  refresh()
  return {
    refresh,
    stop() {
      if (stopped) return
      stopped = true
      observer.disconnect()
      for (const id of [...mounted.keys()]) detach(id)
    },
  }
}
