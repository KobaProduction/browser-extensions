import { ARCHIVE_CANONICAL_MODEL_VERSION, projectNativeMessage } from '@chatgpt-booster/core'
import { decodeArchiveClone, encodeArchiveClone } from '@kobaproduction/browser-archive'
import {
  type PortableBackupReader,
  type PortableBackupRow,
  serializedBackupRow,
} from '@kobaproduction/browser-storage'
import { validateHistoryCoverageCheckpoint } from './archive-coverage'
import type {
  FixedConversation,
  FixedElement,
  FixedMessage,
  FixedProject,
  FixedSnapshot,
} from './archive-fixed-dexie'
import { validateChatGptNormalizedSnapshot } from './archive-message-adapter'
import { sourceFingerprint } from './archive-observation-policy'
import {
  originalConversationProject,
  sourceProjectBelongsToConversation,
  validateProjectAssociations,
} from './archive-project-association'

export const FIXED_BACKUP_STORES = [
  'projects',
  'conversations',
  'messages',
  'elements',
  'snapshots',
] as const
export type FixedBackupStore = (typeof FIXED_BACKUP_STORES)[number]
export type FixedBackupModel =
  | FixedProject
  | FixedConversation
  | FixedMessage
  | FixedElement
  | FixedSnapshot
export type FixedBackupCounts = Record<FixedBackupStore, number>
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256

/** A per-record expansion guard, never a limit on total archive size. Encoded
 * sparse arrays can otherwise allocate hundreds of MiB from a tiny JSON row. */
export const MAX_FIXED_BACKUP_ROW_ALLOCATION = 64 * 1024 * 1024
export function assertFixedBackupCodecBudget(encoded: unknown): number {
  let remaining = MAX_FIXED_BACKUP_ROW_ALLOCATION
  const reserve = (bytes: number) => {
    remaining -= bytes
    if (!Number.isSafeInteger(bytes) || bytes < 0 || remaining < 0)
      throw Error('Unsupported ChatGPT backup row: structured-clone expansion exceeds 64 MiB')
  }
  const visit = (node: unknown, depth: number): void => {
    if (depth > 150) throw Error('Unsupported ChatGPT backup row: codec nesting exceeds 150')
    reserve(32)
    if (typeof node === 'string') {
      reserve(node.length * 2)
      return
    }
    if (!Array.isArray(node)) return // The shared decoder checks primitive validity.
    const tag = node[0]
    if (tag === 'array') {
      if (!Number.isSafeInteger(node[1]) || node[1] < 0 || !Array.isArray(node[2]))
        throw Error('Invalid ChatGPT backup array codec')
      reserve(node[1] * 8)
      for (const pair of node[2]) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string')
          throw Error('Invalid ChatGPT backup array property')
        reserve(32 + pair[0].length * 2)
        visit(pair[1], depth + 1)
      }
    } else if (tag === 'object' || tag === 'map') {
      if (!Array.isArray(node[1])) throw Error('Invalid ChatGPT backup collection codec')
      for (const pair of node[1]) {
        if (!Array.isArray(pair) || pair.length !== 2)
          throw Error('Invalid ChatGPT backup collection pair')
        reserve(64)
        visit(pair[0], depth + 1)
        visit(pair[1], depth + 1)
      }
    } else if (tag === 'set') {
      if (!Array.isArray(node[1])) throw Error('Invalid ChatGPT backup Set codec')
      for (const item of node[1]) {
        reserve(32)
        visit(item, depth + 1)
      }
    } else {
      // Include Base64 decoding, backing bytes and scalar/string construction.
      for (let index = 1; index < node.length; index++) {
        if (typeof node[index] === 'string') reserve(node[index].length * 4)
        else visit(node[index], depth + 1)
      }
    }
  }
  visit(encoded, 0)
  return MAX_FIXED_BACKUP_ROW_ALLOCATION - remaining
}

/** The live DTO may reuse a preferred raw/event object in its version history.
 * Those are separate observations, not source reference-graph semantics. Detach
 * only these DTO fields; aliases/cycles inside a raw source remain unsupported. */
