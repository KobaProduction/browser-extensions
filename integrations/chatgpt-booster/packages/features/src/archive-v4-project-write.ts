import {
  requestResult as req,
  transactionComplete as settled,
} from '@kobaproduction/browser-storage'
import type { ArchiveV4Metadata, ArchiveV4Project } from './archive-v4-entities'
import { key } from './archive-v4-identities'
import { archiveWriteAllowed, guardArchiveTransaction } from './archive-v4-write'

/** One revocable project observation. Only the acknowledged commit may signal an update. */
export async function writeArchiveProject(
  openDatabase: () => Promise<IDBDatabase>,
  pk: string,
  accountId: string,
  projectId: string,
  title: string | null,
  observedAt: number,
  stillAuthorized: () => boolean,
  signal: AbortSignal | undefined,
  matchesTicket: (generation: ArchiveV4Metadata | undefined) => boolean,
): Promise<boolean | undefined> {
  const allowed = () => archiveWriteAllowed(signal, stillAuthorized)
  const db = await openDatabase()
  if (!allowed()) return
  const tx = db.transaction(['projects', 'metadata'], 'readwrite')
  const done = settled(tx)
  const detach = guardArchiveTransaction(tx, signal)
  try {
    const store = tx.objectStore('projects')
    const [previous, generation] = await Promise.all([
      req<ArchiveV4Project | undefined>(store.get(pk)),
      req<ArchiveV4Metadata | undefined>(
        tx.objectStore('metadata').get(key(key(accountId), 'write-generation')),
      ),
    ])
    if (!allowed() || !matchesTicket(generation)) {
      tx.abort()
      await done.catch(() => undefined)
      return
    }
    if (previous && (previous.accountId !== accountId || previous.projectId !== projectId))
      throw new Error('archive.error.auth')
    if (previous && observedAt < previous.lastSeenAt) {
      await done
      return
    }
    const nextTitle = typeof title === 'string' && title.trim() ? title : (previous?.title ?? null)
    if (!previous || nextTitle !== previous.title || observedAt > previous.lastSeenAt)
      store.put({
        key: pk,
        accountId,
        projectId,
        title: nextTitle,
        firstSeenAt: previous?.firstSeenAt ?? observedAt,
        lastSeenAt: observedAt,
      } satisfies ArchiveV4Project)
    if (!allowed()) {
      tx.abort()
      await done.catch(() => undefined)
      return
    }
    await done
    return !previous || nextTitle !== previous.title
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
