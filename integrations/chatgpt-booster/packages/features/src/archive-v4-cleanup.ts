import { transactionComplete as settled } from '@kobaproduction/browser-storage'
import type { ArchiveV4Metadata } from './archive-v4-entities'
import { key } from './archive-v4-identities'
import { archiveWriteAllowed, guardArchiveTransaction } from './archive-v4-write'

/** Account-owned destructive transaction; no global database reset or cross-account reads. */
export async function eraseArchiveAccount(
  openDatabase: () => Promise<IDBDatabase>,
  owner: string,
  stillAuthorized: () => boolean,
  signal?: AbortSignal,
): Promise<void> {
  const allowed = () => archiveWriteAllowed(signal, stillAuthorized)
  if (!allowed()) throw new DOMException('Archive cleanup cancelled', 'AbortError')
  const db = await openDatabase()
  if (!allowed()) throw new DOMException('Archive cleanup cancelled', 'AbortError')
  const tx = db.transaction(['projects', 'conversations', 'messages', 'metadata'], 'readwrite')
  const done = settled(tx)
  const detach = guardArchiveTransaction(tx, signal)
  const projects = tx.objectStore('projects')
  const conversations = tx.objectStore('conversations')
  const messages = tx.objectStore('messages')
  const metadata = tx.objectStore('metadata')
  try {
    // Delete by indexed primary-key cursors instead of getAllKeys(). A large
    // account never materializes all Message/Metadata keys in browser RAM.
    // All traversals and the durable generation marker share ONE transaction.
    await new Promise<void>((resolve, reject) => {
      let failed = false
      const fail = (cause: unknown) => {
        if (failed) return
        failed = true
        reject(cause)
        try {
          tx.abort()
        } catch {
          /* A revoked transaction may be closed. */
        }
      }
      tx.addEventListener(
        'abort',
        () =>
          fail(
            signal?.aborted
              ? new DOMException('Archive cleanup cancelled', 'AbortError')
              : (tx.error ?? new Error('Archive cleanup transaction aborted')),
          ),
        { once: true },
      )
      const check = () => {
        if (!allowed()) {
          fail(new DOMException('Archive cleanup cancelled', 'AbortError'))
          return false
        }
        return true
      }
      // The next request is scheduled synchronously in onsuccess: the IDB
      // transaction cannot auto-commit between nested scans.
      const erase = (
        store: IDBObjectStore,
        indexName: string,
        indexedKey: IDBValidKey,
        beforeDelete: (primaryKey: IDBValidKey, resume: () => void) => void,
        complete: () => void,
      ) => {
        if (!check()) return
        try {
          const request = store.index(indexName).openKeyCursor(IDBKeyRange.only(indexedKey))
          request.onerror = () => fail(request.error ?? new Error('Archive cleanup cursor failed'))
          request.onsuccess = () => {
            if (failed || !check()) return
            const cursor = request.result
            if (!cursor) {
              try {
                complete()
              } catch (cause) {
                fail(cause)
              }
              return
            }
            try {
              beforeDelete(cursor.primaryKey, () => {
                if (failed || !check()) return
                try {
                  // Key-only cursor has no deletable value: delete through
                  // the owning store, then synchronously queue the next key.
                  store.delete(cursor.primaryKey)
                  cursor.continue()
                } catch (cause) {
                  fail(cause)
                }
              })
            } catch (cause) {
              fail(cause)
            }
          }
        } catch (cause) {
          fail(cause)
        }
      }
      const eraseOwnedMetadata = (ownerKey: IDBValidKey, complete: () => void) =>
        erase(metadata, 'byOwner', ownerKey, (_key, resume) => resume(), complete)
      const eraseMessages = (conversationKey: IDBValidKey, complete: () => void) =>
        erase(
          messages,
          'byConversation',
          conversationKey,
          (messageKey, resume) => eraseOwnedMetadata(messageKey, resume),
          complete,
        )
      const eraseConversations = (complete: () => void) =>
        erase(
          conversations,
          'byAccount',
          owner,
          (conversationKey, resume) =>
            eraseMessages(conversationKey, () => eraseOwnedMetadata(conversationKey, resume)),
          complete,
        )
      const eraseProjects = (complete: () => void) =>
        erase(
          projects,
          'byAccount',
          owner,
          (projectKey, resume) => eraseOwnedMetadata(projectKey, resume),
          complete,
        )
      eraseProjects(() =>
        eraseConversations(() => {
          if (!check()) return
          // This marker invalidates tickets from other tabs issued before
          // deletion. It is committed atomically with every removed key.
          metadata.put({
            key: key(key(owner), 'write-generation'),
            ownerType: 'account',
            ownerKey: key(owner),
            kind: 'write-generation',
            observedAt: Date.now(),
            payload: { generation: crypto.randomUUID() },
          } satisfies ArchiveV4Metadata)
          resolve()
        }),
      )
    })
    if (!allowed()) throw new DOMException('Archive cleanup cancelled', 'AbortError')
    await done
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // A failed transaction is already aborted.
    }
    await done.catch(() => undefined)
    throw error
  } finally {
    detach()
  }
}