export { detachSourceSnapshot as detachedFixedBackupSnapshot } from './archive-source-snapshot'
/** The writer and recovery decoder share one explicit per-row bound. Refuse
 * an unsupported observation atomically instead of creating an unbackupable DB. */
export async function assertFixedBackupAdmission(
  store: string,
  key: string,
  model: unknown,
): Promise<void> {
  const encoded = await encodeArchiveClone(model)
  assertFixedBackupCodecBudget(encoded)
  serializedBackupRow({ key: JSON.stringify([store, key]), value: encoded })
}

export function decodeFixedBackupRow(row: PortableBackupRow, owner: string): FixedBackupModel {
  if (!FIXED_BACKUP_STORES.includes(row.store as FixedBackupStore))
    throw Error('Unknown canonical recovery table')
  if (typeof row.key !== 'string' || !row.key || row.key.length > 1024)
    throw Error('Invalid canonical primary key')
  serializedBackupRow({ key: JSON.stringify([row.store, row.key]), value: row.value })
  assertFixedBackupCodecBudget(row.value)
  const value = decodeArchiveClone(row.value)
  if (!object(value) || value.accountId !== owner) throw Error('Wrong-owner canonical recovery row')
  const keyField =
    row.store === 'elements' ? 'elementId' : row.store === 'snapshots' ? 'messageKey' : 'key'
  if (value[keyField] !== row.key) throw Error('Canonical primary key mismatch')
  const tuple = (size: number): string[] => {
    const parts: unknown = JSON.parse(row.key)
    if (
      !Array.isArray(parts) ||
      parts.length !== size ||
      parts[0] !== owner ||
      !parts.every(nonEmpty) ||
      JSON.stringify(parts) !== row.key
    )
      throw Error('Invalid canonical key')
    return parts as string[]
  }
  if (row.store === 'projects') {
    const parts = tuple(2)
    if (value.projectId !== parts[1] || (value.title !== null && typeof value.title !== 'string'))
      throw Error('Invalid project recovery record')
  } else if (row.store === 'conversations') {
    const parts = tuple(2)
    if (value.pageCoverage !== undefined) validateHistoryCoverageCheckpoint(value.pageCoverage)
    if (
      value.conversationId !== parts[1] ||
      (value.projectId !== null && !nonEmpty(value.projectId)) ||
      (value.title !== null && typeof value.title !== 'string')
    )
      throw Error('Invalid conversation recovery record')
    validateProjectAssociations(value as unknown as FixedConversation)
    if (
      value.revision !== undefined &&
      (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)
    )
      throw Error('Invalid conversation revision')
    if (
      value.instanceId !== undefined &&
      (typeof value.instanceId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.instanceId))
    )
      throw Error('Invalid conversation instance identity')
    for (const field of ['currentHeadId', 'terminalHeadId', 'pageHeadId'])
      if (value[field] !== undefined && value[field] !== null && !nonEmpty(value[field]))
        throw Error('Invalid saved head evidence')
    if (value.pageEvidence !== undefined) {
      if (!Array.isArray(value.pageEvidence)) throw Error('Invalid page evidence')
      for (const page of value.pageEvidence) {
        if (
          !object(page) ||
          !Number.isFinite(page.observedAt) ||
          (page.observedAt as number) < 0 ||
          ![true, false, null].includes(page.hasPreviousPage as boolean | null) ||
          ![true, false, null].includes(page.hasNextPage as boolean | null) ||
          (page.startCursor !== null && typeof page.startCursor !== 'string') ||
          (page.endCursor !== null && typeof page.endCursor !== 'string') ||
          (page.readId !== undefined && !nonEmpty(page.readId)) ||
          (page.readStartedAt !== undefined &&
            (!Number.isFinite(page.readStartedAt) || (page.readStartedAt as number) < 0)) ||
          (page.isInitial !== undefined && typeof page.isInitial !== 'boolean') ||
          (page.requestedBefore !== undefined &&
            page.requestedBefore !== null &&
            typeof page.requestedBefore !== 'string')
        )
          throw Error('Invalid page evidence record')
      }
    }
  } else if (row.store === 'messages') {
    const parts = tuple(3),
      projection = value.projection
    if (
      value.conversationId !== parts[1] ||
      value.messageId !== parts[2] ||
      value.modelVersion !== ARCHIVE_CANONICAL_MODEL_VERSION ||
      !object(projection) ||
      projection.accountId !== owner ||
      projection.conversationId !== parts[1] ||
      projection.messageId !== parts[2] ||
      projection.messageKey !== row.key ||
      projection.modelVersion !== ARCHIVE_CANONICAL_MODEL_VERSION ||
      !Array.isArray(projection.elements)
    )
      throw Error('Invalid message recovery projection')
  } else if (row.store === 'elements') {
    if (
      typeof value.messageKey !== 'string' ||
      !Number.isSafeInteger(value.siblingOrder) ||
      (value.siblingOrder as number) < 0 ||
      !nonEmpty(value.kind) ||
      !nonEmpty(value.visibility) ||
      typeof value.sourcePath !== 'string'
    )
      throw Error('Invalid canonical element')
  } else {
    const parts = tuple(3)
    if (
      !object(value.raw) ||
      value.raw.id !== parts[2] ||
      !nonEmpty(value.sourceKind) ||
      !nonEmpty(value.sourceVersion) ||
      !Number.isSafeInteger(value.observedAtMs) ||
      (value.observedAtMs as number) < 0
    )
      throw Error('Invalid source snapshot recovery record')
    if (
      value.sourceEvents !== undefined &&
      (!Array.isArray(value.sourceEvents) || !value.sourceEvents.every(object))
    )
      throw Error('Invalid source event evidence')
    if (value.versions !== undefined) {
      if (!Array.isArray(value.versions) || !value.versions.length)
        throw Error('Invalid source versions')
      for (const version of value.versions) {
        if (
          !object(version) ||
          !object(version.raw) ||
          version.raw.id !== parts[2] ||
          !nonEmpty(version.sourceKind) ||
          !nonEmpty(version.sourceVersion) ||
          !Number.isSafeInteger(version.observedAtMs) ||
          (version.observedAtMs as number) < 0 ||
          !['initial', 'advance', 'identical', 'stale', 'conflict'].includes(String(version.decision))
        )
          throw Error('Invalid source version evidence')
        if (
          version.projectId !== undefined &&
          version.projectId !== null &&
          !nonEmpty(version.projectId)
        )
          throw Error('Invalid source version project context')
        if (
          version.sourceEvents !== undefined &&
          (!Array.isArray(version.sourceEvents) || !version.sourceEvents.every(object))
        )
          throw Error('Invalid source version event evidence')
      }
    }
    if (value.projectId !== undefined && value.projectId !== null && !nonEmpty(value.projectId))
      throw Error('Invalid source project context')
    const conversationId = parts[1]
    if (!conversationId) throw Error('Missing canonical conversation identity')
    validateChatGptNormalizedSnapshot(value as unknown as FixedSnapshot, conversationId)
  }
  return value as unknown as FixedBackupModel
}

