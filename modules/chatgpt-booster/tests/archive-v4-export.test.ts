import { describe, expect, test } from 'bun:test'
import {
  createGzipFromBlob,
  createStoredZipFromBlobs,
} from '../packages/features/src/archive-package'
import { ArchiveSourceGate } from '../packages/features/src/archive-source-contract'
import {
  ARCHIVE_V4_EXPORT_SCHEMA,
  createArchiveV4CompactBlobFromIndex,
  createArchiveV4TechnicalBlob,
  createArchiveV4TechnicalBlobFromIndex,
  prepareArchiveV4Export,
  serializeArchiveV4Path,
  summarizeArchiveV4ModelObservations,
} from '../packages/features/src/archive-v4-export'
import type {
  ArchiveV4Message,
  ArchiveV4PathIndex,
  ArchiveV4PathResult,
  ArchiveV4Store,
} from '../packages/features/src/archive-v4-store'

const source = (id: string, role: string, text: string) => ({
  id,
  author: { role },
  create_time: 1_800_000_000,
  content: { content_type: 'text', parts: [text] },
  metadata: { parent_id: null },
  channel: role === 'assistant' ? 'final' : null,
  recipient: 'all',
  status: 'finished_successfully',
  end_turn: true,
  weight: 1,
})
function message(raw: ReturnType<typeof source>): ArchiveV4Message {
  return {
    key: raw.id,
    conversationKey: 'scope',
    messageId: raw.id,
    raw,
    parentId: null,
    parentKnown: true,
    sourceCreateTime: raw.create_time,
    firstSeenAt: 1,
    lastSeenAt: 1,
    revision: 1,
  }
}
const originals = [source('u', 'user', 'question'), source('a', 'assistant', 'answer')]
const path: ArchiveV4PathResult = {
  status: 'verified',
  rootId: 'u',
  selectedTipId: 'a',
  coverageReadId: 'observed',
  conversationRevision: 1,
  messages: originals.map(message),
}
const base = { conversationId: 'chat', selectedTipId: 'a' }
const index: ArchiveV4PathIndex = {
  status: path.status,
  rootId: path.rootId,
  selectedTipId: path.selectedTipId,
  coverageReadId: path.coverageReadId,
  conversationRevision: path.conversationRevision,
  messageIds: path.messages.map((item) => item.messageId),
}
const findSource = async (id: string) => path.messages.find((record) => record.messageId === id)

describe('archive lossless gzip packaging', () => {
  test('compresses repetitive tool output and restores exact bytes', async () => {
    const original = JSON.stringify({
      tool: 'fixture',
      messages: Array.from({ length: 500 }, () => 'tool-output-content'.repeat(200)),
    })
    const compressed = await createGzipFromBlob(new Blob([original]))
    expect(compressed.type).toBe('application/gzip')
    expect(compressed.size).toBeLessThan(original.length)
    const restored = await new Response(
      compressed.stream().pipeThrough(new DecompressionStream('gzip')),
    ).text()
    expect(restored).toBe(original)
  })
  test('refuses an already cancelled archive compression', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(createGzipFromBlob(new Blob(['fixture']), controller.signal)).rejects.toThrow()
  })
})

