/** Elevate registry portals out of the native anchor's stacking/clipping context. */
export function attachPortalTopLayer(portal: HTMLElement): () => void {
  if (typeof portal.showPopover !== 'function') return () => undefined
  portal.setAttribute('popover', 'manual')
  // This is a zero-sized portal container, not a second UI surface.
  Object.assign(portal.style, { margin: '0', padding: '0', border: '0', background: 'transparent' })
  const sync = () => {
    if (!portal.isConnected) return
    const visible = portal.matches(':popover-open')
    if (portal.childElementCount && !visible) portal.showPopover()
    else if (!portal.childElementCount && visible) portal.hidePopover()
  }
  const observer = new MutationObserver(sync)
  observer.observe(portal, { childList: true })
  sync()
  return () => {
    observer.disconnect()
    if (portal.matches(':popover-open')) portal.hidePopover()
  }
}
