import { archiveSha256Hex } from '@kobaproduction/browser-archive'
import { attachmentFilename } from './filename'
import { withinDates } from './normalize'
import type {
  ExportFileStatus,
  ExportFolder,
  ExportOptions,
  FolderAudit,
  VkArchiveRepository,
  VkAttachment,
  VkExportManifest,
  VkMessageSource,
} from './types'
import { validPeerId } from './types'

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const timeRange = (options: ExportOptions) => {
  if (
    (options.from && !/^\d{4}-\d{2}-\d{2}$/.test(options.from)) ||
    (options.through && !/^\d{4}-\d{2}-\d{2}$/.test(options.through)) ||
    (options.from && options.through && options.from > options.through)
  )
    throw Error('Invalid export date range')
}
async function writeFile(folder: ExportFolder, name: string, data: string | Uint8Array): Promise<void> {
  const handle = await folder.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(typeof data === 'string' ? data : new Uint8Array(data))
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}
async function readManifest(folder: ExportFolder): Promise<VkExportManifest | null> {
  try {
    const bytes = await (await folder.getFileHandle('manifest.json')).getFile()
    return JSON.parse(await bytes.text()) as VkExportManifest
  } catch (e) {
    if ((e as Error).name === 'NotFoundError') return null
    throw e
  }
}
function validateManifest(value: VkExportManifest, scope: string, peerId: number): void {
  if (
    value?.format !== 'koba-vk-export' ||
    value.schema !== 1 ||
    value.scope !== scope ||
    value.peerId !== peerId ||
    typeof value.exportId !== 'string' ||
    !Array.isArray(value.files)
  )
    throw Error('This export folder belongs to another VK archive or channel')
}
function accepts(attachment: VkAttachment, options: ExportOptions): boolean {
  if (!options.includeFiles) return false
  if (!options.types.length) return true
  const name = attachment.originalName.toLowerCase()
  return options.types.some((value) => {
    const filter = value.trim().toLowerCase()
    return filter === attachment.type || (filter.startsWith('.') && name.endsWith(filter))
  })
}
/** Export never stores credentials, refreshable provider links or raw DTOs. */
export async function exportVkConversation(options: {
  repo: VkArchiveRepository
  source: VkMessageSource
  scope: string
  peerId: number
  output: ExportFolder
  selection: ExportOptions
}): Promise<{ messages: number; files: number; manifest: VkExportManifest }> {
  const { repo, source, scope, peerId, output, selection } = options
  if (!validPeerId(peerId)) throw Error('Invalid peer')
  timeRange(selection)
  const chat = await repo.getConversation(peerId)
  if (!chat?.complete) throw Error('Full message archive must be captured before export')
  let manifest = await readManifest(output)
  if (manifest) validateManifest(manifest, scope, peerId)
  else
    manifest = {
      format: 'koba-vk-export',
      schema: 1,
      scope,
      peerId,
      exportId: crypto.randomUUID(),
      exportedAt: Date.now(),
      files: [],
    }
  const attachments = await output.getDirectoryHandle('attachments', { create: true })
  const records = (await repo.listMessages(peerId)).filter((x) =>
    withinDates(x.date, selection.from, selection.through),
  )
  const files = new Map(manifest.files.map((x) => [x.attachmentId, x]))
  if (manifest.files.length) {
    const verified = await auditVkExportFolder(output, scope, peerId)
    const valid = new Set(verified.ok)
    // Never claim an attachment is present merely because an old manifest
    // mentions it. Missing, corrupted and renamed files are redownloadable.
    for (const key of files.keys()) if (!valid.has(key)) files.delete(key)
  }
  let saved = 0
  for (const message of records) {
    for (const attachment of message.attachments) {
      if (!accepts(attachment, selection) || files.has(attachment.id)) continue
      if (!source.attachmentBytes) throw Error('This source cannot resolve VK attachments')
      const bytes = await source.attachmentBytes(attachment)
      if (
        !Number.isSafeInteger(selection.maxBytes) ||
        selection.maxBytes < 1 ||
        bytes.length > selection.maxBytes
      )
        throw Error('File exceeds the configured export size limit')
      const filename = attachmentFilename(message.id, attachment.index, attachment.originalName)
      const sha256 = await archiveSha256Hex(bytes)
      await writeFile(attachments, filename, bytes)
      const info: ExportFileStatus = {
        attachmentId: attachment.id,
        filename,
        sha256,
        bytes: bytes.length,
        path: 'attachments/' + filename,
      }
      files.set(attachment.id, info)
      await repo.putReceipt({
        key: JSON.stringify([peerId, manifest.exportId, attachment.id]),
        exportId: manifest.exportId,
        attachmentId: attachment.id,
        peerId,
        filename,
        sha256,
        bytes: bytes.length,
        savedAt: Date.now(),
      })
      saved++
    }
  }
  manifest = { ...manifest, exportedAt: Date.now(), files: [...files.values()] }
  // Relative attachment paths appear only for files verified as already saved.
  const exported = records.map((message) => ({
    id: message.id,
    date: message.date,
    from_id: message.fromId,
    out: message.out,
    text: selection.includeText ? message.text : null,
    attachments: message.attachments.map((a) => ({
      id: a.id,
      type: a.type,
      name: a.originalName,
      source_id: a.sourceId,
      file: files.get(a.id)?.path ?? null,
      sha256: files.get(a.id)?.sha256 ?? null,
    })),
  }))
  await writeFile(
    output,
    'chat.json',
    json({
      format: 'koba-vk-export',
      schema: 1,
      peer_id: peerId,
      from: selection.from || null,
      through: selection.through || null,
      messages: exported,
    }),
  )
  await writeFile(output, 'manifest.json', json(manifest))
  return { messages: records.length, files: saved, manifest }
}
export async function auditVkExportFolder(
  folder: ExportFolder,
  scope: string,
  peerId: number,
): Promise<FolderAudit> {
  const manifest = await readManifest(folder)
  if (!manifest) throw Error('This folder has no export manifest')
  validateManifest(manifest, scope, peerId)
  const directory = await folder.getDirectoryHandle('attachments')
  const result: FolderAudit = { ok: [], missing: [], renamed: [], modified: [] }
  const found = new Map<string, string>()
  // Directory enumeration is deliberately confined to attachments, not arbitrary disk.
  const handles = directory as unknown as AsyncIterable<[string, FileSystemHandle]>
  for await (const [name, handle] of handles) {
    if (handle.kind !== 'file') continue
    const file = await (await directory.getFileHandle(name)).getFile()
    const bytes = new Uint8Array(await file.arrayBuffer())
    found.set(name, await archiveSha256Hex(bytes))
  }
  for (const file of manifest.files) {
    if (found.get(file.filename) === file.sha256) result.ok.push(file.attachmentId)
    else if ([...found.entries()].some(([name, sha]) => name !== file.filename && sha === file.sha256))
      result.renamed.push(file.attachmentId)
    else if (found.has(file.filename)) result.modified.push(file.attachmentId)
    else result.missing.push(file.attachmentId)
  }
  return result
}
export async function exportVkBackup(repo: VkArchiveRepository): Promise<Blob> {
  return new Blob([json(await repo.backup())], { type: 'application/json' })
}
