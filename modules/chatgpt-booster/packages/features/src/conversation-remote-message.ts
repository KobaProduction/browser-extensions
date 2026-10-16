import {
  type ArchiveCloneNode,
  type ArchiveMessageV1,
  decodeArchiveClone,
} from '@kobaproduction/browser-archive'
import type { PortableBackupRow, ServiceScope } from '@kobaproduction/browser-storage'
import type { FixedSnapshot, FixedSourceVersion, SourceObservation } from './archive-fixed-dexie'
import { readChatGptArchiveMessage } from './archive-message-adapter'

/** Consumer of the common model; provider source adaptation stays in its owning adapter. */
export function normalizedRemoteObservation(
  observation: SourceObservation,
  scope: ServiceScope,
  stored?: ArchiveMessageV1,
): ArchiveMessageV1 {
  if (scope.productId !== 'chatgpt-booster' || !scope.ownerId || observation.accountId !== scope.ownerId)
    throw Error('Remote message scope mismatch')
  return readChatGptArchiveMessage(
    observation.raw,
    {
      ownerId: scope.ownerId,
      conversationId: observation.conversationId,
      sourceKind: observation.sourceKind,
      sourceVersion: observation.sourceVersion,
      observedAtMs: observation.observedAtMs,
      projectId: observation.projectId ?? null,
      variantIndex: stored?.source.variantIndex ?? null,
    },
    stored,
  )
}

/** Read one immutable provider backup snapshot at a time; no full archive materialization. */
export async function* normalizedRemoteSnapshotRows(
  row: PortableBackupRow,
  scope: ServiceScope,
  readSavedProjectId: (conversationId: string) => Promise<string | null>,
): AsyncIterable<PortableBackupRow> {
  if (row.store !== 'snapshots') return
  if (scope.productId !== 'chatgpt-booster' || !scope.ownerId)
    throw Error('Remote snapshot scope mismatch')
  const tuple: unknown = JSON.parse(row.key)
  if (
    !Array.isArray(tuple) ||
    tuple.length !== 3 ||
    tuple.some((value) => typeof value !== 'string' || !value) ||
    JSON.stringify(tuple) !== row.key ||
    tuple[0] !== scope.ownerId
  )
    throw Error('Invalid remote source snapshot identity')
  const value = decodeArchiveClone(row.value as ArchiveCloneNode)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid remote source snapshot')
  const snapshot = value as FixedSnapshot
  if (snapshot.accountId !== scope.ownerId || snapshot.messageKey !== row.key)
    throw Error('Remote source snapshot owner mismatch')
  const conversationId = tuple[1] as string,
    messageId = tuple[2] as string
  const ownerId = scope.ownerId
  const projectId =
    snapshot.projectId === undefined ? await readSavedProjectId(conversationId) : snapshot.projectId
  const project = (
    source: Pick<
      FixedSourceVersion,
      'raw' | 'sourceKind' | 'sourceVersion' | 'observedAtMs' | 'normalized'
    >,
    variantIndex: number | null,
  ) => {
    const message = readChatGptArchiveMessage(
      source.raw,
      {
        ownerId,
        conversationId,
        sourceKind: source.sourceKind,
        sourceVersion: source.sourceVersion,
        observedAtMs: source.observedAtMs,
        projectId,
        variantIndex,
      },
      source.normalized,
    )
    if (message.identity.messageId !== messageId || message.source.snapshotKey !== row.key)
      throw Error('Remote normalized message source mismatch')
    return message
  }
  const preferred = project(snapshot, null)
  yield { store: 'messages', key: preferred.key, value: preferred }
  if (snapshot.versions !== undefined && !Array.isArray(snapshot.versions))
    throw Error('Invalid remote source variants')
  for (const [index, version] of (snapshot.versions ?? []).entries()) {
    const message = project(version, index)
    yield { store: 'message-variants', key: JSON.stringify([message.key, index]), value: message }
  }
}
