import { expect, test } from 'bun:test'
import { createMemoryVkArchive } from '../infrastructure/memory'
import { auditVkExportFolder, exportVkConversation } from './export'
import { attachmentFilename, safeAttachmentName } from './filename'
import { normalizeVkMessage } from './normalize'
import { createVkArchiveService } from './service'
import { type ExportFolder, scopedVkDatabaseName, type VkMessageSource } from './types'

function must<T>(v: T | undefined | null): T {
  if (v === undefined || v === null) throw Error('Fixture is missing')
  return v
}
class MockFile {
  readonly kind = 'file'
  bytes: Uint8Array<ArrayBufferLike> = new Uint8Array()
  constructor(readonly name: string) {}
  async getFile(): Promise<File> {
    return new File([new Uint8Array(this.bytes)], this.name)
  }
  async createWritable() {
    let pending: Uint8Array | null = null
    const file = this
    return {
      async write(data: string | Uint8Array | Blob) {
        pending =
          typeof data === 'string'
            ? new TextEncoder().encode(data)
            : data instanceof Uint8Array
              ? new Uint8Array(data)
              : new Uint8Array(await data.arrayBuffer())
      },
      async close() {
        if (pending) file.bytes = pending
      },
      async abort() {
        pending = null
      },
    }
  }
}
class MockFolder implements AsyncIterable<[string, FileSystemHandle]> {
  readonly files = new Map<string, MockFile>()
  readonly folders = new Map<string, MockFolder>()
  constructor(readonly name: string) {}
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    let file = this.files.get(name)
    if (!file) {
      if (!options?.create) throw Object.assign(Error('Not found'), { name: 'NotFoundError' })
      file = new MockFile(name)
      this.files.set(name, file)
    }
    return file as unknown as FileSystemFileHandle
  }
  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle> {
    let folder = this.folders.get(name)
    if (!folder) {
      if (!options?.create) throw Object.assign(Error('Not found'), { name: 'NotFoundError' })
      folder = new MockFolder(name)
      this.folders.set(name, folder)
    }
    return folder as unknown as FileSystemDirectoryHandle
  }
  async *[Symbol.asyncIterator](): AsyncIterator<[string, FileSystemHandle]> {
    for (const [name, file] of this.files) yield [name, file as unknown as FileSystemHandle]
  }
}
const peer = 7654321
const fixture = Array.from({ length: 3100 }, (_, index) => {
  const id = 3100 - index
  return normalizeVkMessage(
    {
      id,
      date: 1791500000 - index * 500,
      peer_id: peer,
      from_id: index % 2 ? peer : 123,
      out: index % 2 ? 1 : 0,
      text: 'Synthetic chat message ' + id,
      ...(index === 5
        ? {
            attachments: [
              {
                type: 'doc',
                doc: {
                  id: 44,
                  title: 'Finance/Report?.pdf',
                  size: 42,
                  url: 'https://private.test/?access_token=SECRET',
                },
              },
              { type: 'photo', photo: { id: 55, sizes: [{ url: 'https://private.test/photo' }] } },
            ],
          }
        : {}),
    },
    peer,
  )
})
test('capturing a full 3100-message conversation stores text without binary data or credentials', async () => {
  const repo = createMemoryVkArchive('vk-booster:dev')
  let calls = 0
  const source: VkMessageSource = {
    async history(id, offset, limit) {
      expect(id).toBe(peer)
      calls++
      return { total: fixture.length, messages: fixture.slice(offset, offset + limit) }
    },
  }
  const archive = createVkArchiveService(repo, source)
  const progress = await archive.captureFull(peer)
  expect(progress.pages).toBe(31)
  expect(progress.stored).toBe(3100)
  expect((await repo.getConversation(peer))?.complete).toBe(true)
  expect((await repo.listMessages(peer)).length).toBe(3100)
  expect(JSON.stringify(await repo.backup())).not.toContain('SECRET')
  await archive.captureFull(peer)
  expect(calls).toBe(31)
})
test('source incompleteness never marks the local archive complete', async () => {
  const repo = createMemoryVkArchive('vk-booster:dev')
  const service = createVkArchiveService(repo, {
    async history(_id, offset) {
      return { total: 200, messages: offset ? [] : fixture.slice(0, 100) }
    },
  })
  await expect(service.captureFull(peer)).rejects.toThrow('incomplete')
  expect((await repo.getConversation(peer))?.complete).toBe(false)
})
test('changing VK history totals fail the capture without claiming completeness', async () => {
  const repo = createMemoryVkArchive('vk-booster:dev')
  const service = createVkArchiveService(repo, {
    async history(_id, offset) {
      return { total: offset === 0 ? 200 : 201, messages: fixture.slice(offset, offset + 100) }
    },
  })
  await expect(service.captureFull(peer)).rejects.toThrow('changed during')
  expect((await repo.getConversation(peer))?.complete).toBe(false)
})
test('scope collision between standalone and combiner is rejected on restore', async () => {
  const standalone = createMemoryVkArchive('vk-booster:dev')
  await standalone.storePage(peer, [must(fixture[0])])
  await standalone.markComplete(peer)
  const snapshot = await standalone.backup()
  const combiner = createMemoryVkArchive('all-in-one:dev')
  await expect(combiner.restore(snapshot)).rejects.toThrow()
  await standalone.restore(snapshot)
  expect((await standalone.listMessages(peer)).length).toBe(1)
  expect(scopedVkDatabaseName('vk-booster:dev')).not.toBe(scopedVkDatabaseName('all-in-one:dev'))
})
test('numeric prefixes and trimmed filenames stay safe and unique', () => {
  const a = attachmentFilename(3100, 0, '../long/bad:name.pdf')
  const b = attachmentFilename(3100, 1, '../long/bad:name.pdf')
  expect(a).not.toBe(b)
  expect(a).toMatch(/^\d+-/)
  expect(a).not.toContain('/')
  expect(safeAttachmentName('X'.repeat(600) + '.txt').length).toBeLessThan(181)
})
test('folder export records SHA-256, supports date/type selection, checks renamed files', async () => {
  const repo = createMemoryVkArchive('vk-booster:dev')
  await repo.storePage(peer, [must(fixture[5])])
  await repo.markComplete(peer)
  const bytes = new TextEncoder().encode('synthetic PDF content')
  const source: VkMessageSource = {
    async history() {
      return { total: 1, messages: [must(fixture[5])] }
    },
    async attachmentBytes() {
      return bytes
    },
  }
  const folder = new MockFolder('Export')
  const selection = {
    from: '2026-10-01',
    through: '2026-10-31',
    includeText: true,
    includeFiles: true,
    types: ['.pdf'],
    maxBytes: 1024,
  }
  const result = await exportVkConversation({
    repo,
    source,
    scope: 'vk-booster:dev',
    peerId: peer,
    output: folder as unknown as ExportFolder,
    selection,
  })
  expect(result.messages).toBe(1)
  expect(result.files).toBe(1)
  const json = JSON.parse(
    await (await folder.getFileHandle('chat.json')).getFile().then((f) => f.text()),
  )
  expect(json.messages.length).toBe(1)
  expect(json.messages[0].attachments.length).toBe(2)
  expect(json.messages[0].attachments[0].file).toStartWith('attachments/')
  expect(json.messages[0].attachments[1].file).toBeNull()
  expect(JSON.stringify(json)).not.toContain('access_token')
  const receipts = await repo.listReceipts(peer, result.manifest.exportId)
  expect(receipts.length).toBe(1)
  expect(receipts[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
  const initial = await auditVkExportFolder(folder as unknown as ExportFolder, 'vk-booster:dev', peer)
  expect(initial.ok.length).toBe(1)
  const media = must(folder.folders.get('attachments'))
  const original = must(receipts[0]).filename
  media.files.set('renamed-document.pdf', must(media.files.get(original)))
  media.files.delete(original)
  const audit = await auditVkExportFolder(folder as unknown as ExportFolder, 'vk-booster:dev', peer)
  expect(audit.renamed).toEqual([must(receipts[0]).attachmentId])
  const repaired = await exportVkConversation({
    repo,
    source,
    scope: 'vk-booster:dev',
    peerId: peer,
    output: folder as unknown as ExportFolder,
    selection,
  })
  expect(repaired.files).toBe(1)
  const repairedAudit = await auditVkExportFolder(
    folder as unknown as ExportFolder,
    'vk-booster:dev',
    peer,
  )
  expect(repairedAudit.ok).toEqual([must(receipts[0]).attachmentId])
  await expect(
    auditVkExportFolder(folder as unknown as ExportFolder, 'all-in-one:dev', peer),
  ).rejects.toThrow('another')
})
