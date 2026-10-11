import { expect, test } from 'bun:test'
import { type ChatCollectionSnapshot, createChatCollectionController } from './chat-collection'

const idle: ChatCollectionSnapshot = { phase: 'idle', processed: 0, total: null, saved: null }
test('provider-neutral collection shares a single run and forwards progress', async () => {
  let resolve!: () => void
  let calls = 0
  let listen!: (s: ChatCollectionSnapshot) => void
  const port = {
    start: () => {
      calls++
      return new Promise<void>((done) => {
        resolve = done
      })
    },
    stop: () => {},
    snapshot: () => idle,
    subscribe: (cb: (s: ChatCollectionSnapshot) => void) => {
      listen = cb
      return () => {}
    },
  }
  const controller = createChatCollectionController(port)
  const states: ChatCollectionSnapshot[] = []
  controller.subscribe((s) => states.push(s))
  const first = controller.start(),
    second = controller.start()
  await Promise.resolve()
  expect(calls).toBe(1)
  expect(first).toBe(second)
  listen({ phase: 'running', processed: 20, total: 50, saved: 10 })
  expect(controller.snapshot().processed).toBe(20)
  resolve()
  await first
  expect(controller.snapshot().phase).toBe('completed')
  expect(states.length).toBeGreaterThan(1)
  controller.dispose()
})
test('cancellation never starts a second simultaneous run or claims completion', async () => {
  let done!: () => void,
    stops = 0
  const controller = createChatCollectionController({
    start: () =>
      new Promise<void>((resolve) => {
        done = resolve
      }),
    stop: () => {
      stops++
    },
    snapshot: () => idle,
    subscribe: () => () => {},
  })
  const task = controller.start()
  await Promise.resolve()
  controller.stop()
  expect(stops).toBe(1)
  expect(controller.snapshot().phase).toBe('cancelled')
  done()
  await task
  expect(controller.snapshot().phase).toBe('cancelled')
  controller.dispose()
  await expect(controller.start()).rejects.toThrow('disposed')
})

test('asynchronous background collection is not falsely completed when start resolves', async () => {
  let observe!: (s: ChatCollectionSnapshot) => void
  const controller = createChatCollectionController({
    completion: 'by-event',
    start: async () => undefined,
    stop: () => undefined,
    snapshot: () => idle,
    subscribe: (listener) => {
      observe = listener
      return () => undefined
    },
  })
  await controller.start()
  expect(controller.snapshot().phase).toBe('running')
  observe({ phase: 'completed', processed: 7, total: null, saved: 5 })
  expect(controller.snapshot()).toEqual({ phase: 'completed', processed: 7, total: null, saved: 5 })
  controller.dispose()
})
