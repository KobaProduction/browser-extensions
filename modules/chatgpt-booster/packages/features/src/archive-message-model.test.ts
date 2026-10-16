import { expect, test } from 'bun:test'
import { DEFAULT_EXPORT_OPTIONS } from '@chatgpt-booster/core'
import {
  archiveMessageText,
  decodeArchiveClone,
  encodeArchiveClone,
} from '@kobaproduction/browser-archive'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedVkDexieRepository } from '../../../../vk-booster/src/features/chat-export/model/archive-fixed-dexie'
import { FixedCanonicalDexieRepository, type SourceObservation } from './archive-fixed-dexie'
import { exportFixedConversation } from './archive-fixed-export'

const driver = { indexedDB, IDBKeyRange }
const scope = (productId: string, installationId: string) => ({
  productId,
  channel: 'dev' as const,
  installationId,
  ownerId: 'synthetic-model-owner',
})
const observation = (): SourceObservation => ({
  accountId: 'synthetic-model-owner',
  conversationId: 'conversation',
  projectId: 'project',
  sourceKind: 'synthetic-native',
  sourceVersion: 'v1',
  observedAtMs: 1234,
  raw: {
    id: 'message',
    author: { role: 'assistant' },
    create_time: 1700000000,
    metadata: { parent_id: null, request_id: 'request' },
    recipient: 'all',
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true,
    content: { content_type: 'text', parts: ['Synthetic answer'] },
  },
})

