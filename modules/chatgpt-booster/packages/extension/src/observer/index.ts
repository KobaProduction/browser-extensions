import { installTransportObserver, TRANSPORT_CHANNEL } from '@chatgpt-booster/observer'

// The MAIN world entry is passive until its matching isolated content script
// explicitly enables this compiled product/channel instance. Toggling off
// disposes the observer without reloading the page or touching IndexedDB.
let detach: (() => void) | null = null
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== location.origin) return
  const payload = event.data as { channel?: unknown; type?: unknown } | null
  if (payload?.channel !== TRANSPORT_CHANNEL) return
  if (payload.type === 'koba:observer:enable' && !detach) {
    detach = installTransportObserver(window)
  } else if (payload.type === 'koba:observer:disable') {
    detach?.()
    detach = null
  }
})
