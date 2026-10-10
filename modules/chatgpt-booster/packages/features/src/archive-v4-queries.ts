import { requestResult } from '@kobaproduction/browser-storage'
import type { ArchiveV4Conversation, ArchiveV4Message, ArchiveV4Project } from './archive-v4-entities'
import { identity, key } from './archive-v4-identities'

/** Native read-only source queries. The caller owns DB schema upgrades,
 * auth/account validation, write-generation fencing and transaction scope.
 * These do not scan canonical projections or mutate any source records. */
export async function listProjects(db: IDBDatabase, accountId: string): Promise<ArchiveV4Project[]> {
  const owner = identity(accountId, 'accountId')
  return requestResult<ArchiveV4Project[]>(db.transaction('projects', 'readonly')
    .objectStore('projects').index('byAccount').getAll(owner))
}

export async function getProject(db: IDBDatabase, accountId: string, projectId: string): Promise<ArchiveV4Project | undefined> {
  return requestResult<ArchiveV4Project | undefined>(db.transaction('projects', 'readonly')
    .objectStore('projects').get(key(identity(accountId, 'accountId'), identity(projectId, 'projectId'))))
}

export async function getConversation(db: IDBDatabase, accountId: string, conversationId: string): Promise<ArchiveV4Conversation | undefined> {
  return requestResult<ArchiveV4Conversation | undefined>(db.transaction('conversations', 'readonly')
    .objectStore('conversations').get(key(identity(accountId, 'accountId'), identity(conversationId, 'conversationId'))))
}

export async function listConversations(db: IDBDatabase, accountId: string): Promise<ArchiveV4Conversation[]> {
  const owner = identity(accountId, 'accountId')
  return requestResult<ArchiveV4Conversation[]>(db.transaction('conversations', 'readonly')
    .objectStore('conversations').index('byAccount').getAll(owner))
}

export async function getMessage(db: IDBDatabase, accountId: string, conversationId: string, messageId: string): Promise<ArchiveV4Message | undefined> {
  return requestResult<ArchiveV4Message | undefined>(db.transaction('messages', 'readonly')
    .objectStore('messages').get(key(
      key(identity(accountId, 'accountId'), identity(conversationId, 'conversationId')),
      identity(messageId, 'messageId'),
    )))
}
