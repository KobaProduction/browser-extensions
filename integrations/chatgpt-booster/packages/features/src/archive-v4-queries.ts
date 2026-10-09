import { requestResult as req } from '@kobaproduction/browser-storage'
import type {
  ArchiveV4Conversation,
  ArchiveV4Message,
  ArchiveV4Metadata,
  ArchiveV4Project,
  ArchiveV4SourceRevisionEvidence,
  ArchiveV4SourceRevisionWindow,
} from './archive-v4-entities'
import { identity, key } from './archive-v4-identities'

/** Read-only indexed queries. Database versions, authentication and migration stay outside. */
export async function listProjects(
  openDatabase: () => Promise<IDBDatabase>,
  accountId: string,
): Promise<ArchiveV4Project[]> {
  const db = await openDatabase()
  const tx = db.transaction('projects', 'readonly')
  return req<ArchiveV4Project[]>(
    tx.objectStore('projects').index('byAccount').getAll(identity(accountId, 'accountId')),
  )
}

export async function getProject(
  openDatabase: () => Promise<IDBDatabase>,
  accountId: string,
  projectId: string,
) {
  const db = await openDatabase()
  const tx = db.transaction('projects', 'readonly')
  return req<ArchiveV4Project | undefined>(
    tx
      .objectStore('projects')
      .get(key(identity(accountId, 'accountId'), identity(projectId, 'projectId'))),
  )
}

export async function getConversation(
  openDatabase: () => Promise<IDBDatabase>,
  accountId: string,
  conversationId: string,
) {
  const db = await openDatabase()
  const tx = db.transaction('conversations', 'readonly')
  return req<ArchiveV4Conversation | undefined>(
    tx
      .objectStore('conversations')
      .get(key(identity(accountId, 'accountId'), identity(conversationId, 'conversationId'))),
  )
}

export async function listConversations(
  openDatabase: () => Promise<IDBDatabase>,
  accountId: string,
) {
  const db = await openDatabase()
  const tx = db.transaction('conversations', 'readonly')
  return req<ArchiveV4Conversation[]>(
    tx.objectStore('conversations').index('byAccount').getAll(identity(accountId, 'accountId')),
  )
}

export async function getMessage(
  openDatabase: () => Promise<IDBDatabase>,
  accountId: string,
  conversationId: string,
  messageId: string,
) {
  const db = await openDatabase()
  const tx = db.transaction('messages', 'readonly')
  return req<ArchiveV4Message | undefined>(
    tx
      .objectStore('messages')
      .get(
        key(
          key(identity(accountId, 'accountId'), identity(conversationId, 'conversationId')),
          identity(messageId, 'messageId'),
        ),
      ),
  )
}

export async function getMessageRevisionEvidence(
  openDatabase: () => Promise<IDBDatabase>,
  accountId: string,
  conversationId: string,
  messageId: string,
  limit = 64,
): Promise<ArchiveV4SourceRevisionWindow> {
  const ownerKey = key(
    key(identity(accountId, 'accountId'), identity(conversationId, 'conversationId')),
    identity(messageId, 'messageId'),
  )
  const maximum = Number.isFinite(limit) ? Math.max(1, Math.min(128, Math.floor(limit))) : 64
  const db = await openDatabase()
  const previous = new Map<number, ArchiveV4SourceRevisionEvidence>()
  let olderRevisionsOmitted = false
  const add = (
    metadata: ArchiveV4Metadata,
    kind: 'message-revision-evidence' | 'message-snapshot',
  ) => {
    const revision = metadata.payload?.revision
    if (
      metadata.ownerKey !== ownerKey ||
      metadata.ownerType !== 'message' ||
      metadata.kind !== kind ||
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      !Number.isFinite(metadata.observedAt)
    )
      throw new Error('archive.error.sourceChanged')
    if (previous.has(revision)) return
    previous.set(revision, {
      previousRevision: revision,
      previousLastSeenAtMs: metadata.observedAt,
      sourceReadId:
        typeof metadata.payload.sourceReadId === 'string' ? metadata.payload.sourceReadId : null,
      sourceReadStartedAtMs:
        typeof metadata.payload.sourceReadStartedAt === 'number' &&
        Number.isFinite(metadata.payload.sourceReadStartedAt)
          ? metadata.payload.sourceReadStartedAt
          : null,
    })
    if (previous.size > maximum) {
      const oldest = Math.min(...previous.keys())
      previous.delete(oldest)
      olderRevisionsOmitted = true
    }
  }
  const scan = (kind: 'message-revision-evidence' | 'message-snapshot', olderThan?: number) => {
    // Separate readonly transactions: a cursor's final onsuccess may allow
    // auto-commit before a second async cursor is scheduled.
    const tx = db.transaction('metadata', 'readonly')
    return new Promise<void>((resolve, reject) => {
      let finished = false
      const fail = (cause: unknown) => {
        if (finished) return
        finished = true
        try {
          tx.abort()
        } catch {
          /* Already settled. */
        }
        reject(cause)
      }
      const cursor = tx
        .objectStore('metadata')
        .index('byKind')
        .openCursor(IDBKeyRange.only([ownerKey, kind]))
      cursor.onerror = () => fail(cursor.error ?? new Error('Archive revision cursor failed'))
      tx.onabort = () => fail(tx.error ?? new Error('Archive revision scan aborted'))
      cursor.onsuccess = () => {
        if (finished) return
        const current = cursor.result
        if (!current) {
          finished = true
          resolve()
          return
        }
        try {
          const metadata = current.value as ArchiveV4Metadata
          const revision = metadata.payload?.revision
          if (
            typeof revision !== 'number' ||
            !Number.isSafeInteger(revision) ||
            revision < 1 ||
            metadata.ownerKey !== ownerKey ||
            metadata.ownerType !== 'message' ||
            metadata.kind !== kind
          )
            throw new Error('archive.error.sourceChanged')
          if (olderThan === undefined || revision < olderThan) add(metadata, kind)
          current.continue()
        } catch (cause) {
          fail(cause)
        }
      }
    })
  }
  await scan('message-revision-evidence')
  const earliestCompact = Math.min(...previous.keys())
  if (!olderRevisionsOmitted && (!Number.isFinite(earliestCompact) || earliestCompact > 1))
    await scan('message-snapshot', Number.isFinite(earliestCompact) ? earliestCompact : undefined)
  const sorted = [...previous.values()].sort(
    (left, right) => left.previousRevision - right.previousRevision,
  )
  // Do not report an incomplete snapshot history as a verified contiguous
  // list merely because a newer compact revision exists.
  if (sorted.length && !olderRevisionsOmitted && sorted[0]?.previousRevision !== 1)
    throw new Error('archive.error.sourceChanged')
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i]?.previousRevision !== (sorted[i - 1]?.previousRevision ?? -1) + 1)
      throw new Error('archive.error.sourceChanged')
  return { previous: sorted, olderRevisionsOmitted }
}
