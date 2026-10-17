import { expect, test } from 'bun:test'
import { createArchiveReadingScroll } from './archive-reading-scroll'

const input = (isTrusted = true) => ({ isTrusted, type: 'wheel' }) as Event
test('only user scrolling starts edge loads and concurrent/anchor scroll events cannot create a backlog', async () => {
  const viewport = { scrollTop: 750, scrollHeight: 1000, clientHeight: 200 } as HTMLElement
  const calls: string[] = []
  let finish: () => void = () => undefined
  const driver = createArchiveReadingScroll({
    viewport: () => viewport,
    enabled: () => true,
    canLoad: () => true,
    load: (direction) => {
      calls.push(direction)
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    },
  })
  await driver.onScroll()
  driver.onUserInput(input(false))
  await driver.onScroll()
  expect(calls).toEqual([])
  driver.onUserInput(input())
  const pending = driver.onScroll()
  driver.onUserInput(input())
  await driver.onScroll()
  expect(calls).toEqual(['newer'])
  finish()
  await pending
  await driver.onScroll()
  expect(calls).toHaveLength(1)
  viewport.scrollTop = 20
  driver.onUserInput(input())
  const reverse = driver.onScroll()
  expect(calls).toEqual(['newer', 'older'])
  finish()
  await reverse
})
test('reverse reading order and cancelled input use the same source edges', async () => {
  const calls: string[] = []
  const driver = createArchiveReadingScroll({
    viewport: () => ({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }) as HTMLElement,
    enabled: () => true,
    order: () => 'reverse',
    canLoad: () => true,
    load: async (direction) => {
      calls.push(direction)
    },
  })
  driver.onUserInput(input())
  driver.reset()
  await driver.onScroll()
  expect(calls).toEqual([])
  driver.onUserInput(input())
  await driver.onScroll()
  expect(calls).toEqual(['newer'])
})
test('a retained visible record anchors prepend/trim without relying on total scroll height', () => {
  let top = 90
  const node = {
    getAttribute: () => 'opaque-source-key',
    getBoundingClientRect: () => ({ top, bottom: top + 80 }),
  }
  const viewport = {
    scrollTop: 500,
    getBoundingClientRect: () => ({ top: 100, bottom: 300 }),
    querySelectorAll: () => [node],
  } as unknown as HTMLElement
  const driver = createArchiveReadingScroll({
    viewport: () => viewport,
    enabled: () => true,
    canLoad: () => false,
    load: async () => undefined,
  })
  const anchor = driver.capture()
  expect(anchor?.offset).toBe(-10)
  top += 1600
  expect(driver.restore(anchor)).toBe(true)
  expect(viewport.scrollTop).toBe(2100)
  expect(driver.restore(null)).toBe(false)
})
