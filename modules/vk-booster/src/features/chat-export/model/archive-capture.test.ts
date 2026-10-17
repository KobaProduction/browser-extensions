import { expect, test } from 'bun:test'
import { createVkArchiveCapture } from './archive-capture'
import type { VkHistoryCoverage } from './archive-fixed-dexie'
import type { VkArchiveSession } from './archive-session'
import { sameVkSourceValue } from './source-value'
import type { VkCaptureEvidence, VkMessage } from './types'

function fixture(overlap = false) {
  const raw = Array.from({ length: 20 }, (_, index) => ({
    id: 1000 - index * 7,
    date: 1700000000,
    peer_id: 42,
    text: `synthetic${index}`,
  }))
  const saved = new Map<number, VkMessage>()
  let proof: VkHistoryCoverage | undefined
  let evidence: VkCaptureEvidence | undefined,
    revision = 0
  const state = { busy: false, backupRunning: false, stopRequested: false, disposed: false }
  const repository = {
    scope: { ownerId: 'synthetic-owner' },
    getOriginal: async (_peer: number, id: number) =>
      saved.has(id) ? { raw: saved.get(id) } : undefined,
    addOriginal: async (_peer: number, message: VkMessage) => {
      saved.set(message.id, message)
    },
    observeOriginal: async (_peer: number, message: VkMessage) => {
      const old = saved.get(message.id)
      if (old && sameVkSourceValue(old, message)) return 'unchanged'
      saved.set(message.id, message)
      return old ? 'revised' : 'saved'
    },
    historyCoverage: async () => proof,
    recordHistoryCoverage: async (_peer: number, value: VkHistoryCoverage) => {
      proof = value
      return true
    },
    close() {},
  }
  const session = {
    state,
    cfg: { peerId: 42, pageSize: 10, delay: 300 },
    currentPeer: () => 42,
    auth: async () => true,
    history: async (offset: number, count: number) => ({
      count: 20,
      items: overlap && offset === 10 ? raw.slice(9, 19) : raw.slice(offset, offset + count),
    }),
    openFixedArchive: async () => repository,
    verifyOwner: async () => {},
    progress() {},
    sleep: async () => {},
    refresh() {},
    archiveChanges: {
      revision: () => revision,
      publish: () => {
        revision++
      },
    },
    setCaptureEvidence: (value: VkCaptureEvidence | undefined) => {
      evidence = value
    },
  }
  return {
    capture: createVkArchiveCapture(session as unknown as VkArchiveSession),
    saved,
    state,
    evidence: () => evidence,
  }
}
test('full VK scan proves observed boundaries without assuming consecutive message IDs', async () => {
  const run = fixture()
  expect(await run.capture.captureFixed('all')).toMatchObject({
    saved: 20,
    available: 20,
    complete: true,
  })
  expect(run.evidence()).toMatchObject({
    firstId: 867,
    lastId: 1000,
    startReached: true,
    endReached: true,
    countStable: true,
  })
  expect(run.state.busy).toBe(false)
})
test('overlapping VK history pages are deduplicated and the missing tail is fetched', async () => {
  const run = fixture(true)
  expect(await run.capture.captureFixed('all')).toMatchObject({ complete: true, saved: 20 })
  expect(run.saved.size).toBe(20)
  expect(run.evidence()?.startReached).toBe(true)
  expect(run.state.busy).toBe(false)
})
test('field-order differences do not block backfill and changed sources use explicit observation revisions', async () => {
  const run = fixture()
  await run.capture.captureFixed(10)
  for (const [id, value] of run.saved)
    run.saved.set(id, { text: value.text, peer_id: value.peer_id, date: value.date, id: value.id })
  expect(await run.capture.captureFixed('all')).toMatchObject({
    saved: 10,
    alreadySaved: 10,
    complete: true,
  })
  const original = run.saved.get(1000)
  if (!original) throw Error('Missing synthetic source')
  run.saved.set(1000, { ...original, text: 'different source' })
  expect(await run.capture.captureFixed('all')).toMatchObject({ updated: 1, complete: true })
  expect(run.saved.size).toBe(20)
})