describe('archive v4 export projection', () => {
  test('technical copy preserves each original message without Booster fields', () => {
    const original = JSON.stringify(originals)
    const result = serializeArchiveV4Path(path, {
      ...base,
      mode: 'technical',
      format: 'json-compact',
    })
    const data = JSON.parse(result.text)
    expect(data.schema).toBe(ARCHIVE_V4_EXPORT_SCHEMA)
    expect(data.sourceOriginals).toEqual(originals)
    expect(JSON.stringify(originals)).toBe(original)
    expect(data.messages).toBeUndefined()
  })

  test('chunked technical Blob equals exact compact and readable source JSON across batch boundaries', async () => {
    const all = Array.from({ length: 259 }, (_, index) => {
      const raw = source(`msg-${index}`, index % 2 ? 'assistant' : 'user', 'verified source')
      return message(raw)
    })
    const selected = { ...path, messages: all, selectedTipId: 'msg-258' }
    for (const format of ['json-compact', 'json-readable'] as const) {
      const request = { ...base, selectedTipId: 'msg-258', format, mode: 'technical' as const }
      const expected = serializeArchiveV4Path(selected, request).text
      const actual = createArchiveV4TechnicalBlob(selected, request)
      expect(await actual.text()).toBe(expected)
      expect(JSON.parse(await actual.text()).sourceOriginals).toEqual(all.map((item) => item.raw))
      const indexed: ArchiveV4PathIndex = {
        ...index,
        selectedTipId: selected.selectedTipId,
        messageIds: all.map((item) => item.messageId),
      }
      let fetched = 0
      const indexedBlob = await createArchiveV4TechnicalBlobFromIndex(
        indexed,
        request,
        async (id) => {
          fetched++
          return all.find((item) => item.messageId === id)
        },
      )
      expect(await indexedBlob.text()).toBe(expected)
      expect(fetched).toBe(259)
    }
  })

  test('technical output consumes indexed message IDs, not the materialized path', async () => {
    const called: string[] = []
    const store = {
      sourceGate: new ArchiveSourceGate(),
      async readSelectedPath() {
        throw new Error('readSelectedPath should not be called')
      },
      async readSelectedPathIndex() {
        return index
      },
      async getMessage(_account: string, _conversation: string, messageId: string) {
        called.push(messageId)
        return findSource(messageId)
      },
      async getConversation() {
        return { revision: 1, currentNodeId: 'a' }
      },
    } as unknown as Parameters<typeof prepareArchiveV4Export>[0]
    for (const packaging of ['none', 'zip'] as const) {
      const result = await prepareArchiveV4Export(store, {
        accountId: 'account',
        ...base,
        mode: 'technical',
        format: 'json-compact',
        packaging,
      })
      expect(result.extension).toBe(packaging === 'zip' ? 'zip' : 'json')
      if (packaging === 'none') {
        expect(JSON.parse(await result.blob.text()).sourceOriginals).toEqual(originals)
      } else {
        expect(result.packaged).toBe(true)
      }
    }
    expect(called).toEqual(['u', 'a', 'u', 'a'])
  })

  test('indexed technical export aborts and fails closed on missing source records', async () => {
    const request = { ...base, format: 'json-compact' as const }
    const missing = createArchiveV4TechnicalBlobFromIndex(index, request, async (messageId) =>
      messageId === 'a' ? undefined : findSource(messageId),
    )
    await expect(missing).rejects.toThrow('archive.error.sourceChanged')
    const controller = new AbortController()
    let calls = 0
    const cancelled = createArchiveV4TechnicalBlobFromIndex(
      index,
      request,
      async (messageId) => {
        calls++
        controller.abort()
        return findSource(messageId)
      },
      () => {
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      },
    )
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })

  test('indexed basic/selective files match original JSON, Markdown and TXT byte-for-byte', async () => {
    const all = Array.from({ length: 259 }, (_, i) => {
      const role = i % 4 === 0 ? 'tool' : i % 2 ? 'assistant' : 'user'
      const raw = {
        ...source(`msg-${i}`, role, i === 258 ? 'last\n  ' : `text-${i}`),
        metadata:
          i % 3
            ? { parent_id: null, model_slug: 'gpt-6' }
            : { parent_id: null, model_slug: 'gpt-6-thinking', resolved_model_slug: 'gpt-6' },
        channel: role === 'assistant' ? 'final' : null,
      }
      return { ...message(raw), raw }
    })
    const selected: ArchiveV4PathResult = { ...path, selectedTipId: 'msg-258', messages: all }
    const indexed: ArchiveV4PathIndex = {
      ...index,
      selectedTipId: selected.selectedTipId,
      messageIds: all.map((item) => item.messageId),
    }
    for (const mode of ['basic', 'selective'] as const) {
      for (const format of ['json-compact', 'json-readable', 'markdown', 'text'] as const) {
        const request = {
          ...base,
          selectedTipId: 'msg-258',
          mode,
          format,
          reasoning: true,
          tools: true,
          internal: true,
        }
        const expected = serializeArchiveV4Path(selected, request)
        let reads = 0
        const actual = await createArchiveV4CompactBlobFromIndex(indexed, request, async (id) => {
          reads++
          return all.find((item) => item.messageId === id)
        })
        expect(await actual.blob.text()).toBe(expected.text)
        expect(actual.extension).toBe(expected.extension)
        expect(reads).toBe(all.length)
      }
    }
  })

  test('selected revision evidence requires a complete immediate-predecessor chain', async () => {
    const sourceMessage = path.messages.find((item) => item.messageId === 'a')
    if (!sourceMessage) throw new Error('Missing fixed export source')
    const changed = { ...sourceMessage, revision: 3 }
    const request = {
      ...base,
      mode: 'selective' as const,
      format: 'json-compact' as const,
      sourceRevisions: true,
      modelEvidence: false,
    }
    const window = (revisions: number[]) => ({
      previous: revisions.map((revision) => ({
        previousRevision: revision,
        previousLastSeenAtMs: 1_800_000_000_500,
        sourceReadId: 'read-1',
        sourceReadStartedAtMs: 1_800_000_000_000,
      })),
      olderRevisionsOmitted: false,
    })
    const lookup = async (id: string) => (id === 'a' ? changed : findSource(id))
    const prepare = (revisions: number[]) =>
      createArchiveV4CompactBlobFromIndex(
        index,
        request,
        lookup,
        () => undefined,
        async () => window(revisions),
      )
    await expect(prepare([1])).rejects.toThrow('archive.error.sourceChanged')
    const result = await prepare([1, 2])
    const output = JSON.parse(await result.blob.text())
    expect(output.messages.at(-1).sourceRevisionEvidence).toMatchObject({
      currentRevision: 3,
      olderRevisionsOmitted: false,
      changeActor: 'not_observed',
    })
    expect(
      output.messages
        .at(-1)
        .sourceRevisionEvidence.previous.map(
          (entry: { previousRevision: number }) => entry.previousRevision,
        ),
    ).toEqual([1, 2])
    expect(
      output.messages.at(-1).sourceRevisionEvidence.previous[0].previousLastSeenUtcSeconds,
    ).toBe(1_800_000_000)
  })

  test('indexed basic export rejects a missing message and cancellation mid-read', async () => {
    const request = { ...base, mode: 'basic' as const, format: 'json-compact' as const }
    await expect(
      createArchiveV4CompactBlobFromIndex(index, request, async (id) =>
        id === 'a' ? undefined : findSource(id),
      ),
    ).rejects.toThrow('archive.error.sourceChanged')
    let reads = 0
    const controller = new AbortController()
    await expect(
      createArchiveV4CompactBlobFromIndex(
        index,
        request,
        async (id) => {
          reads++
          controller.abort()
          return findSource(id)
        },
        () => {
          if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(reads).toBe(1)
  })

  test('basic compact JSON contains only readable projections, never duplicate raw', () => {
    const result = serializeArchiveV4Path(path, { ...base, mode: 'basic', format: 'json-compact' })
    const data = JSON.parse(result.text)
    expect(data.messages.map((record: { text: string }) => record.text)).toEqual([
      'question',
      'answer',
    ])
    expect(data.sourceOriginals).toBeUndefined()
    expect(result.text).not.toContain('"content_type"')
  })

  test('Blob-backed ZIP writes verifiable CRC32, exact bytes and honors cancellation', async () => {
    const content = '123456789'.repeat(9000)
    const data = new TextEncoder().encode(content)
    const zip = await createStoredZipFromBlobs([
      {
        path: 'data.txt',
        blob: new Blob([data]),
      },
    ])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(18, true)).toBe(data.length)
    const nameLength = view.getUint16(26, true)
    const offset = 30 + nameLength + view.getUint16(28, true)
    expect(new TextDecoder().decode(bytes.subarray(30, 30 + nameLength))).toBe('data.txt')
    expect(new TextDecoder().decode(bytes.subarray(offset, offset + data.length))).toBe(content)
    const crcForStandardDigits = await createStoredZipFromBlobs([
      {
        path: 'digits.txt',
        blob: new Blob(['123456789']),
      },
    ])
    const digits = new DataView(await crcForStandardDigits.arrayBuffer())
    expect(digits.getUint32(14, true)).toBe(0xcbf43926)
    const central = bytes.length - 22 - view.getUint32(bytes.length - 10, true)
    expect(view.getUint32(central, true)).toBe(0x02014b50)
    expect(view.getUint16(central + 10, true)).toBe(0) // stored; no compression
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50)
    const controller = new AbortController()
    controller.abort()
    await expect(
      createStoredZipFromBlobs(
        [
          {
            path: 'data.txt',
            blob: new Blob([data]),
          },
        ],
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('independent ZIP packaging retains one source-native JSON file and a truthful manifest', async () => {
    const store = {
      sourceGate: new ArchiveSourceGate(),
      async readSelectedPath() {
        return path
      },
      async readSelectedPathIndex() {
        return index
      },
      async getMessage(_account: string, _conversation: string, messageId: string) {
        return findSource(messageId)
      },
      async getConversation() {
        return { revision: 1, currentNodeId: 'a' }
      },
    } as unknown as Pick<ArchiveV4Store, 'sourceGate' | 'readSelectedPath'>
    const zipped = await prepareArchiveV4Export(store, {
      accountId: 'account',
      ...base,
      mode: 'technical',
      format: 'json-compact',
      packaging: 'zip',
    })
    expect(zipped.packaged).toBe(true)
    expect(zipped.extension).toBe('zip')
    const bytes = new Uint8Array(await zipped.blob.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    const readable = new TextDecoder().decode(bytes)
    expect(readable).toContain('conversation.json')
    expect(readable).toContain('archive-manifest.json')
    expect(readable).toContain('"binaryAssetsIncluded": false')
    expect(readable.split('sourceOriginals').length).toBe(2)

    const plain = await prepareArchiveV4Export(store, {
      accountId: 'account',
      ...base,
      mode: 'technical',
      format: 'json-compact',
      packaging: 'none',
    })
    expect(plain.packaged).toBe(false)
    expect(plain.extension).toBe('json')
    expect(JSON.parse(await plain.blob.text()).sourceOriginals).toEqual(originals)
  })

  test('rejects data that change while a verified snapshot is being packaged', async () => {
    let reads = 0
    const store = {
      sourceGate: new ArchiveSourceGate(),
      async readSelectedPath() {
        return path
      },
      async readSelectedPathIndex() {
        return index
      },
      async getMessage(_account: string, _conversation: string, messageId: string) {
        return findSource(messageId)
      },
      async getConversation() {
        reads += 1
        return { revision: reads === 1 ? 1 : 2, currentNodeId: 'a' }
      },
    } as unknown as Pick<ArchiveV4Store, 'sourceGate' | 'readSelectedPath' | 'getConversation'>
    await expect(
      prepareArchiveV4Export(store, {
        accountId: 'account',
        ...base,
        mode: 'technical',
        format: 'json-compact',
        packaging: 'zip',
      }),
    ).rejects.toThrow('archive.error.sourceChanged')
    expect(reads).toBe(2)
  })

  test('rejects an owner epoch change and an explicitly changed source path', async () => {
    const store = {
      sourceGate: new ArchiveSourceGate(),
      async readSelectedPath() {
        return path
      },
      async readSelectedPathIndex() {
        return index
      },
      async getMessage(_account: string, _conversation: string, messageId: string) {
        return findSource(messageId)
      },
      async getConversation() {
        return { revision: 1, currentNodeId: 'a' }
      },
    } as unknown as Pick<ArchiveV4Store, 'sourceGate' | 'readSelectedPath' | 'getConversation'>
    let checks = 0
    await expect(
      prepareArchiveV4Export(store, {
        accountId: 'account',
        ...base,
        mode: 'basic',
        format: 'json-compact',
        stillAuthorized: () => ++checks < 2,
      }),
    ).rejects.toThrow('archive.error.auth')
    const changed = {
      ...store,
      async readSelectedPathIndex() {
        return { ...index, status: 'source_changed' as const }
      },
    }
    await expect(
      prepareArchiveV4Export(changed, {
        accountId: 'account',
        ...base,
        mode: 'basic',
        format: 'json-compact',
      }),
    ).rejects.toThrow('archive.error.sourceChanged')
  })

  test('projects only source-observed model differences and never invents user switches or effort', () => {
    const raws = [
      { ...source('u', 'user', 'question'), metadata: { parent_id: null, model_slug: 'gpt-6' } },
      { ...source('a', 'assistant', 'answer'), metadata: { parent_id: null, model_slug: 'gpt-6' } },
      {
        ...source('a', 'assistant', 'answer'),
        id: 'c',
        metadata: { parent_id: null, model_slug: 'gpt-6', resolved_model_slug: 'gpt-6-thinking' },
      },
      {
        ...source('a', 'assistant', 'answer'),
        id: 'd',
        metadata: { parent_id: null, model_slug: 'gpt-6', resolved_model_slug: 'gpt-6-thinking' },
      },
    ]
    const observations = summarizeArchiveV4ModelObservations(
      raws.map((raw) => ({ messageId: raw.id, raw })),
    )
    expect(observations.baseline).toEqual({
      messageId: 'u',
      modelSlug: 'gpt-6',
      resolvedModelSlug: null,
    })
    expect(observations.changedObservedValues).toEqual([
      { messageId: 'c', modelSlug: 'gpt-6', resolvedModelSlug: 'gpt-6-thinking' },
    ])
    expect(observations.requestedModel).toBeNull()
    expect(observations.thinkingEffort).toBeNull()
    expect(observations.userModelSwitchesVerified).toBe(false)

    const selective = serializeArchiveV4Path(
      {
        ...path,
        messages: raws.map((raw) => ({ ...message(raw as ReturnType<typeof source>), raw })),
      },
      { ...base, mode: 'selective', format: 'json-compact' },
    )
    const json = JSON.parse(selective.text)
    expect(json.observedModelEvidence.changedObservedValues).toHaveLength(1)
    expect(
      json.messages.every((item: Record<string, unknown>) => !('observedModelSlug' in item)),
    ).toBe(true)
    const markdown = serializeArchiveV4Path(
      {
        ...path,
        messages: raws.map((raw) => ({ ...message(raw as ReturnType<typeof source>), raw })),
      },
      { ...base, mode: 'selective', format: 'markdown' },
    )
    expect(markdown.text).toContain('not user changes')
    expect(markdown.text).toContain('thinking effort: not verified')
  })

  test('refuses incomplete ancestry and non-JSON technical mode', () => {
    expect(() =>
      serializeArchiveV4Path(
        { ...path, status: 'missing_parent' },
        { ...base, mode: 'basic', format: 'markdown' },
      ),
    ).toThrow('archive.error.unverifiedPath')
    expect(() =>
      serializeArchiveV4Path(path, { ...base, mode: 'technical', format: 'markdown' }),
    ).toThrow('archive.error.technicalRequiresJson')
  })
})
