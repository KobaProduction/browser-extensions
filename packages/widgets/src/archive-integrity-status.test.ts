import { expect, test } from 'bun:test'
import { conversationIntegrityFromGraph } from '@kobaproduction/browser-archive'
import { archiveIntegrityStatus } from './archive-integrity-status'

const verified = conversationIntegrityFromGraph(
  [
    { id: 'first', parentId: null, parentKnown: true },
    { id: 'last', parentId: 'first', parentKnown: true },
  ],
  { startReached: true, endReached: true, headId: 'last' },
)

test('complete needs source coverage, both boundaries and a verified chain', () => {
  expect(archiveIntegrityStatus({ integrity: verified, complete: true }).state).toBe('complete')
  expect(archiveIntegrityStatus({ integrity: verified, complete: false }).state).toBe('unknown')
  expect(archiveIntegrityStatus({ complete: true }).state).toBe('unknown')
  expect(
    archiveIntegrityStatus({ integrity: verified, complete: true, hasOlderHistory: true }),
  ).toMatchObject({ state: 'partial', missingStart: true })
})

test('unknown start is not a proven missing message', () => {
  const integrity = conversationIntegrityFromGraph(
    [{ id: 'fragment', parentId: null, parentKnown: false }],
    { startReached: false, endReached: false, headId: null },
  )
  expect(archiveIntegrityStatus({ integrity })).toMatchObject({
    state: 'unknown',
    start: 'unknown',
    missingStart: false,
    gaps: 0,
  })
})

test('missing native parent and missing head remain visible even if coverage claims complete', () => {
  const integrity = conversationIntegrityFromGraph(
    [{ id: 'fragment', parentId: 'absent', parentKnown: true }],
    { startReached: false, endReached: true, headId: 'missing-head' },
  )
  expect(archiveIntegrityStatus({ integrity, complete: true })).toMatchObject({
    state: 'partial',
    gaps: 2,
    missingEnd: true,
  })
})

test('a missing start and middle gaps are independently represented', () => {
  const integrity = {
    ...verified,
    chain: 'gaps' as const,
    issues: [{ messageId: 'last', parentId: 'absent', reason: 'missing-parent' as const }],
  }
  expect(archiveIntegrityStatus({ integrity, hasOlderHistory: true })).toMatchObject({
    state: 'partial',
    missingStart: true,
    gaps: 1,
  })
})

test('loading and failed checks never retain a stale complete indicator', () => {
  expect(archiveIntegrityStatus({ integrity: verified, complete: true, loading: true }).state).toBe(
    'loading',
  )
  expect(archiveIntegrityStatus({ integrity: verified, complete: true, error: true }).state).toBe(
    'error',
  )
})
