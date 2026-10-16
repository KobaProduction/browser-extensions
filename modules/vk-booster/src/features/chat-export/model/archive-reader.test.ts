import { expect, test } from 'bun:test'
import type { FixedVkDexieRepository } from './archive-fixed-dexie'
import { createVkArchiveReader } from './archive-reader'
import type { VkArchiveSession } from './archive-session'

function fixture(afterOwnerCheck: () => void = () => {}) {
  let revision = 0
  const state = { disposed: false }
  const row = {
    key: '9',
    ownerId: 'synthetic-owner',
    peerId: 42,
    messageId: 9,
    schemaVersion: 1,
    date: 1700000000,
    senderId: 7,
    outgoing: false,
    text: 'Synthetic',
    attachmentCount: 1,
  }
  const repo = {
    scope: { ownerId: row.ownerId },
    countMessages: async () => 1,
    messageBounds: async () => ({ first: row, last: row }),
    listMessages: async () => [row],
    getOriginal: async (_peer: number, id: number) => ({
      key: String(id),
      ownerId: row.ownerId,
      sourceVersion: 'synthetic',
      recordedAtMs: 1,
      raw: {
        id,
        date: 1700000000,
        peer_id: 42,
        text: 'Synthetic',
        attachments: [
          {
            type: 'doc',
            doc: { url: `https://example.invalid/${id}.bin`, title: 'synthetic', ext: 'bin' },
          },
        ],
      },
    }),
  }
  const session = {
    state,
    currentPeer: () => 42,
    archiveChanges: { revision: () => revision },
    verifyOwner: async () => {},
    getCaptureEvidence: () => undefined,
    withFixed: async <T>(
      operation: (repository: FixedVkDexieRepository, peer: number) => Promise<T>,
    ) => {
      const result = await operation(repo as unknown as FixedVkDexieRepository, 42)
      await Promise.resolve()
      afterOwnerCheck()
      return result
    },
  }
  return {
    reader: createVkArchiveReader(session as unknown as VkArchiveSession),
    advance: () => {
      revision++
    },
  }
}

test('parallel media reserves the session budget before fetch and cancellation releases it', async () => {
  const run = fixture(),
    original = globalThis.fetch
  let calls = 0,
    started = () => {}
  const eightStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  globalThis.fetch = Object.assign(
    async (_url: string | URL | Request, init?: RequestInit) => {
      calls++
      if (calls === 8) started()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    },
    { preconnect: original.preconnect },
  )
  const controllers = Array.from({ length: 8 }, () => new AbortController())
  const pending = controllers.map((controller, index) =>
    run.reader.downloadAttachmentFixed(index + 1, `${index + 1}:root:0:doc`, controller.signal),
  )
  const settled = Promise.allSettled(pending)
  try {
    await eightStarted
    await expect(run.reader.downloadAttachmentFixed(9, '9:root:0:doc')).rejects.toThrow('memory limit')
    expect(calls).toBe(8)
    for (const controller of controllers) controller.abort()
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true)
    globalThis.fetch = Object.assign(
      async () =>
        new Response(new Uint8Array([1]), {
          headers: { 'content-type': 'application/octet-stream' },
        }),
      { preconnect: original.preconnect },
    )
    expect((await run.reader.downloadAttachmentFixed(9, '9:root:0:doc')).size).toBe(1)
  } finally {
    for (const controller of controllers) controller.abort()
    await settled
    run.reader.disposeReader()
    globalThis.fetch = original
  }
})

test('archive revision drops stale receipts and final owner-await cannot release a cancelled export', async () => {
  const controller = new AbortController(),
    original = globalThis.fetch
  const run = fixture()
  let calls = 0
  globalThis.fetch = Object.assign(
    async () => {
      calls++
      return new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'application/octet-stream' },
      })
    },
    { preconnect: original.preconnect },
  )
  try {
    const first = await run.reader.downloadAttachmentFixed(9, '9:root:0:doc')
    expect((await run.reader.downloadAttachmentFixed(9, '9:root:0:doc')).blob).toBe(first.blob)
    expect(calls).toBe(1)
    run.advance()
    await expect(
      run.reader.exportUserConversation({
        chunkRows: 100,
        includeReferences: true,
        includeMedia: true,
        downloadedMedia: [first],
      }),
    ).rejects.toThrow('receipt')
    const next = await run.reader.downloadAttachmentFixed(9, '9:root:0:doc')
    expect(calls).toBe(2)
    expect(next.blob).not.toBe(first.blob)
    const cancelled = fixture(() => controller.abort())
    try {
      await expect(
        cancelled.reader.exportUserConversation({
          chunkRows: 100,
          includeReferences: true,
          signal: controller.signal,
        }),
      ).rejects.toThrow()
    } finally {
      cancelled.reader.disposeReader()
    }
  } finally {
    run.reader.disposeReader()
    globalThis.fetch = original
  }
})
