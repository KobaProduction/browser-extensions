import { expect, test } from 'bun:test'
import type {
  ArchiveV4Conversation,
  ArchiveV4Message,
  ArchiveV4Metadata,
  Source,
} from '../packages/features/src/archive-v4-entities'
import { key } from '../packages/features/src/archive-v4-identities'
import { writeArchiveMessages } from '../packages/features/src/archive-v4-message-write'
import { canonicalSourceJson } from '../packages/features/src/archive-v4-write'

function recordStore<T>() {
  const writes: T[] = []
  return {
    writes,
    store: {
      put: (row: T) => {
        writes.push(row)
      },
    } as unknown as IDBObjectStore,
  }
}

function summary(): ArchiveV4Conversation {
  return {
    key: key('account', 'chat'),
    accountId: 'account',
    conversationId: 'chat',
    projectId: null,
    title: null,
    currentNodeId: null,
    knownMessageCount: 0,
    unsequencedMessageCount: 0,
    firstKnownMessageId: null,
    lastKnownMessageId: null,
    firstKnownTime: null,
    lastKnownTime: null,
    verifiedPathRootId: null,
    verifiedPathTipId: null,
    coverage: 'unverified',
    revision: 1,
    firstSeenAt: 1,
    lastSeenAt: 1,
  }
}

function source(text: string, updateTime = 10, createTime: number | null = 10): Source {
  return {
    id: 'msg',
    create_time: createTime,
    update_time: updateTime,
    metadata: { parent_id: null },
    author: { role: 'user' },
    content: { content_type: 'text', parts: [text] },
  }
}
function input(raw: Source, fingerprint: string) {
  return { raw, canonical: canonicalSourceJson(raw), fingerprint }
}

test('native v4 message changes preserve previous snapshot and compact revision evidence atomically', () => {
  const messages = recordStore<ArchiveV4Message>()
  const metadata = recordStore<ArchiveV4Metadata>()
  const state = summary()
  const original = source('before')
  const initial = writeArchiveMessages({
    records: messages.store,
    metadata: metadata.store,
    messages: [input(original, 'hash-original')],
    previousMessages: [],
    summary: state,
    conversationKey: state.key,
    readId: 'initial',
    readStartedAt: 1,
    observedAt: 1,
  })
  expect(initial).toEqual({ inserted: 1, changed: 0, unchanged: 0, staleRecordCount: 0 })
  expect(state.knownMessageCount).toBe(1)
  expect(state.firstKnownMessageId).toBe('msg')
  expect(state.lastKnownMessageId).toBe('msg')
  const previous = messages.writes[0]
  expect(previous?.revision).toBe(1)

  const updated = writeArchiveMessages({
    records: messages.store,
    metadata: metadata.store,
    messages: [input(source('after', 20), 'hash-new')],
    previousMessages: [previous],
    summary: state,
    conversationKey: state.key,
    readId: 'new-read',
    readStartedAt: 2,
    observedAt: 2,
  })
  expect(updated).toEqual({ inserted: 0, changed: 1, unchanged: 0, staleRecordCount: 0 })
  expect(messages.writes[1]?.revision).toBe(2)
  expect(messages.writes[1]?.sourceFingerprint).toBe('hash-new')
  expect(metadata.writes.map((item) => item.kind)).toEqual([
    'message-snapshot',
    'message-revision-evidence',
  ])
  expect(metadata.writes[0]?.payload.raw).toEqual(original)
  expect(metadata.writes[1]?.payload.revision).toBe(1)
  expect(state.knownMessageCount).toBe(1)
})

test('older native read cannot replace a newer message or invent a revision', () => {
  const messages = recordStore<ArchiveV4Message>()
  const metadata = recordStore<ArchiveV4Metadata>()
  const state = summary()
  const previous: ArchiveV4Message = {
    key: key(state.key, 'msg'),
    conversationKey: state.key,
    messageId: 'msg',
    parentId: null,
    parentKnown: true,
    sourceCreateTime: 10,
    firstSeenAt: 1,
    lastSeenAt: 20,
    revision: 2,
    sourceReadId: 'fresh',
    sourceReadStartedAt: 20,
    sourceFingerprint: 'current',
    raw: source('saved', 20),
  }
  const result = writeArchiveMessages({
    records: messages.store,
    metadata: metadata.store,
    messages: [input(source('stale', 10), 'old')],
    previousMessages: [previous],
    summary: state,
    conversationKey: state.key,
    readId: 'old',
    readStartedAt: 1,
    observedAt: 2,
  })
  expect(result).toEqual({ inserted: 0, changed: 0, unchanged: 1, staleRecordCount: 1 })
  expect(messages.writes).toEqual([])
  expect(metadata.writes).toEqual([])
})

test('existing message with inconsistent native creation timestamp fails closed', () => {
  const state = summary(),
    messages = recordStore<ArchiveV4Message>()
  const previous: ArchiveV4Message = {
    key: key(state.key, 'msg'),
    conversationKey: state.key,
    messageId: 'msg',
    parentId: null,
    parentKnown: true,
    sourceCreateTime: 10,
    firstSeenAt: 1,
    lastSeenAt: 1,
    revision: 1,
    raw: source('first'),
  }
  expect(() =>
    writeArchiveMessages({
      records: messages.store,
      metadata: recordStore<ArchiveV4Metadata>().store,
      messages: [input(source('second', 20, 11), 'new')],
      previousMessages: [previous],
      summary: state,
      conversationKey: state.key,
      readId: 'new',
      readStartedAt: 20,
      observedAt: 20,
    }),
  ).toThrow('archive.error.sourceChanged')
})
