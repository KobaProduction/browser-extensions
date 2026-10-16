import { expect, test } from 'bun:test'
import { DEFAULT_EXPORT_OPTIONS } from '@chatgpt-booster/core'
import { decodeArchiveClone } from '@kobaproduction/browser-archive'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { FixedCanonicalDexieRepository, type SourceObservation } from './archive-fixed-dexie'
import { exportFixedConversation } from './archive-fixed-export'

const driver = { indexedDB, IDBKeyRange }
function repository(installationId: string) {
  return new FixedCanonicalDexieRepository(
    { productId: 'chatgpt-booster', channel: 'dev', installationId, ownerId: 'synthetic-reader-owner' },
    driver,
  )
}
function observation(
  id: string,
  parentId: string | null,
  index: number,
  patch: Record<string, unknown> = {},
): SourceObservation {
  return {
    accountId: 'synthetic-reader-owner',
    conversationId: 'synthetic-reader',
    sourceKind: 'synthetic',
    sourceVersion: 'reader-contract-v1',
    observedAtMs: 1000 + index,
    raw: {
      id,
      create_time: index + 1,
      author: { role: index % 2 ? 'assistant' : 'user' },
      channel: index % 2 ? 'final' : null,
      recipient: 'all',
      status: 'finished_successfully',
      content: { content_type: 'text', parts: [`Synthetic message ${index}`] },
      metadata: { parent_id: parentId },
      ...patch,
    },
  }
}
const ids = (rows: readonly { messageId: string }[]) => rows.map((row) => row.messageId)

test('windows and both boundaries share one revision-pinned chronology scan, including concurrent reads', async () => {
  const db = repository('synthetic-reader-one-plan')
  try {
    for (let index = 0; index < 40; index++)
      await db.addObservation(observation(`m-${index}`, null, index))
    let reads = 0
    const internals = db as unknown as {
      db: { messages: { hook(name: 'reading', listener: (row: unknown) => unknown): void } }
    }
    internals.db.messages.hook('reading', (row) => {
      reads++
      return row
    })
    const [window, before, after] = await Promise.all([
      db.windowMessages('synthetic-reader', 'first', undefined, 10),
      db.hasMessageBoundary('synthetic-reader', 'm-0', 'before'),
      db.hasMessageBoundary('synthetic-reader', 'm-9', 'after'),
    ])
    expect(window).toHaveLength(10)
    expect([before, after]).toEqual([false, true])
    expect(reads).toBe(50)
    await db.windowMessages('synthetic-reader', 'newer', 'm-9', 10)
    expect(reads).toBe(60)
    await db.addObservation(observation('new-row', 'm-39', 40))
    reads = 0
    expect((await db.windowMessages('synthetic-reader', 'older', undefined, 10)).at(-1)?.messageId).toBe(
      'new-row',
    )
    expect(reads).toBe(51)
  } finally {
    db.close()
  }
})

test('mutation between chronology planning and bounded materialization rejects instead of mixing source revisions', async () => {
  const db = repository('synthetic-reader-plan-race')
  try {
    await db.addObservation(observation('initial', null, 0))
    const internals = db as unknown as { chronologyPlan(id: string): Promise<unknown> }
    const plan = internals.chronologyPlan.bind(db)
    internals.chronologyPlan = async (id) => {
      const result = await plan(id)
      await db.addObservation(observation('racing', 'initial', 1))
      return result
    }
    await expect(db.windowMessages('synthetic-reader', 'first')).rejects.toThrow('sourceChanged')
  } finally {
    db.close()
  }
})

test('ordinary export rejects a peer delete/recreate even when its numeric revision and record count are unchanged', async () => {
  const a = repository('synthetic-export-peer-aba'),
    b = repository('synthetic-export-peer-aba')
  try {
    await a.addObservation(observation('same-message', null, 0))
    const original = a.integrity.bind(a)
    a.integrity = async (id) => {
      const result = await original(id)
      await b.backupPort().restoreAtomically([])
      await b.addObservation(
        observation('same-message', null, 0, {
          content: { content_type: 'text', parts: ['recreated source'] },
        }),
      )
      return result
    }
    await expect(
      exportFixedConversation(
        a,
        'synthetic-reader',
        { ...DEFAULT_EXPORT_OPTIONS, format: 'json', packaging: 'none' },
        () => {},
      ),
    ).rejects.toThrow('sourceChanged')
  } finally {
    a.close()
    b.close()
  }
})

