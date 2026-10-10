import type { ConversationSubmissionSelection } from '@chatgpt-booster/observer'
import {
  type ArchiveSourceGate,
  type ArchiveSubmissionSnapshot,
  sameSubmissionSelection,
} from './archive-source-contract'
import type { ArchiveV4Metadata } from './archive-v4-entities'
import { key } from './archive-v4-identities'

/** All selection evidence is written in the SAME native-history write transaction. */
export function writeArchiveSubmissionEvidence({
  metadata,
  submissions,
  previousSubmissions,
  sourceGate,
  conversationId,
  observedAt,
}: {
  metadata: IDBObjectStore
  submissions: readonly (ArchiveSubmissionSnapshot & { ownerKey: string })[]
  previousSubmissions: readonly (ArchiveV4Metadata | undefined)[]
  sourceGate: ArchiveSourceGate
  conversationId: string
  observedAt: number
}): boolean {
  let submissionChanged = false
  for (let i = 0; i < submissions.length; i++) {
    const item = submissions[i]
    if (!item) continue
    const previous = previousSubmissions[i]
    if (
      previous &&
      (previous.ownerType !== 'message' ||
        previous.ownerKey !== item.ownerKey ||
        previous.kind !== 'submission-selection' ||
        typeof previous.payload.conflicted !== 'boolean')
    )
      throw new Error('archive.error.sourceChanged')
    if (previous?.payload.conflicted === true) continue
    const old = previous?.payload.selection as ConversationSubmissionSelection | undefined
    if (old) sourceGate.inspectSubmissionSelection(conversationId, old)
    if (old && !item.conflicted && sameSubmissionSelection(old, item.selection)) continue
    metadata.put({
      key: key(item.ownerKey, 'submission-selection'),
      ownerType: 'message',
      ownerKey: item.ownerKey,
      kind: 'submission-selection',
      observedAt,
      payload: previous
        ? { selection: old, conflictingSelection: item.selection, conflicted: true }
        : { selection: item.selection, conflicted: item.conflicted },
    } satisfies ArchiveV4Metadata)
    submissionChanged = true
  }
  return submissionChanged
}
