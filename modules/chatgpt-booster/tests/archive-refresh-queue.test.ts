import { expect, test } from 'bun:test'
import { createArchiveRefreshQueue } from '../packages/ui/src/archive-refresh-queue'

test('continuous commits refresh before the burst ends and async reads never overlap', async () => {
  let running = 0,
    maximum = 0,
    refreshed = 0
  const queue = createArchiveRefreshQueue(async () => {
    running++
    maximum = Math.max(maximum, running)
    await new Promise((resolve) => setTimeout(resolve, 4))
    refreshed++
    running--
  }, 5)
  try {
    for (let event = 0; event < 24; event++) {
      queue.request()
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    expect(refreshed).toBeGreaterThan(0)
    expect(maximum).toBe(1)
  } finally {
    queue.stop()
  }
})

test('unmount cancels a scheduled refresh', async () => {
  let refreshed = 0
  const queue = createArchiveRefreshQueue(() => {
    refreshed++
  }, 5)
  queue.request()
  queue.stop()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(refreshed).toBe(0)
})