/** The sealed reader owns its indexes. No source-row map or full graph is kept
 * in RAM: each relation is checked in both directions through indexed get(). */
export async function validateFixedStagedBackup(
  reader: PortableBackupReader,
  owner: string,
  authorize: () => void,
): Promise<FixedBackupCounts> {
  if (!Number.isSafeInteger(reader.count) || reader.count < 0)
    throw Error('Invalid canonical staged row count')
  const counts: FixedBackupCounts = {
    projects: 0,
    conversations: 0,
    messages: 0,
    elements: 0,
    snapshots: 0,
  }
  let previous = '',
    count = 0,
    expectedElements = 0
  const load = async (store: FixedBackupStore, key: string): Promise<FixedBackupModel> => {
    authorize()
    const row = await reader.get(store, key)
    authorize()
    if (!row || row.store !== store || row.key !== key)
      throw Error('Missing canonical recovery relation')
    return decodeFixedBackupRow(row, owner)
  }
  for await (const row of reader.readRows()) {
    authorize()
    const token = JSON.stringify([row.store, row.key])
    if (previous && token <= previous) throw Error('Duplicate or unordered canonical staged row')
    previous = token
    const value = decodeFixedBackupRow(row, owner)
    // Detect non-canonical/ambiguous tagged data rather than silently losing it.
    if (sourceFingerprint(await encodeArchiveClone(value)) !== sourceFingerprint(row.value))
      throw Error('Non-canonical structured-clone recovery row')
    if (row.store === 'conversations') {
      const conversation = value as FixedConversation
      if (conversation.projectId) await load('projects', JSON.stringify([owner, conversation.projectId]))
      for (const entry of conversation.projectAssociations ?? [])
        for (const projectId of [entry.previousProjectId, entry.projectId])
          if (projectId) await load('projects', JSON.stringify([owner, projectId]))
      if (conversation.terminalHeadId) {
        const source = (
          (await load(
            'snapshots',
            JSON.stringify([owner, conversation.conversationId, conversation.terminalHeadId]),
          )) as FixedSnapshot
        ).raw
        const author = object(source.author) ? source.author : null
        if (
          author?.role !== 'assistant' ||
          source.end_turn !== true ||
          source.status !== 'finished_successfully' ||
          (source.recipient !== undefined && source.recipient !== null && source.recipient !== 'all') ||
          (source.channel !== undefined && source.channel !== null && source.channel !== 'final')
        )
          throw Error('Saved terminal head disagrees with assistant source evidence')
      }
    } else if (row.store === 'messages') {
      const message = value as FixedMessage
      const header = (await load(
        'conversations',
        JSON.stringify([owner, message.conversationId]),
      )) as FixedConversation
      const source = (await load('snapshots', row.key)) as FixedSnapshot
      const sourceProject =
        source.projectId === undefined ? originalConversationProject(header) : source.projectId
      if (
        !sourceProjectBelongsToConversation(header, sourceProject) ||
        source.versions?.some(
          (version) =>
            version.projectId !== undefined &&
            !sourceProjectBelongsToConversation(header, version.projectId),
        )
      )
        throw Error('Normalized source project disagrees with conversation')
      validateChatGptNormalizedSnapshot(source, message.conversationId, sourceProject)
      if (
        sourceFingerprint(
          projectNativeMessage(source.raw, { accountId: owner, conversationId: message.conversationId }),
        ) !== sourceFingerprint(message.projection)
      )
        throw Error('Canonical projection disagrees with source evidence')
      expectedElements += message.projection.elements.length
      if (!Number.isSafeInteger(expectedElements)) throw Error('Canonical element count overflow')
      for (const original of message.projection.elements) {
        const element = (await load('elements', original.elementId)) as FixedElement
        if (sourceFingerprint(element) !== sourceFingerprint({ ...original, accountId: owner }))
          throw Error('Canonical element disagrees with stored content')
      }
    } else if (row.store === 'snapshots') {
      await load('messages', row.key)
    } else if (row.store === 'elements') {
      const element = value as FixedElement
      const message = (await load('messages', element.messageKey)) as FixedMessage
      const original = message.projection.elements.find((item) => item?.elementId === element.elementId)
      if (
        !original ||
        sourceFingerprint(element) !== sourceFingerprint({ ...original, accountId: owner })
      )
        throw Error('Orphan or changed canonical content element')
    }
    counts[row.store as FixedBackupStore]++
    if (++count > reader.count) throw Error('Canonical staged row count mismatch')
  }
  authorize()
  if (
    count !== reader.count ||
    counts.elements !== expectedElements ||
    counts.messages !== counts.snapshots
  )
    throw Error('Canonical staged graph count mismatch')
  return counts
}
