import {
  requestResult as req,
  transactionComplete as settled,
} from '@kobaproduction/browser-storage'
import type { ArchiveV4Conversation, ArchiveV4Message } from './archive-v4-entities'
import { identity, key } from './archive-v4-identities'

/** Bounded physical read adapter. Native chronology is never selected-branch proof. */
export async function readChronologyWindow(
  openDatabase: () => Promise<IDBDatabase>,
  accountId: string,
  conversationId: string,
  limit = 40,
  direction: 'newest' | 'oldest' = 'newest',
  fromExclusive?: Pick<ArchiveV4Message, 'sourceCreateTime' | 'messageId'>,
  signal?: AbortSignal,
): Promise<ArchiveV4Message[]> {
  const conversationKey = key(
    identity(accountId, 'accountId'),
    identity(conversationId, 'conversationId'),
  )
  if (signal?.aborted) throw new DOMException('Archive window cancelled', 'AbortError')
  const db = await openDatabase()
  if (signal?.aborted) throw new DOMException('Archive window cancelled', 'AbortError')
  const tx = db.transaction('messages', 'readonly')
  const index = tx.objectStore('messages').index('byChronology')
  if (
    fromExclusive &&
    (fromExclusive.sourceCreateTime === null || !Number.isFinite(fromExclusive.sourceCreateTime))
  )
    throw new Error('Chronological cursor requires a verified numeric source time')
  const range = fromExclusive
    ? direction === 'newest'
      ? IDBKeyRange.bound(
          [conversationKey],
          [conversationKey, fromExclusive.sourceCreateTime, fromExclusive.messageId],
          false,
          true,
        )
      : IDBKeyRange.bound(
          [conversationKey, fromExclusive.sourceCreateTime, fromExclusive.messageId],
          [conversationKey, []],
          true,
          false,
        )
    : IDBKeyRange.bound([conversationKey], [conversationKey, []])
  const amount = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 40
  return new Promise((resolve, reject) => {
    const rows: ArchiveV4Message[] = []
    const detach = () => signal?.removeEventListener('abort', abort)
    const abort = () => {
      detach()
      try {
        tx.abort()
      } catch {
        /* A completed read needs no cancellation. */
      }
      reject(new DOMException('Archive window cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    tx.onabort = () => {
      detach()
      reject(
        signal?.aborted
          ? new DOMException('Archive window cancelled', 'AbortError')
          : (tx.error ?? new Error('Archive index read aborted')),
      )
    }
    tx.oncomplete = () => {
      detach()
      resolve(rows)
    }
    const cursor = index.openCursor(range, direction === 'newest' ? 'prev' : 'next')
    cursor.onerror = () => {
      detach()
      reject(cursor.error ?? new Error('Archive index read failed'))
    }
    cursor.onsuccess = () => {
      const current = cursor.result
      if (!current || rows.length >= amount || signal?.aborted) return
      rows.push(current.value as ArchiveV4Message)
      if (rows.length < amount) current.continue()
    }
    if (signal?.aborted) abort()
  })
}

export async function readMessageWindow(
  openDatabase: () => Promise<IDBDatabase>,
  accountId: string,
  conversationId: string,
  messageId: string,
  radius = 20,
  signal?: AbortSignal,
) {
  const owner = identity(accountId, 'accountId')
  const id = identity(conversationId, 'conversationId')
  const sourceId = identity(messageId, 'messageId')
  const scoped = key(owner, id)
  const amount = Number.isFinite(radius) ? Math.max(1, Math.min(60, Math.floor(radius))) : 20
  if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
  const db = await openDatabase()
  if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
  const tx = db.transaction(['conversations', 'messages'], 'readonly')
  const done = settled(tx)
  // Abort can happen while a cursor promise is still pending.
  void done.catch(() => undefined)
  const abort = () => {
    try {
      tx.abort()
    } catch {
      /* Already settled. */
    }
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const store = tx.objectStore('messages')
    const [conversation, target] = await Promise.all([
      req<ArchiveV4Conversation | undefined>(tx.objectStore('conversations').get(scoped)),
      req<ArchiveV4Message | undefined>(store.get(key(scoped, sourceId))),
    ])
    if (!conversation || !target) throw new Error('archive.error.messageMissing')
    if (
      conversation.accountId !== owner ||
      conversation.conversationId !== id ||
      target.conversationKey !== scoped ||
      target.messageId !== sourceId
    )
      throw new Error('archive.error.auth')
    if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
    const point = target.sourceCreateTime
    if (point === null) {
      await done
      return {
        conversation,
        target,
        messages: [target],
        hasOlder: false,
        hasNewer: false,
        unsequencedTarget: true,
      }
    }
    if (!Number.isFinite(point)) throw new Error('archive.error.incompatibleSource')
    const index = store.index('byChronology')
    const anchor = [scoped, point, sourceId]
    const neighbors = (direction: 'prev' | 'next') =>
      new Promise<ArchiveV4Message[]>((resolve, reject) => {
        const rows: ArchiveV4Message[] = []
        const onAbort = () =>
          reject(
            signal?.aborted
              ? new DOMException('Archive navigation cancelled', 'AbortError')
              : (tx.error ?? new Error('Archive navigation aborted')),
          )
        tx.addEventListener('abort', onAbort, { once: true })
        const range =
          direction === 'prev'
            ? IDBKeyRange.bound([scoped], anchor, false, true)
            : IDBKeyRange.bound(anchor, [scoped, []], true, false)
        const cursor = index.openCursor(range, direction)
        cursor.onerror = () => reject(cursor.error ?? new Error('Archive navigation cursor failed'))
        cursor.onsuccess = () => {
          const current = cursor.result
          if (!current) {
            resolve(rows)
            return
          }
          rows.push(current.value as ArchiveV4Message)
          if (rows.length >= amount + 1) resolve(rows)
          else current.continue()
        }
      })
    const [older, newer] = await Promise.all([neighbors('prev'), neighbors('next')])
    await done
    if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
    return {
      conversation,
      target,
      messages: [...older.slice(0, amount).reverse(), target, ...newer.slice(0, amount)],
      hasOlder: older.length > amount,
      hasNewer: newer.length > amount,
      unsequencedTarget: false,
    }
  } catch (cause) {
    abort()
    await done.catch(() => undefined)
    if (signal?.aborted) throw new DOMException('Archive navigation cancelled', 'AbortError')
    throw cause
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