test('source chronology drives bounded first/middle/latest windows and cross-page ranges, not lexical IDs', async () => {
  const db = repository('synthetic-reader-chronology')
  const names = Array.from(
    { length: 321 },
    (_, index) => `random-${String(999 - index).padStart(4, '0')}`,
  )
  const nameAt = (index: number) => {
    const name = names[index]
    if (name === undefined) throw new Error(`Synthetic message ${index} is missing`)
    return name
  }
  try {
    for (const [index, id] of names.entries())
      await db.addObservation(observation(id, names[index - 1] ?? null, index))
    const first = await db.windowMessages('synthetic-reader', 'first')
    const middle = await db.windowMessages('synthetic-reader', 'middle')
    const latest = await db.windowMessages('synthetic-reader', 'older')
    expect(ids(first)).toEqual(names.slice(0, 160))
    expect(ids(middle)).toEqual(names.slice(80, 240))
    expect(ids(latest)).toEqual(names.slice(161))
    expect(await db.messageRangeIds('synthetic-reader', nameAt(290), nameAt(20))).toEqual(
      names.slice(20, 291),
    )
    await expect(db.messageRangeIds('synthetic-reader', 'not-saved', nameAt(20))).rejects.toThrow(
      'messageMissing',
    )
    const timeline = await db.timelineMessages('synthetic-reader')
    expect(timeline.map((row) => row.id)).toEqual(names)
    expect(timeline[160]).toMatchObject({
      id: names[160],
      parentId: names[159],
      parentKnown: true,
      sourceCreateTime: 161,
    })
    expect(timeline.every((row) => !('raw' in row) && row.preview.length <= 160)).toBe(true)
    expect(await db.hasMessageBoundary('synthetic-reader', nameAt(0), 'before')).toBe(false)
    expect(await db.hasMessageBoundary('synthetic-reader', nameAt(320), 'after')).toBe(false)
  } finally {
    db.close()
  }
})

test('explicit root proof and independent end evidence remain truthful before export, and a gap prevents completeness', async () => {
  const db = repository('synthetic-reader-boundaries')
  try {
    const first = observation('root', null, 0)
    const final = observation('answer', 'root', 1, { end_turn: true })
    await db.addObservation(first)
    await db.addObservation(final)
    expect(await db.integrity('synthetic-reader')).toMatchObject({
      start: 'verified',
      end: 'unknown',
      chain: 'unknown',
    })
    await db.recordPageEvidence(
      'synthetic-reader',
      {
        readId: 'bottom',
        isInitial: true,
        startCursor: 'root',
        endCursor: 'answer',
        hasPreviousPage: true,
        hasNextPage: false,
        observedAt: 10,
      },
      'answer',
    )
    expect(await db.integrity('synthetic-reader')).toMatchObject({
      start: 'verified',
      end: 'verified',
      chain: 'verified',
    })
    await db.recordPageEvidence(
      'synthetic-reader',
      {
        readId: 'full',
        isInitial: true,
        startCursor: 'root',
        endCursor: 'answer',
        hasPreviousPage: false,
        hasNextPage: false,
        observedAt: 20,
      },
      'answer',
    )
    expect(await db.integrity('synthetic-reader')).toMatchObject({
      start: 'verified',
      end: 'verified',
      chain: 'verified',
      firstMessageId: 'root',
      lastMessageId: 'answer',
    })
    const all = await exportFixedConversation(
      db,
      'synthetic-reader',
      { ...DEFAULT_EXPORT_OPTIONS, format: 'json', packaging: 'none' },
      () => {},
    )
    expect(all.complete).toBe(true)
    const selected = await exportFixedConversation(
      db,
      'synthetic-reader',
      { ...DEFAULT_EXPORT_OPTIONS, format: 'json', packaging: 'none', messageIds: ['answer'] },
      () => {},
    )
    expect(selected.complete).toBe(false)
    const selectedDocument = JSON.parse(await selected.blob.text())
    expect(selectedDocument.coverage.selectedMessageIds).toEqual(['answer'])
    await db.addObservation(observation('orphan', 'not-saved', 2))
    const broken = await db.integrity('synthetic-reader')
    expect(broken.chain).toBe('gaps')
    expect(
      broken.issues.some((issue) => issue.reason === 'missing-parent' && issue.parentId === 'not-saved'),
    ).toBe(true)
    expect(
      (
        await exportFixedConversation(
          db,
          'synthetic-reader',
          { ...DEFAULT_EXPORT_OPTIONS, format: 'text', packaging: 'none' },
          () => {},
        )
      ).complete,
    ).toBe(false)
  } finally {
    db.close()
  }
})

test('unknown parent evidence and user end-turn do not manufacture a complete assistant answer', async () => {
  const db = repository('synthetic-reader-unknown')
  try {
    const input = observation('user-input', null, 0, { metadata: {}, end_turn: true })
    await db.addObservation(input)
    await db.recordStreamHead('synthetic-reader', input.raw)
    expect(await db.integrity('synthetic-reader')).toMatchObject({
      start: 'unknown',
      end: 'unknown',
      chain: 'unknown',
    })
    expect((await db.getConversation('synthetic-reader'))?.terminalHeadId).toBeNull()
    expect(
      (
        await exportFixedConversation(
          db,
          'synthetic-reader',
          { ...DEFAULT_EXPORT_OPTIONS, format: 'json', packaging: 'none' },
          () => {},
        )
      ).complete,
    ).toBe(false)
  } finally {
    db.close()
  }
})

