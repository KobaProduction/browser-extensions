import { expect, test } from 'bun:test'
import { decodeArchiveClone } from '@kobaproduction/browser-archive'
import type { FixedVkMessage, FixedVkSourceSnapshot } from './archive-fixed-dexie'
import { createVkUserExport, createVkUserExportZip } from './vk-user-export'

/** Decode STORE-only ZIP local entries. Test ZIP contents without external tools. */
async function unzipStored(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const data = new DataView(bytes.buffer)
  const decoder = new TextDecoder()
  const files = new Map<string, Uint8Array>()
  let pos = 0
  while (pos < bytes.length && data.getUint32(pos, true) === 0x04034b50) {
    const len = data.getUint16(pos + 26, true)
    const extra = data.getUint16(pos + 28, true)
    const size = data.getUint32(pos + 18, true)
    const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + len))
    const start = pos + 30 + len + extra
    files.set(name, bytes.slice(start, start + size))
    pos = start + size
  }
  expect(data.getUint32(pos, true)).toBe(0x02014b50)
  return files
}

test('VK user ZIP contains every saved original in bounded JSON chunks plus honest media statuses', async () => {
  const rows: FixedVkMessage[] = []
  const snapshots = new Map<number, FixedVkSourceSnapshot>()
  for (let id = 1; id <= 525; id++) {
    const raw = {
      id,
      peer_id: 9001,
      date: 1790000000 + id,
      from_id: id % 2 ? 100 : 200,
      out: id % 2,
      text: `synthetic message ${id}`,
      attachments:
        id === 3
          ? [
              {
                type: 'photo',
                photo: {
                  sizes: [{ url: 'https://example.invalid/photo.png', width: 400, height: 300 }],
                },
              },
            ]
          : [],
    }
    rows.push({
      key: String(id),
      ownerId: 'synthetic-owner',
      peerId: 9001,
      messageId: id,
      schemaVersion: 1,
      date: raw.date,
      senderId: raw.from_id,
      outgoing: raw.out === 1,
      text: raw.text,
      attachmentCount: raw.attachments.length,
    })
    snapshots.set(id, {
      key: String(id),
      ownerId: 'synthetic-owner',
      sourceVersion: 'vk-source-test',
      recordedAtMs: 1790000000000,
      raw,
    })
  }
  const reader = {
    countMessages: async () => rows.length,
    listMessages: async (_peer: number, limit: number, cursor?: number) =>
      rows.filter((r) => cursor === undefined || r.messageId > cursor).slice(0, limit),
    getOriginal: async (_peer: number, id: number) => snapshots.get(id),
  }
  const loaded = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
  const done: number[] = []
  const zip = await createVkUserExportZip(
    reader,
    9001,
    {
      chunkRows: 500,
      includeReferences: true,
      includeMedia: true,
      downloadedMedia: [{ key: '3:root:0:photo', name: 'figure.png', blob: loaded }],
    },
    () => {},
    ({ done: count }) => done.push(count),
  )
  const files = await unzipStored(zip)
  expect([...files.keys()].sort()).toEqual(
    [
      'messages/000001.json',
      'messages/000002.json',
      'attachments/3/figure.png',
      'attachments/status.json',
      'manifest.json',
    ].sort(),
  )
  const first = JSON.parse(new TextDecoder().decode(files.get('messages/000001.json'))) as unknown[]
  const second = JSON.parse(new TextDecoder().decode(files.get('messages/000002.json'))) as unknown[]
  expect([first.length, second.length]).toEqual([500, 25])
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as Record<
    string,
    unknown
  >
  expect(manifest).toMatchObject({
    format: 'koba-vk-conversation-zip-v1',
    recordCount: 525,
    completeness: 'unknown',
    attachmentFilesIncluded: 1,
    attachmentBytesIncluded: 4,
    missingAttachmentCount: 0,
  })
  expect(files.get('attachments/3/figure.png')).toEqual(new Uint8Array([137, 80, 78, 71]))
  expect(done).toContain(525)
})

