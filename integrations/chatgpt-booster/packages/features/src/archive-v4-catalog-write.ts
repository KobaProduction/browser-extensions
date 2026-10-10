import type { ConversationCatalogEventDetail } from '@chatgpt-booster/observer'
import {
  requestResult as req,
  transactionComplete as settled,
} from '@kobaproduction/browser-storage'
import type {
  ArchiveV4Change,
  ArchiveV4Conversation,
  ArchiveV4Metadata,
  ArchiveV4Project,
} from './archive-v4-entities'
import { key } from './archive-v4-identities'
import { archiveWriteAllowed, guardArchiveTransaction } from './archive-v4-write'

/** Consent-neutral catalog update. Never creates conversations absent from the archive. */
export async function writeArchiveCatalogHeaders(
  openDatabase: () => Promise<IDBDatabase>,
  accountId: string,
  input: ConversationCatalogEventDetail,
  items: ReadonlyMap<string, ConversationCatalogEventDetail['items'][number]>,
  startedAt: number,
  stillAuthorized: () => boolean,
  signal: AbortSignal | undefined,
  matchesTicket: (generation: ArchiveV4Metadata | undefined) => boolean,
  assertCompatible: (conversationId: string) => void,
): Promise<ArchiveV4Change[] | undefined> {
  const allowed = () => archiveWriteAllowed(signal, stillAuthorized)
  const db = await openDatabase()
  if (!allowed()) return
  const tx = db.transaction(['projects', 'conversations', 'metadata'], 'readwrite')
  const done = settled(tx)
  const detach = guardArchiveTransaction(tx, signal)
  const changes: ArchiveV4Change[] = []
  try {
    const conversations = tx.objectStore('conversations')
    const projects = tx.objectStore('projects')
    const [generation, stored] = await Promise.all([
      req<ArchiveV4Metadata | undefined>(
        tx.objectStore('metadata').get(key(key(accountId), 'write-generation')),
      ),
      Promise.all(
        [...items.keys()].map((id) =>
          req<ArchiveV4Conversation | undefined>(conversations.get(key(accountId, id))),
        ),
      ),
    ])
    if (!allowed() || !matchesTicket(generation)) {
      tx.abort()
      await done.catch(() => undefined)
      return
    }
    for (const previous of stored) {
      if (!previous) continue
      if (previous.accountId !== accountId) throw new Error('archive.error.auth')
      const item = items.get(previous.conversationId)
      if (!item) throw new Error('archive.error.sourceChanged')
      assertCompatible(item.conversationId)
      if (
        startedAt <
        Math.max(
          previous.catalogReadStartedAt ?? -Infinity,
          previous.headReadStartedAt ?? -Infinity,
        )
      )
        continue
      const projectId =
        item.projectKnown === true ? item.projectId : (item.projectId ?? previous.projectId)
      const title =
        typeof item.title === 'string' && item.title.trim() ? item.title : previous.title
      const changed = projectId !== previous.projectId || title !== previous.title
      if (projectId) {
        const projectKey = key(accountId, projectId)
        const project = await req<ArchiveV4Project | undefined>(projects.get(projectKey))
        if (!project)
          projects.put({
            key: projectKey,
            projectId,
            accountId,
            title: null,
            firstSeenAt: input.observedAt,
            lastSeenAt: input.observedAt,
          } satisfies ArchiveV4Project)
        else if (project.accountId !== accountId) throw new Error('archive.error.auth')
      }
      if (changed || startedAt > (previous.catalogReadStartedAt ?? -Infinity)) {
        conversations.put({
          ...previous,
          projectId,
          title,
          catalogReadStartedAt: startedAt,
          ...(changed
            ? {
                revision: previous.revision + 1,
                lastSeenAt: Math.max(previous.lastSeenAt, input.observedAt),
                verifiedPathRootId: null,
                verifiedPathTipId: null,
                verifiedPathReadId: null,
                verifiedPathRevision: null,
              }
            : {}),
        } satisfies ArchiveV4Conversation)
      }
      if (changed)
        changes.push({
          kind: 'conversation',
          accountId,
          conversationId: previous.conversationId,
          revision: previous.revision + 1,
        })
    }
    if (!allowed()) throw new DOMException('Catalog write revoked', 'AbortError')
    await done
    return changes
  } catch (cause) {
    try {
      tx.abort()
    } catch {
      /* Already settled. */
    }
    await done.catch(() => undefined)
    if (allowed()) throw cause
  } finally {
    detach()
  }
}