test('branch paths and conflicting source versions survive a full export with useful observed context', async () => {
  const db = repository('synthetic-reader-branches')
  try {
    await db.addObservation(observation('root', null, 0))
    const answer = observation('answer-a', 'root', 1, {
      end_turn: true,
      metadata: {
        parent_id: 'root',
        request_id: 'observed-request',
        turn_exchange_id: 'observed-turn',
        working_turn_id: 'observed-work',
        model_slug: 'requested-model',
        resolved_model_slug: 'resolved-model',
        unknown_future_field: { preserved: true },
      },
    })
    await db.addObservation(answer)
    await db.addObservation(
      observation('answer-b', 'root', 2, {
        author: { role: 'assistant' },
        channel: 'final',
        end_turn: true,
      }),
    )
    await db.addObservation({
      ...answer,
      observedAtMs: 2000,
      raw: { ...answer.raw, content: { content_type: 'text', parts: ['Conflicting variant'] } },
    })
    expect(await db.branchPath('synthetic-reader', 'answer-b')).toEqual(['root', 'answer-b'])
    expect((await db.integrity('synthetic-reader')).branches).toEqual([
      { parentId: 'root', messageIds: ['answer-a', 'answer-b'] },
    ])
    expect(await db.messageVersions('synthetic-reader', 'answer-a')).toHaveLength(2)
    const full = await exportFixedConversation(
      db,
      'synthetic-reader',
      {
        ...DEFAULT_EXPORT_OPTIONS,
        level: 'full',
        format: 'json',
        packaging: 'none',
        sourceRevisions: true,
      },
      () => {},
    )
    const document = JSON.parse(await full.blob.text())
    const exported = document.turns.flatMap((turn: { messages: unknown[]; details: unknown[] }) => [
      ...turn.messages,
      ...turn.details,
    ])
    const preferred = exported.find((record: { id: string }) => record.id === 'answer-a')
    expect(preferred.text).toBe('Synthetic message 1')
    expect(preferred.context).toMatchObject({
      schema: 'chatgpt-source-context.v1',
      requestId: 'observed-request',
      turnExchangeId: 'observed-turn',
      workingTurnId: 'observed-work',
      requestedModel: 'requested-model',
      resolvedModel: 'resolved-model',
    })
    expect(preferred.originalRecord.metadata.unknown_future_field).toEqual({ preserved: true })
    expect(document.coverage.sourceVersions['answer-a']).toHaveLength(2)
  } finally {
    db.close()
  }
})
test('stored native cross-conversation origins project known metadata and keep ambiguous origins unknown', async () => {
  const db = repository('synthetic-origin-projection')
  try {
    await db.addObservation(observation('ordinary', null, 0))
    expect(await db.branchOrigin('synthetic-reader')).toEqual({ conversationId: null, title: null })
    await db.addObservation(
      observation('known-origin', 'ordinary', 1, {
        metadata: {
          parent_id: 'ordinary',
          branching_from_conversation_id: 'parent-not-loaded',
          branching_from_conversation_title: 'Known parent',
        },
      }),
    )
    expect(await db.branchOrigin('synthetic-reader')).toEqual({
      conversationId: 'parent-not-loaded',
      title: 'Known parent',
    })
    await db.addObservation(
      observation('conflicting-origin', 'known-origin', 2, {
        metadata: {
          parent_id: 'known-origin',
          branching_from_conversation_id: 'different-native-parent',
          branching_from_conversation_title: 'Other parent',
        },
      }),
    )
    expect(await db.branchOrigin('synthetic-reader')).toEqual({ conversationId: null, title: null })
  } finally {
    db.close()
  }
})

test('an archive mutation during initial export inspection cannot adopt a newer header as its source pin', async () => {
  const db = repository('synthetic-reader-export-fence')
  try {
    await db.addObservation(observation('root', null, 0))
    const count = db.countConversation.bind(db)
    db.countConversation = async (conversationId) => {
      await db.addObservation(observation('late', 'root', 1))
      return count(conversationId)
    }
    await expect(
      exportFixedConversation(
        db,
        'synthetic-reader',
        { ...DEFAULT_EXPORT_OPTIONS, format: 'json', packaging: 'none' },
        () => {},
      ),
    ).rejects.toThrow('sourceChanged')
  } finally {
    db.close()
  }
})

