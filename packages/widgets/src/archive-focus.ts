import { ref } from 'vue'

export interface ArchiveFocusRect {
  top: number
  bottom: number
  height: number
}
export interface ArchiveFocusNode {
  key: string
  top: number
  bottom: number
}
export interface ArchiveFocusResult {
  key: string | null
  retainsPin: boolean
}

/** UI-only closest visible node; explicit graph selection wins while still on screen. */
export function selectArchiveFocus(
  bounds: ArchiveFocusRect,
  nodes: readonly ArchiveFocusNode[],
  pinned: string | null,
): ArchiveFocusResult {
  const visible = (node: ArchiveFocusNode) => node.bottom > bounds.top && node.top < bounds.bottom
  if (pinned) {
    const chosen = nodes.find((node) => node.key === pinned)
    if (chosen && visible(chosen)) return { key: pinned, retainsPin: true }
  }
  const anchorY = bounds.top + Math.min(140, bounds.height / 3)
  let key: string | null = null
  let distance = Infinity
  for (const node of nodes) {
    if (node.bottom < bounds.top || node.top > bounds.bottom) continue
    const offset = Math.abs(Math.max(bounds.top, node.top) - anchorY)
    if (offset < distance) {
      key = node.key
      distance = offset
    }
  }
  return { key, retainsPin: false }
}

/** Reusable Shadow DOM transcript focus controller. Never reads native host markup. */
export function useArchiveFocusTracker(viewport: () => HTMLElement | null, canTrack: () => boolean) {
  const activeMessageKey = ref<string | null>(null)
  let pinned: string | null = null
  let pendingFrame: number | null = null

  function track(): void {
    const element = viewport()
    if (!element || !canTrack()) return
    const rect = element.getBoundingClientRect()
    const candidates = [...element.querySelectorAll<HTMLElement>('[data-archive-node]')]
      .map((node) => {
        const bounds = node.getBoundingClientRect()
        return { key: node.dataset.archiveNode ?? '', top: bounds.top, bottom: bounds.bottom }
      })
      .filter((node) => node.key.length > 0)
    const next = selectArchiveFocus(rect, candidates, pinned)
    if (!next.retainsPin) pinned = null
    if (next.key !== null) activeMessageKey.value = next.key
  }
  function schedule(): void {
    if (pendingFrame !== null) return
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null
      track()
    })
  }
  function pin(key: string): void {
    pinned = key
    activeMessageKey.value = key
  }
  function reset(): void {
    pinned = null
    activeMessageKey.value = null
  }
  function dispose(): void {
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
    pendingFrame = null
  }
  return { activeMessageKey, schedule, pin, reset, dispose }
}
