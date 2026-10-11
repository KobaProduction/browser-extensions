import { expect, test } from 'bun:test'
import { installTransportObserver } from '@chatgpt-booster/observer'

class SyntheticXhr extends EventTarget {
  open() {}
  send() {}
}
test('MAIN-world hook installation is reversible without page reload or deleting source storage', () => {
  const windowLike = Object.assign(new EventTarget(), {
    location: new URL('https://chatgpt.com/c/synthetic'),
    XMLHttpRequest: SyntheticXhr,
    fetch: (_input: RequestInfo | URL) => Promise.resolve(new Response('{}')),
    WebSocket: class {},
    EventSource: class {},
    postMessage: () => {},
  }) as unknown as Window & typeof globalThis

  const originalFetch = windowLike.fetch
  const originalOpen = windowLike.XMLHttpRequest.prototype.open
  const originalSend = windowLike.XMLHttpRequest.prototype.send
  const dispose = installTransportObserver(windowLike)
  expect(windowLike.fetch).not.toBe(originalFetch)
  expect(windowLike.XMLHttpRequest.prototype.open).not.toBe(originalOpen)
  expect(windowLike.XMLHttpRequest.prototype.send).not.toBe(originalSend)
  // Installing the same scope twice must not add duplicate wrappers.
  const duplicate = installTransportObserver(windowLike)
  duplicate()
  dispose()
  expect(windowLike.fetch).toBe(originalFetch)
  expect(windowLike.XMLHttpRequest.prototype.open).toBe(originalOpen)
  expect(windowLike.XMLHttpRequest.prototype.send).toBe(originalSend)
  // Restart must install an independent fresh observation lifecycle.
  const restart = installTransportObserver(windowLike)
  expect(windowLike.fetch).not.toBe(originalFetch)
  restart()
  expect(windowLike.fetch).toBe(originalFetch)
})
