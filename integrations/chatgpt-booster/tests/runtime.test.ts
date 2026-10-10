import { expect, test } from 'bun:test'
import { type BoosterModule, BoosterRuntime } from '../packages/core/src/runtime'

test('runtime starts independent modules concurrently and only once', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered: string[] = []
  const starts = new Map<string, number>()

  const module = (id: string): BoosterModule => ({
    id,
    async start() {
      starts.set(id, (starts.get(id) ?? 0) + 1)
      entered.push(id)
      await gate
    },
    stop() {},
  })

  const runtime = new BoosterRuntime([module('a'), module('b'), module('c')])
  const first = runtime.start()
  const second = runtime.start()
  await Promise.resolve()

  expect(new Set(entered)).toEqual(new Set(['a', 'b', 'c']))
  release?.()
  await Promise.all([first, second])

  expect(starts).toEqual(
    new Map([
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ]),
  )
})

test('runtime waits for an in-flight start before stopping in reverse order', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const stopped: string[] = []
  const modules: BoosterModule[] = ['a', 'b', 'c'].map((id) => ({
    id,
    async start() {
      await gate
    },
    stop() {
      stopped.push(id)
    },
  }))

  const runtime = new BoosterRuntime(modules)
  const starting = runtime.start()
  const stopping = runtime.stop()
  release?.()
  await Promise.all([starting, stopping])

  expect(stopped).toEqual(['c', 'b', 'a'])
})
