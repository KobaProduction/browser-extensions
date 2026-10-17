export type ArchiveReadingScrollDirection = 'older' | 'newer'
export interface ArchiveReadingAnchor {
  id: string
  attribute: 'data-archive-node' | 'data-archive-message'
  offset: number
}
export interface ArchiveReadingScrollOptions {
  viewport: () => HTMLElement | null
  enabled: () => boolean
  order?: () => 'chronological' | 'reverse'
  canLoad: (direction: ArchiveReadingScrollDirection) => boolean
  load: (direction: ArchiveReadingScrollDirection) => Promise<void>
}

/** Shared user-driven edge loading and stable DOM anchoring, independent of storage. */
export function createArchiveReadingScroll(options: ArchiveReadingScrollOptions) {
  let inputPending = false
  let running = false
  let generation = 0
  function capture(
    attribute: ArchiveReadingAnchor['attribute'] = 'data-archive-node',
  ): ArchiveReadingAnchor | null {
    const viewport = options.viewport()
    if (!viewport) return null
    const bounds = viewport.getBoundingClientRect()
    const node = [...viewport.querySelectorAll<HTMLElement>(`[${attribute}]`)].find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    const id = node?.getAttribute(attribute)
    return node && id ? { id, attribute, offset: node.getBoundingClientRect().top - bounds.top } : null
  }
  function restore(anchor: ArchiveReadingAnchor | null): boolean {
    const viewport = options.viewport()
    if (!viewport || !anchor) return false
    const node = [...viewport.querySelectorAll<HTMLElement>(`[${anchor.attribute}]`)].find(
      (element) => element.getAttribute(anchor.attribute) === anchor.id,
    )
    if (!node) return false
    viewport.scrollTop +=
      node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset
    return true
  }
  function onUserInput(event: Event) {
    if (!event.isTrusted) return
    if (
      event.type === 'keydown' &&
      !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(
        (event as KeyboardEvent).key,
      )
    )
      return
    if (event.type === 'pointermove' && !(event as PointerEvent).buttons) return
    inputPending = true
  }
  async function onScroll(): Promise<void> {
    const requested = inputPending
    inputPending = false
    const viewport = options.viewport()
    if (!requested || running || !options.enabled() || !viewport) return
    const atTop = viewport.scrollTop < 100
    const atBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 100
    const chronological = options.order?.() !== 'reverse'
    const olderEdge = chronological ? atTop : atBottom
    const newerEdge = chronological ? atBottom : atTop
    const direction =
      olderEdge && options.canLoad('older')
        ? 'older'
        : newerEdge && options.canLoad('newer')
          ? 'newer'
          : null
    if (!direction) return
    const ticket = generation
    running = true
    try {
      await options.load(direction)
    } finally {
      if (ticket === generation) running = false
    }
  }
  function reset() {
    generation++
    inputPending = false
    running = false
  }
  return { capture, restore, onUserInput, onScroll, reset }
}
