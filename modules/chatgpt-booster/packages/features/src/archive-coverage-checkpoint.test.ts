import { expect, test } from 'bun:test'
import { encodeArchiveClone } from '@kobaproduction/browser-archive'
import {
  advanceHistoryCoverage,
  checkpointHistoryCoverage,
  type HistoryCoverageCheckpoint,
  type HistoryPageEvidence,
  validateHistoryCoverageCheckpoint,
} from './archive-coverage'

const page = (index: number, last = false): HistoryPageEvidence => ({
  readId: 'synthetic-long-read',
  readStartedAt: 1,
  observedAt: index + 1,
  isInitial: index === 0,
  requestedBefore: index === 0 ? null : `cursor-${index - 1}`,
  startCursor: `cursor-${index}`,
  endCursor: `end-${index}`,
  hasPreviousPage: !last,
  hasNextPage: index !== 0,
})
test('bounded checkpoint retains proof beyond the raw replay cap and stays portable', async () => {
  let checkpoint: HistoryCoverageCheckpoint | undefined
  for (let index = 0; index < 180; index++)
    checkpoint = advanceHistoryCoverage(checkpoint, page(index, index === 179))
  expect(checkpointHistoryCoverage(checkpoint)).toMatchObject({
    verified: true,
    pageCount: 180,
    readId: 'synthetic-long-read',
  })
  expect(checkpoint?.pending).toHaveLength(0)
  expect(checkpoint?.recentCursors).toHaveLength(96)
  validateHistoryCoverageCheckpoint(checkpoint)
  expect(await encodeArchiveClone(checkpoint)).toBeDefined()
})
test('checkpoint connects out-of-order pages but cannot prove missing, foreign or repeated cursor evidence', () => {
  let checkpoint = advanceHistoryCoverage(undefined, page(0))
  checkpoint = advanceHistoryCoverage(checkpoint, page(2, true))
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(false)
  checkpoint = advanceHistoryCoverage(checkpoint, { ...page(1), readId: 'foreign' })
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(false)
  checkpoint = advanceHistoryCoverage(checkpoint, page(1))
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(true)
  const repeated = advanceHistoryCoverage(advanceHistoryCoverage(undefined, page(0)), {
    ...page(1, true),
    startCursor: 'cursor-0',
  })
  expect(checkpointHistoryCoverage(repeated).verified).toBe(false)
  expect(repeated?.blocked).toBe(true)
})
test('manual acknowledgement must rebuild the entire selected read instead of reusing an automatic tail', () => {
  let checkpoint = advanceHistoryCoverage(undefined, page(0))
  checkpoint = advanceHistoryCoverage(checkpoint, page(1, true))
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(true)
  checkpoint = advanceHistoryCoverage(checkpoint, { ...page(0), captureRun: 'manual-run' })
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(false)
  checkpoint = advanceHistoryCoverage(checkpoint, { ...page(1, true), captureRun: 'manual-run' })
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(true)
  expect(() => validateHistoryCoverageCheckpoint({ ...checkpoint, recentCursors: [null] })).toThrow(
    'checkpoint',
  )
})
test('a stronger same-read initial observation enriches existing chain proof without losing its frontier', () => {
  let checkpoint = advanceHistoryCoverage(undefined, { ...page(0), hasNextPage: null })
  checkpoint = advanceHistoryCoverage(checkpoint, page(1, true))
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(false)
  checkpoint = advanceHistoryCoverage(checkpoint, { ...page(0), observedAt: 10 })
  expect(checkpointHistoryCoverage(checkpoint)).toMatchObject({
    verified: true,
    pageCount: 2,
    oldestCursor: 'cursor-1',
  })
  checkpoint = advanceHistoryCoverage(checkpoint, { ...page(0), observedAt: 11, hasNextPage: null })
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(true)
  checkpoint = advanceHistoryCoverage(checkpoint, { ...page(0), observedAt: 12, hasNextPage: true })
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(false)
})
test('a newer current-frontier correction revokes terminal proof until its next page is linked', () => {
  let checkpoint = advanceHistoryCoverage(undefined, page(0))
  checkpoint = advanceHistoryCoverage(checkpoint, page(1, true))
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(true)
  checkpoint = advanceHistoryCoverage(checkpoint, { ...page(1), observedAt: 10 })
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(false)
  checkpoint = advanceHistoryCoverage(checkpoint, page(2, true))
  expect(checkpointHistoryCoverage(checkpoint).verified).toBe(true)
})