async function snapshotRow(
  name: string,
  key: string,
  mutate?: (value: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const transaction = connection.transaction('snapshots', mutate ? 'readwrite' : 'readonly')
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
    const table = transaction.objectStore('snapshots')
    const value = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = table.get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (mutate) {
      mutate(value)
      table.put(value)
    }
    await completed
    return value
  } finally {
    connection.close()
  }
}
test('both providers persist the same normalized model and legacy reads adapt without rewriting schema-1 rows', async () => {
  const chat = new FixedCanonicalDexieRepository(scope('chatgpt-booster', 'model-legacy-chat'), driver)
  const vk = new FixedVkDexieRepository(scope('vk-booster', 'model-legacy-vk'), driver)
  try {
    const input = observation(),
      chatKey = await chat.addObservation(input)
    const vkRaw = {
      id: 7,
      peer_id: 42,
      date: 1700000000,
      from_id: -9,
      text: 'Synthetic VK',
      reply_message: { id: 3, date: 1690000000 },
    }
    const vkKey = await vk.addOriginal(42, vkRaw, 'v1', 1234)
    expect((await snapshotRow(chat.databaseName, chatKey)).normalized).toMatchObject({
      schema: 'koba.message',
      modelVersion: 1,
    })
    expect((await snapshotRow(vk.databaseName, vkKey)).normalized).toMatchObject({
      schema: 'koba.message',
      modelVersion: 1,
    })
    await snapshotRow(chat.databaseName, chatKey, (row) => {
      delete row.normalized
      delete row.projectId
    })
    await snapshotRow(vk.databaseName, vkKey, (row) => {
      delete row.normalized
    })
    const a = (await chat.getSourceSnapshot('conversation', 'message'))?.normalized
    const b = (await vk.getOriginal(42, 7))?.normalized
    expect(a).toMatchObject({
      identity: { providerId: 'chatgpt-booster' },
      context: { projectId: 'project', requestId: 'request' },
      time: { createdAtMs: 1700000000000 },
    })
    expect(b).toMatchObject({
      identity: { providerId: 'vk-booster' },
      author: { id: '-9' },
      links: { parentObserved: false, replyToId: '3' },
      evidence: { terminal: 'unknown' },
    })
    expect((await snapshotRow(chat.databaseName, chatKey)).normalized).toBeUndefined()
    expect((await snapshotRow(vk.databaseName, vkKey)).normalized).toBeUndefined()
    expect(chat.backupPort().schemaVersion).toBe(1)
    expect(vk.backupPort().schemaVersion).toBe(1)
  } finally {
    chat.close()
    vk.close()
  }
})
test('preferred/variant DTOs and ordinary export share the stored authority; dedup emits no new commit DTO', async () => {
  const chat = new FixedCanonicalDexieRepository(scope('chatgpt-booster', 'model-versions'), driver)
  try {
    const input = observation(),
      first = await chat.addObservationResult(input)
    expect(first.normalized?.schema).toBe('koba.message')
    expect((await chat.addObservationResult(input)).normalized).toBeUndefined()
    const changed = {
      ...input,
      observedAtMs: 2000,
      raw: { ...input.raw, content: { content_type: 'text', parts: ['Conflicting answer'] } },
    }
    const committed = await chat.addObservationResult(changed)
    expect(committed.normalized?.source.variantIndex).toBe(1)
    const preferred = await chat.getSourceSnapshot('conversation', 'message'),
      versions = await chat.messageVersions('conversation', 'message')
    if (!preferred?.normalized) throw Error('Expected persisted normalized message')
    expect(archiveMessageText(preferred.normalized)).toBe('Synthetic answer')
    expect(versions.map((version) => version.normalized?.source.variantIndex)).toEqual([0, 1])
    const output = await exportFixedConversation(
      chat,
      'conversation',
      { ...DEFAULT_EXPORT_OPTIONS, format: 'json', level: 'full', sourceRevisions: true },
      () => {},
    )
    const document = JSON.parse(await output.blob.text())
    expect(document.turns[0].messages[0].normalized).toEqual(preferred?.normalized)
    expect(document.coverage.sourceVersions.message[1].normalized).toEqual(committed.normalized)
  } finally {
    chat.close()
  }
})
test('unknown signatures retain opaque references and lossless companions, while tampered metadata is rejected before restore', async () => {
  const chat = new FixedCanonicalDexieRepository(scope('chatgpt-booster', 'model-opaque'), driver)
  try {
    const input = observation()
    input.raw = {
      ...input.raw,
      content: { content_type: 'future-unknown', future: new Uint8Array([3, 5]) },
      future_native: { count: 123n, map: new Map([['future', 7]]) },
    }
    await chat.addObservation(input)
    const source = await chat.getSourceSnapshot('conversation', 'message')
    expect(source?.normalized?.content.coverage).toBe('contains-opaque')
    if (!source?.normalized) throw Error('Expected opaque normalized message')
    expect(archiveMessageText(source.normalized)).toBe('')
    const exported = await exportFixedConversation(
      chat,
      'conversation',
      { ...DEFAULT_EXPORT_OPTIONS, format: 'json', level: 'full' },
      () => {},
    )
    const document = JSON.parse(await exported.blob.text()),
      message = [...document.turns[0].messages, ...document.turns[0].details][0]
    expect(message.normalized.content.coverage).toBe('contains-opaque')
    const original = decodeArchiveClone(message.originalRecord) as typeof input.raw
    expect((original.future_native as { count: bigint }).count).toBe(123n)
    const port = chat.backupPort(),
      rows = []
    for await (const row of port.readRows(128)) rows.push(row)
    const row = rows.find((row) => row.store === 'snapshots')
    if (!row) throw Error('Expected source row')
    const snapshot = decodeArchiveClone(row.value) as { normalized: { author: { role: string } } }
    snapshot.normalized.author.role = 'fabricated'
    rows[rows.indexOf(row)] = { ...row, value: await encodeArchiveClone(snapshot) }
    await expect(port.validateRows(rows)).rejects.toThrow('source evidence')
    expect((await chat.getSourceSnapshot('conversation', 'message'))?.raw).toEqual(input.raw)
  } finally {
    chat.close()
  }
})