test('VK user ZIP refuses a changing archive and does not claim complete remote history', async () => {
  let count = 2
  const reader = {
    countMessages: async () => count++,
    listMessages: async () => [
      {
        key: '1',
        ownerId: 'owner',
        peerId: 9001,
        messageId: 1,
        schemaVersion: 1 as const,
        date: 1790000000,
        senderId: 123,
        outgoing: true,
        text: 'demo',
        attachmentCount: 0,
      },
    ],
    getOriginal: async () => ({
      key: '1',
      ownerId: 'owner',
      sourceVersion: 'test',
      recordedAtMs: 1790000000000,
      raw: { id: 1, date: 1790000000, text: 'demo' },
    }),
  }
  await expect(
    createVkUserExportZip(reader, 9001, { chunkRows: 100, includeReferences: false }, () => {}),
  ).rejects.toThrow('changed')
})
test('selective Markdown ZIP retains source JSON and refuses missing selected IDs', async () => {
  const raw = {
    id: 9,
    date: 1700000000,
    peer_id: 42,
    from_id: 7,
    text: 'Synthetic readable message',
    future: { flag: true },
  }
  const row: FixedVkMessage = {
    key: '9',
    ownerId: 'owner',
    peerId: 42,
    messageId: 9,
    schemaVersion: 1,
    date: raw.date,
    senderId: 7,
    outgoing: false,
    text: raw.text,
    attachmentCount: 0,
  }
  const reader = {
    countMessages: async () => 1,
    listMessages: async () => [row],
    getOriginal: async () => ({
      key: '9',
      ownerId: 'owner',
      sourceVersion: 'synthetic',
      recordedAtMs: 1,
      raw,
    }),
  }
  const result = await createVkUserExportZip(
    reader,
    42,
    { chunkRows: 100, includeReferences: false, format: 'markdown', messageIds: [9] },
    () => {},
  )
  const entries = await unzipStored(result),
    decode = new TextDecoder()
  expect(decode.decode(entries.get('conversation.md'))).toContain('Synthetic readable message')
  const source = JSON.parse(decode.decode(entries.get('messages/000001.json')))
  expect(source[0].normalized).toMatchObject({
    schema: 'koba.message',
    modelVersion: 1,
    identity: { providerId: 'vk-booster', ownerId: 'owner', conversationId: '42', messageId: '9' },
    links: { parentObserved: false },
    content: { coverage: 'typed' },
  })
  expect(decodeArchiveClone(source[0].snapshot.original)).toEqual(raw)
  expect(JSON.parse(decode.decode(entries.get('manifest.json')))).toMatchObject({
    recordCount: 1,
    savedRecordCount: 1,
    selection: { mode: 'selected', messageIds: [9] },
    completeness: 'unknown',
    readableFormat: 'markdown',
  })
  await expect(
    createVkUserExportZip(
      reader,
      42,
      { chunkRows: 100, includeReferences: false, messageIds: [10] },
      () => {},
    ),
  ).rejects.toThrow('no longer saved')
})

test('VK export refuses foreign peer rows and cancellation instead of publishing a prepared ZIP', async () => {
  const row: FixedVkMessage = {
    key: '1',
    ownerId: 'owner',
    peerId: 77,
    messageId: 1,
    schemaVersion: 1,
    date: null,
    senderId: null,
    outgoing: null,
    text: 'Synthetic',
    attachmentCount: 0,
  }
  const reader = {
    countMessages: async () => 1,
    listMessages: async () => [row],
    getOriginal: async () => ({
      key: '1',
      ownerId: 'owner',
      sourceVersion: 'synthetic',
      recordedAtMs: 1,
      raw: { id: 1, date: 1700000000, text: 'Synthetic' },
    }),
  }
  await expect(
    createVkUserExportZip(reader, 42, { chunkRows: 100, includeReferences: false }, () => {}),
  ).rejects.toThrow('Mismatched VK export owner or conversation')
  row.peerId = 42
  const controller = new AbortController()
  await expect(
    createVkUserExportZip(
      reader,
      42,
      { chunkRows: 100, includeReferences: false, signal: controller.signal },
      () => {},
      (progress) => {
        if (progress.phase === 'packaging') controller.abort()
      },
    ),
  ).rejects.toThrow()
})

