import { expect, test } from 'bun:test'
import { ARCHIVE_PRELOAD_EVENT, installTransportObserver } from '@chatgpt-booster/observer'

class SyntheticXhr extends EventTarget {
  open() {}
  send() {}
}

test('native full history reaches the archive observer with transport diagnostics off', async () => {
  const location = new URL('https://chatgpt.com/c/mock-native-graph')
  const previous = globalThis.location
  Object.assign(globalThis, { location })
  const events: { type?: string; detail?: { nativeGraph?: unknown } }[] = []
  const target = Object.assign(new EventTarget(), {
    location,
    XMLHttpRequest: SyntheticXhr,
    fetch: async () =>
      Response.json({ conversation_id: 'mock-native-graph', current_node: null, mapping: {} }),
    WebSocket: class {},
    EventSource: class {},
    postMessage: (event: (typeof events)[number]) => events.push(event),
  }) as unknown as Window & typeof globalThis
  const dispose = installTransportObserver(target)
  try {
    await target.fetch('https://chatgpt.com/backend-api/conversation/mock-native-graph')
    await Bun.sleep(0)
    expect(
      events.find((event) => event.type === ARCHIVE_PRELOAD_EVENT)?.detail?.nativeGraph,
    ).toMatchObject({
      schema: 'chatgpt-native-graph.v1',
      nodes: {},
    })
  } finally {
    dispose()
    Object.assign(globalThis, { location: previous })
  }
})
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
