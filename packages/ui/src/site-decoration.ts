import { shellInstanceKey } from '@kobaproduction/browser-core'

export interface SiteDecoration {
  readonly element: HTMLElement
  unmount(): void
}

export interface SiteDecorationOptions<T extends SiteDecoration> {
  anchor: HTMLElement
  kind: string
  /** Compiled installation identity by default; never derive this from page data. */
  scope?: string
  identity?: string
  placement?: 'append' | 'before'
  /** Only direct injected siblings/children are considered; never native descendants. */
  legacySelector?: string
  /** Recognizes old injected siblings while looking backwards from the anchor. */
  legacyBoundarySelector?: string
  create(): T
  update(current: T): void
}

const registryKey = Symbol.for('koba.browser-ui.site-decorations.v1')
type Entry = { identity?: string; controller: SiteDecoration }
type Anchor = HTMLElement & { [registryKey]?: Map<string, Entry> }

/** DOM-owned registry survives repeated module/bootstrap instances on the same page. */
export function ensureSiteDecoration<T extends SiteDecoration>(options: SiteDecorationOptions<T>): T {
  const { anchor, kind, identity, legacySelector } = options
  const placement = options.placement ?? 'append'
  const scope = options.scope ?? shellInstanceKey('site-decoration')
  const key = `${scope}:${kind}`
  const owner = anchor as Anchor
  owner[registryKey] ??= new Map()
  const registry = owner[registryKey]
  let entry = registry.get(key)
  const injected = (node: Element) =>
    node.hasAttribute('data-site-decoration') ||
    Boolean(options.legacyBoundarySelector && node.matches(options.legacyBoundarySelector))
  const placed = (host: HTMLElement) => {
    if (placement === 'append') return host.parentElement === anchor
    let next = host.nextElementSibling
    while (next && next !== anchor && injected(next)) next = next.nextElementSibling
    return host.parentElement !== null && next === anchor
  }
  if (entry && (entry.identity !== identity || !placed(entry.controller.element))) {
    entry.controller.unmount()
    registry.delete(key)
    entry = undefined
  }
  const candidates: Element[] = []
  if (placement === 'append') candidates.push(...anchor.children)
  else {
    let sibling = anchor.previousElementSibling
    while (sibling && injected(sibling)) {
      candidates.push(sibling)
      sibling = sibling.previousElementSibling
    }
  }
  for (const candidate of candidates) {
    if (candidate === entry?.controller.element) continue
    const candidateScope = candidate.getAttribute('data-site-decoration-scope')
    if (candidateScope !== null && candidateScope !== scope) continue
    if (
      candidate.getAttribute('data-site-decoration') === kind ||
      (legacySelector && candidate.matches(legacySelector))
    )
      candidate.remove()
  }
  if (entry) {
    const current = entry.controller as T
    options.update(current)
    return current
  }
  const current = options.create()
  current.element.setAttribute('data-site-decoration', kind)
  current.element.setAttribute('data-site-decoration-scope', scope)
  const dispose = current.unmount.bind(current)
  let disposed = false
  current.unmount = () => {
    if (disposed) return
    disposed = true
    if (registry.get(key)?.controller === current) registry.delete(key)
    dispose()
  }
  registry.set(key, { identity, controller: current })
  return current
}
