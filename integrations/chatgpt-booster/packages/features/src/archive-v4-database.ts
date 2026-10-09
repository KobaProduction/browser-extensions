/**
 * Exact ChatGPT v4 physical IndexedDB layout and fail-closed open/validation.
 * Source signature checks, canonical model and migrations are separate owners.
 */
export const ARCHIVE_V4_DB_NAME = 'chatgpt-booster-archive-v4'
export const ARCHIVE_V4_DB_VERSION = 1

export class ArchiveV4Database {
  #opened: Promise<IDBDatabase> | undefined

  async open(): Promise<IDBDatabase> {
    this.#opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(ARCHIVE_V4_DB_NAME, ARCHIVE_V4_DB_VERSION)
      let abandoned = false
      open.onupgradeneeded = () => {
        if (abandoned) {
          open.transaction?.abort()
          return
        }
        const db = open.result
        // A partial/unknown schema is never implicitly cleared or reconstructed.
        if (db.objectStoreNames.length > 0) {
          open.transaction?.abort()
          return
        }
        const projects = db.createObjectStore('projects', { keyPath: 'key' })
        projects.createIndex('byAccount', 'accountId')
        const conversations = db.createObjectStore('conversations', { keyPath: 'key' })
        conversations.createIndex('byAccount', 'accountId')
        conversations.createIndex('byProject', ['accountId', 'projectId'])
        const messages = db.createObjectStore('messages', { keyPath: 'key' })
        messages.createIndex('byConversation', 'conversationKey')
        messages.createIndex('byChronology', ['conversationKey', 'sourceCreateTime', 'messageId'])
        const metadata = db.createObjectStore('metadata', { keyPath: 'key' })
        metadata.createIndex('byOwner', 'ownerKey')
        metadata.createIndex('byKind', ['ownerKey', 'kind'])
      }
      open.onsuccess = () => {
        const db = open.result
        if (abandoned) {
          db.close()
          return
        }
        const required: Record<
          string,
          { keyPath: string; indexes: Record<string, string | string[]> }
        > = {
          projects: { keyPath: 'key', indexes: { byAccount: 'accountId' } },
          conversations: {
            keyPath: 'key',
            indexes: { byAccount: 'accountId', byProject: ['accountId', 'projectId'] },
          },
          messages: {
            keyPath: 'key',
            indexes: {
              byConversation: 'conversationKey',
              byChronology: ['conversationKey', 'sourceCreateTime', 'messageId'],
            },
          },
          metadata: {
            keyPath: 'key',
            indexes: { byOwner: 'ownerKey', byKind: ['ownerKey', 'kind'] },
          },
        }
        try {
          if (db.objectStoreNames.length !== Object.keys(required).length)
            throw new Error('Unrecognized archive v4 storage schema')
          for (const [storeName, spec] of Object.entries(required)) {
            if (!db.objectStoreNames.contains(storeName))
              throw new Error('Unrecognized archive v4 storage schema')
            const store = db.transaction(storeName).objectStore(storeName)
            if (
              store.keyPath !== spec.keyPath ||
              store.indexNames.length !== Object.keys(spec.indexes).length
            )
              throw new Error('Unrecognized archive v4 storage schema')
            for (const [name, expected] of Object.entries(spec.indexes)) {
              if (!store.indexNames.contains(name))
                throw new Error('Unrecognized archive v4 storage index')
              const index = store.index(name)
              if (
                JSON.stringify(index.keyPath) !== JSON.stringify(expected) ||
                index.unique ||
                index.multiEntry
              )
                throw new Error('Unrecognized archive v4 storage index')
            }
          }
        } catch (error) {
          db.close()
          reject(error)
          return
        }
        db.onversionchange = () => {
          db.close()
          this.#opened = undefined
        }
        db.onclose = () => {
          this.#opened = undefined
        }
        resolve(db)
      }
      open.onerror = () => reject(open.error ?? new Error('Archive v4 open failed'))
      open.onblocked = () => {
        abandoned = true
        reject(new Error('Archive v4 database upgrade is blocked'))
      }
    }).catch((cause) => {
      this.#opened = undefined
      throw cause
    })
    return this.#opened
  }
}
