import { expect, test } from 'bun:test'
import type {
  ArchiveSourceGate,
  ArchiveSubmissionSnapshot,
} from '../packages/features/src/archive-source-contract'
import type { ArchiveV4Metadata } from '../packages/features/src/archive-v4-entities'
import { writeArchiveSubmissionEvidence } from '../packages/features/src/archive-v4-submission-write'

function evidence(selectionName: string, conflicted = false) {
  return {
    ownerKey: 'message-key',
    conflicted,
    selection: {
      messageId: 'msg',
      requestedModel: selectionName,
      effortPresent: false,
      thinkingEffort: null,
    },
  } as unknown as ArchiveSubmissionSnapshot & { ownerKey: string }
}
function exercise(previous?: ArchiveV4Metadata, current = evidence('model-one')) {
  const writes: ArchiveV4Metadata[] = []
  const sourceGate = { inspectSubmissionSelection() {} } as unknown as ArchiveSourceGate
  const changed = writeArchiveSubmissionEvidence({
    metadata: {
      put: (value: ArchiveV4Metadata) => {
        writes.push(value)
      },
    } as unknown as IDBObjectStore,
    submissions: [current],
    previousSubmissions: [previous],
    sourceGate,
    conversationId: 'chat',
    observedAt: 5,
  })
  return { changed, writes }
}
test('new selection is saved as message-owner evidence within caller transaction', () => {
  const result = exercise()
  expect(result.changed).toBe(true)
  expect(result.writes[0]?.kind).toBe('submission-selection')
  expect(result.writes[0]?.ownerKey).toBe('message-key')
  expect(result.writes[0]?.payload.conflicted).toBe(false)
})
test('conflicting selection becomes durable conflict and cannot silently overwrite prior proof', () => {
  const initial = exercise().writes[0]
  if (!initial) throw Error('missing synthetic evidence')
  const conflict = exercise(initial, evidence('model-two'))
  expect(conflict.changed).toBe(true)
  expect(conflict.writes[0]?.payload.conflicted).toBe(true)
  expect(conflict.writes[0]?.payload.selection).toEqual(initial.payload.selection)
  const sticky = exercise(conflict.writes[0], evidence('model-one'))
  expect(sticky.changed).toBe(false)
  expect(sticky.writes).toEqual([])
})
