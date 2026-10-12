/** End-user conversation export, NOT an IndexedDB recovery backup.
 * Uses the shared ZIP32 package writer also used by ChatGPT Booster. */
import {
  archiveSha256Hex,
  createStoredZipFromBlobs,
  encodeArchiveClone,
} from '@kobaproduction/browser-archive'
import { assets } from '../api/vk-media'
import type { FixedVkDexieRepository } from './archive-fixed-dexie'
import type { VkMessage } from './types'

export interface VkUserExportOptions {
  chunkRows: 100 | 500
  includeReferences: boolean
  downloadedMedia?: readonly { key: string; name: string; blob: Blob }[]
}
export interface VkExportProgress {
  phase: 'reading' | 'packaging'
  done: number
  total: number
}
type Reader = Pick<FixedVkDexieRepository, 'countMessages' | 'listMessages' | 'getOriginal'>
type MediaReference = {
  messageId: number
  key: string
  type: string
  status: 'not_downloaded' | 'included'
  localPath: string | null
}
export async function createVkUserExportZip(
  reader: Reader,
  peerId: number,
  options: VkUserExportOptions,
  verifyPeer: () => void,
  onProgress?: (progress: VkExportProgress) => void,
): Promise<Blob> {
  if (options.chunkRows !== 100 && options.chunkRows !== 500) throw Error('Invalid VK export page size')
  verifyPeer()
  const total = await reader.countMessages(peerId)
  verifyPeer()
  if (!total) throw Error('No saved VK messages for ZIP export')
  const entries: { path: string; blob: Blob }[] = []
  const chunkManifest: { path: string; records: number; sha256: string }[] = []
  const missing: MediaReference[] = []
  const downloaded = new Map(options.downloadedMedia?.map((item) => [item.key, item]) ?? [])
  const exportedPaths = new Set<string>()
  let includedBytes = 0
  let includedCount = 0
  let cursor: number | undefined
  let processed = 0
  while (processed < total) {
    verifyPeer()
    const page = await reader.listMessages(
      peerId,
      Math.min(options.chunkRows, total - processed),
      cursor,
    )
    if (!page.length) throw Error('VK export source changed during paging')
    const rawRows: unknown[] = []
    for (const row of page) {
      verifyPeer()
      const original = await reader.getOriginal(peerId, row.messageId)
      if (!original || original.ownerId !== row.ownerId)
        throw Error('Missing verified original VK snapshot')
      const raw: VkMessage = original.raw
      if (raw.id !== row.messageId || (raw.peer_id !== undefined && raw.peer_id !== peerId))
        throw Error('Mismatched VK source snapshot during export')
      rawRows.push({
        id: row.messageId,
        sentAt: row.date,
        senderId: row.senderId,
        outgoing: row.outgoing,
        text: row.text,
        snapshot: { sourceVersion: original.sourceVersion, original: await encodeArchiveClone(raw) },
      })
      if (options.includeReferences) {
        for (const ref of assets(raw)) {
          if (ref.type === 'link') continue
          const candidate = downloaded.get(ref.key)
          let path: string | null = null
          if (
            candidate?.blob instanceof Blob &&
            candidate.blob.size > 0 &&
            candidate.blob.size <= 64 * 1024 * 1024 &&
            includedBytes + candidate.blob.size <= 512 * 1024 * 1024
          ) {
            const safe =
              candidate.name
                .normalize('NFC')
                .replace(/[\\/:*?"<>|]/g, '_')
                .replace(/^\.+/, '_')
                .slice(0, 96) || 'attachment'
            path = `attachments/${row.messageId}/${safe}`
            if (exportedPaths.has(path))
              path = `attachments/${row.messageId}/${ref.key.replace(/[^a-z0-9_-]/gi, '_')}-${safe}`
            exportedPaths.add(path)
            entries.push({ path, blob: candidate.blob })
            includedBytes += candidate.blob.size
            includedCount++
          }
          missing.push({
            messageId: row.messageId,
            key: ref.key,
            type: ref.type,
            status: path ? 'included' : 'not_downloaded',
            localPath: path,
          })
        }
      }
      processed++
    }
    const path = `messages/${String(chunkManifest.length + 1).padStart(6, '0')}.json`
    const body = JSON.stringify(rawRows)
    chunkManifest.push({ path, records: rawRows.length, sha256: await archiveSha256Hex(body) })
    entries.push({ path, blob: new Blob([body], { type: 'application/json' }) })
    cursor = page.at(-1)?.messageId
    onProgress?.({ phase: 'reading', done: processed, total })
  }
  verifyPeer()
  if ((await reader.countMessages(peerId)) !== total) throw Error('VK archive changed during ZIP export')
  const manifest = {
    format: 'koba-vk-conversation-zip-v1',
    exportedAt: new Date().toISOString(),
    peerId,
    recordCount: total,
    completeness: 'unknown',
    attachmentBytesIncluded: includedBytes,
    attachmentFilesIncluded: includedCount,
    missingAttachmentCount: missing.filter((entry) => entry.status === 'not_downloaded').length,
    chunks: chunkManifest,
    attachmentManifest: options.includeReferences ? 'attachments/status.json' : null,
    note: 'This user export contains saved original message snapshots, not a full IndexedDB backup.',
  }
  if (options.includeReferences)
    entries.push({
      path: 'attachments/status.json',
      blob: new Blob([JSON.stringify(missing)], { type: 'application/json' }),
    })
  entries.push({ path: 'manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)]) })
  onProgress?.({ phase: 'packaging', done: processed, total })
  const zip = await createStoredZipFromBlobs(entries)
  verifyPeer()
  return zip
}