const nativeObservationCases: readonly [string, unknown, unknown][] = [
  ['map', new Map([['key', 1]]), new Map([['key', 2]])],
  ['set', new Set([1]), new Set([2])],
  ['date', new Date(1), new Date(2)],
  ['blob', new Blob(['first']), new Blob(['other'])],
  ['buffer', new Uint8Array([1]).buffer, new Uint8Array([2]).buffer],
  ['bigint', 1n, 2n],
  ['undefined', { key: undefined }, {}],
]
test.each(nativeObservationCases)(
  'canonical repeated and changed %s values reconcile without loss',
  async (name, before, after) => {
    const chat = new FixedCanonicalDexieRepository(
      scope('chatgpt-booster', `model-repeat-${name}`),
      driver,
    )
    try {
      const input = observation()
      input.raw.future_native = before
      expect((await chat.addObservationResult(input)).normalized).toBeDefined()
      expect((await chat.addObservationResult(structuredClone(input))).normalized).toBeUndefined()
      const changed = structuredClone(input)
      changed.raw.future_native = after
      expect((await chat.addObservationResult(changed)).normalized).toBeDefined()
      expect((await chat.addObservationResult(structuredClone(changed))).normalized).toBeUndefined()
      const versions = await chat.messageVersions('conversation', 'message')
      expect(versions).toHaveLength(2)
      expect(versions[0]?.raw.future_native).toEqual(before)
      expect(versions[1]?.raw.future_native).toEqual(after)
    } finally {
      chat.close()
    }
  },
)

test('changed native source events retain a new variant while repeated events deduplicate', async () => {
  const chat = new FixedCanonicalDexieRepository(scope('chatgpt-booster', 'model-native-events'), driver)
  try {
    const input = observation()
    input.sourceEvents = [{ future: new Blob(['first']), count: 1n }]
    await chat.addObservationResult(input)
    expect((await chat.addObservationResult(structuredClone(input))).normalized).toBeUndefined()
    const changed = structuredClone(input)
    changed.sourceEvents = [{ future: new Blob(['other']), count: 2n }]
    expect((await chat.addObservationResult(changed)).normalized).toBeDefined()
    expect((await chat.addObservationResult(structuredClone(changed))).normalized).toBeUndefined()
    const versions = await chat.messageVersions('conversation', 'message')
    expect(versions).toHaveLength(2)
    const first = versions[0]?.sourceEvents?.[0]?.future
    const second = versions[1]?.sourceEvents?.[0]?.future
    if (!(first instanceof Blob) || !(second instanceof Blob)) throw Error('Expected native event Blob')
    expect(await first.text()).toBe('first')
    expect(await second.text()).toBe('other')
  } finally {
    chat.close()
  }
})

test.each(['channel', 'recipient'])(
  'opaque optional %s context remains lossless across identical and changed repository observations',
  async (field) => {
    const chat = new FixedCanonicalDexieRepository(
      scope('chatgpt-booster', `model-context-${field}`),
      driver,
    )
    try {
      const input = observation()
      input.raw[field] = new Map([['future', 1]])
      expect((await chat.addObservationResult(input)).normalized).toBeDefined()
      expect((await chat.addObservationResult(structuredClone(input))).normalized).toBeUndefined()
      const changed = structuredClone(input)
      changed.raw[field] = new Map([['future', 2]])
      expect((await chat.addObservationResult(changed)).normalized).toBeDefined()
      expect((await chat.addObservationResult(structuredClone(changed))).normalized).toBeUndefined()
      const versions = await chat.messageVersions('conversation', 'message')
      expect(versions).toHaveLength(2)
      expect(versions[0]?.raw[field]).toEqual(new Map([['future', 1]]))
      expect(versions[1]?.raw[field]).toEqual(new Map([['future', 2]]))
      expect(versions[1]?.decision).toBe('conflict')
    } finally {
      chat.close()
    }
  },
)

test('opaque status objects do not invoke native scalar coercion during repository reconciliation', async () => {
  const chat = new FixedCanonicalDexieRepository(
    scope('chatgpt-booster', 'model-context-status'),
    driver,
  )
  try {
    const input = observation()
    input.raw.status = { toString: 'future-status', valueOf: 0, future: 1 }
    await chat.addObservationResult(input)
    const changed = structuredClone(input)
    changed.raw.status = { toString: 'future-status', valueOf: 0, future: 2 }
    expect((await chat.addObservationResult(changed)).normalized).toBeDefined()
    expect(await chat.messageVersions('conversation', 'message')).toHaveLength(2)
  } finally {
    chat.close()
  }
})