test('full ordinary exports preserve native source values through an explicit codec instead of silently stringifying them away', async () => {
  const db = repository('synthetic-reader-native-values')
  try {
    await db.addObservation(
      observation('native', null, 1, {
        unknown_native: {
          binary: new Uint8Array([1, 2, 3]),
          mapping: new Map([['future-key', 7]]),
          blob: new Blob(['synthetic binary source'], { type: 'text/plain' }),
          optional: undefined,
        },
      }),
    )
    const output = await exportFixedConversation(
      db,
      'synthetic-reader',
      { ...DEFAULT_EXPORT_OPTIONS, level: 'full', format: 'json', packaging: 'none' },
      () => {},
    )
    const document = JSON.parse(await output.blob.text())
    const item = document.turns.flatMap((turn: { messages: unknown[] }) => turn.messages)[0]
    expect(item.originalRecordEncoding).toBe('archive-clone-v1')
    const raw = decodeArchiveClone(item.originalRecord) as {
      unknown_native: {
        binary: Uint8Array
        mapping: Map<string, number>
        blob: Blob
        optional?: unknown
      }
    }
    expect([...raw.unknown_native.binary]).toEqual([1, 2, 3])
    expect(raw.unknown_native.mapping.get('future-key')).toBe(7)
    expect(await raw.unknown_native.blob.text()).toBe('synthetic binary source')
    expect(Object.hasOwn(raw.unknown_native, 'optional')).toBe(true)
    expect(document.coverage.sourceVersionsEncoding.native).toBe('archive-clone-v1')
    const versions = decodeArchiveClone(document.coverage.sourceVersions.native) as { raw: typeof raw }[]
    expect(versions[0]?.raw.unknown_native.mapping.get('future-key')).toBe(7)
  } finally {
    db.close()
  }
})

test('owner change during the final persisted export check cannot release a prepared download', async () => {
  const db = repository('synthetic-reader-final-owner')
  let ownerValid = true,
    packaging = false
  try {
    await db.addObservation(observation('root', null, 0))
    const read = db.getConversation.bind(db)
    db.getConversation = async (id) => {
      const header = await read(id)
      if (packaging) ownerValid = false
      return header
    }
    await expect(
      exportFixedConversation(
        db,
        'synthetic-reader',
        { ...DEFAULT_EXPORT_OPTIONS, format: 'json', packaging: 'zip' },
        () => {
          if (!ownerValid) throw Error('Owner changed')
        },
        undefined,
        (progress) => {
          if (progress.phase === 'packaging') packaging = true
        },
      ),
    ).rejects.toThrow('Owner changed')
  } finally {
    db.close()
  }
})

test('ordinary gzip export uses the same lossless JSON document and checks cancellation while formatting', async () => {
  const db = repository('synthetic-reader-chunked-gzip')
  try {
    await db.addObservation(
      observation('root', null, 0, { content: { content_type: 'text', parts: ['🙂'.repeat(40000)] } }),
    )
    const result = await exportFixedConversation(
      db,
      'synthetic-reader',
      { ...DEFAULT_EXPORT_OPTIONS, level: 'full', format: 'json', packaging: 'gzip' },
      () => {},
    )
    const unpacked = await new Response(
      result.blob.stream().pipeThrough(new DecompressionStream('gzip')),
    ).text()
    const document = JSON.parse(unpacked)
    expect(document.turns[0].messages[0].text).toBe('🙂'.repeat(40000))
    expect(document.coverage.sourceVersions.root).toHaveLength(1)
    const controller = new AbortController()
    await expect(
      exportFixedConversation(
        db,
        'synthetic-reader',
        { ...DEFAULT_EXPORT_OPTIONS, format: 'json', packaging: 'none' },
        () => {},
        controller.signal,
        (progress) => {
          if (progress.phase === 'serializing') controller.abort()
        },
      ),
    ).rejects.toThrow('Cancelled')
  } finally {
    db.close()
  }
})

test('source-version maps preserve legal identities that are JavaScript prototype property names', async () => {
  const db = repository('synthetic-reader-prototype-id')
  try {
    await db.addObservation(observation('__proto__', null, 0))
    const output = await exportFixedConversation(
      db,
      'synthetic-reader',
      { ...DEFAULT_EXPORT_OPTIONS, level: 'full', format: 'json', packaging: 'none' },
      () => {},
    )
    const document = JSON.parse(await output.blob.text())
    expect(Object.hasOwn(document.coverage.sourceVersions, '__proto__')).toBe(true)
    const prototypeNameVersions = Object.getOwnPropertyDescriptor(
      document.coverage.sourceVersions,
      '__proto__',
    )?.value
    expect(prototypeNameVersions?.[0]?.raw?.id).toBe('__proto__')
  } finally {
    db.close()
  }
})
