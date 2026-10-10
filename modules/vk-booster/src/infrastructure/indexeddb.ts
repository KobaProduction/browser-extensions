import {
  scopedVkDatabaseName,
  type VkArchiveBackup,
  type VkArchiveRepository,
  type VkConversation,
  type VkFileReceipt,
  type VkMessage,
  validateBackup,
} from '../model/types'

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result)
    source.onerror = () => reject(source.error ?? Error('IndexedDB request failed'))
  })
}
function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? Error('IndexedDB transaction aborted'))
  })
}
export function createIndexedVkArchive(
  scope: string,
  factory: IDBFactory = indexedDB,
): VkArchiveRepository {
  const name = scopedVkDatabaseName(scope)
  let opening: Promise<IDBDatabase> | null = null
  const connect = (): Promise<IDBDatabase> => {
    if (!opening) {
      opening = new Promise<IDBDatabase>((resolve, reject) => {
        const req = factory.open(name, 1)
        req.onupgradeneeded = () => {
          const db = req.result
          db.createObjectStore('conversations', { keyPath: 'peerId' })
          const messages = db.createObjectStore('messages', { keyPath: ['peerId', 'id'] })
          messages.createIndex('peerId', 'peerId')
          const receipts = db.createObjectStore('receipts', { keyPath: 'key' })
          receipts.createIndex('peerId', 'peerId')
        }
        req.onsuccess = () => {
          req.result.onversionchange = () => req.result.close()
          resolve(req.result)
        }
        req.onerror = () => reject(req.error ?? Error('Unable to open VK native archive'))
        req.onblocked = () => reject(Error('VK archive upgrade blocked by another tab'))
      }).catch((e: unknown) => {
        opening = null
        throw e
      })
    }
    return opening
  }
  return {
    async listConversations() {
      const db = await connect()
      const tx = db.transaction('conversations', 'readonly')
      const result = await request(
        tx.objectStore('conversations').getAll() as IDBRequest<VkConversation[]>,
      )
      await finished(tx)
      return result
    },
    async getConversation(peerId) {
      const db = await connect()
      const tx = db.transaction('conversations', 'readonly')
      const value = await request(
        tx.objectStore('conversations').get(peerId) as IDBRequest<VkConversation | undefined>,
      )
      await finished(tx)
      return value ?? null
    },
    async storePage(peerId, messages) {
      if (messages.some((m) => m.peerId !== peerId)) throw Error('Cross-conversation page rejected')
      const db = await connect()
      const tx = db.transaction(['conversations', 'messages'], 'readwrite')
      const store = tx.objectStore('messages')
      for (const row of messages) store.put(row)
      const index = store.index('peerId')
      const count = index.count(IDBKeyRange.only(peerId))
      count.onsuccess = () =>
        tx.objectStore('conversations').put({
          peerId,
          complete: false,
          messageCount: count.result,
          updatedAt: Date.now(),
        } satisfies VkConversation)
      await finished(tx)
    },
    async markComplete(peerId) {
      const db = await connect()
      const tx = db.transaction('conversations', 'readwrite')
      const s = tx.objectStore('conversations')
      const req = s.get(peerId)
      req.onsuccess = () => {
        const c = req.result as VkConversation | undefined
        if (c) s.put({ ...c, complete: true, updatedAt: Date.now() })
        else tx.abort()
      }
      await finished(tx)
    },
    async listMessages(peerId) {
      const db = await connect()
      const tx = db.transaction('messages', 'readonly')
      const results = await request(
        tx.objectStore('messages').index('peerId').getAll(IDBKeyRange.only(peerId)) as IDBRequest<
          VkMessage[]
        >,
      )
      await finished(tx)
      return results.sort((a, b) => a.date - b.date || a.id - b.id)
    },
    async listReceipts(peerId, exportId) {
      const db = await connect()
      const tx = db.transaction('receipts', 'readonly')
      const result = await request(
        tx.objectStore('receipts').index('peerId').getAll(IDBKeyRange.only(peerId)) as IDBRequest<
          VkFileReceipt[]
        >,
      )
      await finished(tx)
      return result.filter((r) => r.exportId === exportId)
    },
    async putReceipt(receipt) {
      const db = await connect()
      const tx = db.transaction('receipts', 'readwrite')
      tx.objectStore('receipts').put(receipt)
      await finished(tx)
    },
    async backup() {
      const db = await connect()
      const tx = db.transaction(['conversations', 'messages', 'receipts'], 'readonly')
      // Create all requests in the same read transaction, never across source revisions.
      const chats = request(tx.objectStore('conversations').getAll() as IDBRequest<VkConversation[]>)
      const messages = request(tx.objectStore('messages').getAll() as IDBRequest<VkMessage[]>)
      const receipts = request(tx.objectStore('receipts').getAll() as IDBRequest<VkFileReceipt[]>)
      const [conversations, rows, files] = await Promise.all([chats, messages, receipts])
      await finished(tx)
      return {
        format: 'koba-vk-native-archive',
        schema: 1,
        scope,
        exportedAt: Date.now(),
        conversations,
        messages: rows,
        receipts: files,
      } satisfies VkArchiveBackup
    },
    async restore(backup) {
      validateBackup(backup, scope)
      const db = await connect()
      const tx = db.transaction(['conversations', 'messages', 'receipts'], 'readwrite')
      for (const store of ['conversations', 'messages', 'receipts']) tx.objectStore(store).clear()
      for (const row of backup.conversations) tx.objectStore('conversations').put(row)
      for (const row of backup.messages) tx.objectStore('messages').put(row)
      for (const row of backup.receipts) tx.objectStore('receipts').put(row)
      await finished(tx)
    },
  }
}
