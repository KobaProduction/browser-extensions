import { expect, test } from 'bun:test'
import type { FixedVkMessage, FixedVkSourceSnapshot } from './archive-fixed-dexie'
import { createVkUserExportZip } from './vk-user-export'

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