function attachmentReader() {
  const sourceUrl = 'https://cdn.example.invalid/report_(draft).txt?download=1&signed=opaque'
  const raw = {
    id: 9,
    date: 1700000000,
    peer_id: 42,
    from_id: 7,
    out: 0,
    text: 'Normalized source text',
    attachments: [{ type: 'doc', doc: { url: sourceUrl, title: 'report.txt', ext: 'txt' } }],
  }
  const row: FixedVkMessage = {
    key: '9',
    ownerId: 'synthetic-owner',
    peerId: 42,
    messageId: 9,
    schemaVersion: 1,
    date: raw.date,
    senderId: 7,
    outgoing: false,
    text: 'STALE CACHE',
    attachmentCount: 1,
  }
  return {
    sourceUrl,
    raw,
    reader: {
      countMessages: async () => 1,
      listMessages: async () => [row],
      getOriginal: async () => ({
        key: '9',
        ownerId: row.ownerId,
        sourceVersion: 'synthetic',
        recordedAtMs: 1,
        raw,
      }),
    },
  }
}
test('plain Markdown/TXT and standalone JSON share the normalized source and honest remote file references', async () => {
  const { reader, sourceUrl, raw } = attachmentReader()
  for (const format of ['markdown', 'text'] as const) {
    const output = await createVkUserExport(
      reader,
      42,
      { chunkRows: 100, includeReferences: true, format, packaging: 'none' },
      () => {},
    )
    expect(output).toMatchObject({
      packaged: false,
      attachmentFilesIncluded: 0,
      missingAttachmentCount: 1,
      extension: format === 'markdown' ? 'md' : 'txt',
    })
    const text = await output.blob.text()
    expect(text).toContain('Normalized source text')
    expect(text).not.toContain('STALE CACHE')
    expect(text).toContain('report_%28draft%29.txt?download=1&signed=opaque')
    expect(text).toContain('[not_included]')
  }
  const output = await createVkUserExport(
    reader,
    42,
    { chunkRows: 100, includeReferences: true, format: 'json', packaging: 'none' },
    () => {},
  )
  const document = JSON.parse(await output.blob.text())
  expect(document.manifest).toMatchObject({
    packaging: 'none',
    attachmentFilesIncluded: 0,
    missingAttachmentCount: 1,
  })
  expect(document.messages[0].attachments[0].sourceUrl).toBe(sourceUrl)
  expect(decodeArchiveClone(document.messages[0].snapshot.original)).toEqual(raw)
})
test('ZIP readable attachment links target included files and binaries require a separate explicit opt-in', async () => {
  const { reader, sourceUrl } = attachmentReader()
  const downloadedMedia = [
    {
      key: '9:root:0:doc',
      name: 'report [draft].txt',
      blob: new Blob(['synthetic-file'], { type: 'text/plain' }),
    },
  ]
  const options = {
    chunkRows: 100 as const,
    includeReferences: true,
    format: 'markdown' as const,
    downloadedMedia,
  }
  const excluded = await createVkUserExport(reader, 42, options, () => {})
  expect(excluded.attachmentFilesIncluded).toBe(0)
  const included = await createVkUserExport(reader, 42, { ...options, includeMedia: true }, () => {})
  const entries = await unzipStored(included.blob),
    decoder = new TextDecoder()
  expect(entries.has('attachments/9/report [draft].txt')).toBe(true)
  expect(decoder.decode(entries.get('conversation.md'))).toContain(
    `](<attachments/9/report%20%5Bdraft%5D.txt>) (${downloadedMedia[0]?.blob.type}) [included]`,
  )
  const status = JSON.parse(decoder.decode(entries.get('attachments/status.json')))[0]
  expect(status).toMatchObject({
    sourceUrl,
    status: 'included',
    localPath: 'attachments/9/report [draft].txt',
    size: 14,
    mime: downloadedMedia[0]?.blob.type,
  })
  expect(status.sha256).toMatch(/^[0-9a-f]{64}$/)
  await expect(
    createVkUserExport(reader, 42, { ...options, packaging: 'none', includeMedia: true }, () => {}),
  ).rejects.toThrow('requires ZIP')
})
test('ZIP filenames preserve codepoint and UTF-8 boundaries across entries, manifest and readable links', async () => {
  const { reader } = attachmentReader()
  for (const name of ['a'.repeat(95) + '😀.txt', '😀'.repeat(40) + '.txt', 'lone\ud800.txt']) {
    const output = await createVkUserExport(
      reader,
      42,
      {
        chunkRows: 100,
        includeReferences: true,
        format: 'markdown',
        includeMedia: true,
        downloadedMedia: [{ key: '9:root:0:doc', name, blob: new Blob(['synthetic']) }],
      },
      () => {},
    )
    const entries = await unzipStored(output.blob),
      decoder = new TextDecoder()
    const reference = JSON.parse(decoder.decode(entries.get('attachments/status.json')))[0]
    const path = reference.localPath as string
    expect(entries.has(path)).toBe(true)
    expect(path).not.toContain('�')
    const fileName = path.slice('attachments/9/'.length)
    expect(new TextEncoder().encode(fileName).length).toBeLessThanOrEqual(96)
    expect(decoder.decode(entries.get('conversation.md'))).toContain(
      `](<attachments/9/${encodeURIComponent(fileName)}>)`,
    )
  }
})
