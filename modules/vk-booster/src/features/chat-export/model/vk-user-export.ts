/** End-user conversation export, NOT an IndexedDB recovery backup.
 * Uses the shared ZIP32 package writer also used by ChatGPT Booster. */
import {
  type ArchiveMessageV1,
  archiveMessageText,
  archiveSha256Hex,
  createStoredZipFromBlobs,
  encodeArchiveClone,
  type SharedArchiveExportFormat,
  serializeArchiveExport,
  serializeArchiveExportChunks,
} from '@kobaproduction/browser-archive'
import { inspectVkAssets } from '../api/vk-assets'
import type { FixedVkDexieRepository } from './archive-fixed-dexie'
import { readVkArchiveMessage } from './archive-message-adapter'
import type { VkArchiveCoverage, VkMessage } from './types'

export interface VkUserExportOptions {
  /** UI-derived filters are pinned to the metadata revision that resolved them. */
  expectedRevision?: number
  chunkRows: 100 | 500
  includeReferences: boolean
  /** ZIP always retains original JSON chunks; standalone readable output is an optional view. */
  format?: SharedArchiveExportFormat
  packaging?: 'zip' | 'none'
  /** Binary inclusion is explicit and applies only to ZIP. No source is fetched by export. */
  includeMedia?: boolean
  /** Readable formats may additionally include portable original records. ZIP JSON remains lossless. */
  includeOriginal?: boolean
  /** Omit to export all saved messages; an explicit selection must be nonempty. */
  messageIds?: readonly number[]
  downloadedMedia?: readonly { key: string; name: string; blob: Blob }[]
  signal?: AbortSignal
}
export interface VkUserExportResult {
  blob: Blob
  extension: 'zip' | 'json' | 'md' | 'txt'
  mime: string
  packaged: boolean
  recordCount: number
  attachmentFilesIncluded: number
  missingAttachmentCount: number
}
export interface VkExportProgress {
  phase: 'reading' | 'packaging'
  done: number
  total: number
}
type Reader = Pick<FixedVkDexieRepository, 'countMessages' | 'listMessages' | 'getOriginal'>
export type VkExportAttachmentReference = {
  messageId: number
  key: string
  type: string
  name: string
  sourceUrl: string | null
  sourceUrls: readonly string[]
  status: 'not_downloaded' | 'not_included' | 'included' | 'unavailable' | 'link'
  localPath: string | null
  sha256: string | null
  size: number | null
  mime: string | null
}
/** ZIP paths, manifest paths and readable links share this exact well-formed name. */
function attachmentFileName(value: string): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
    .replace(/^\.+/, '_')
  const encoder = new TextEncoder()
  let name = '',
    bytes = 0
  for (const character of cleaned) {
    const code = character.codePointAt(0) ?? 0
    const safe = code >= 0xd800 && code <= 0xdfff ? '_' : character
    const size = encoder.encode(safe).length
    if (bytes + size > 96) break
    name += safe
    bytes += size
  }
  return name || 'attachment'
}
export async function createVkUserExport(
  reader: Reader,
  peerId: number,
  options: VkUserExportOptions,
  verifyPeer: () => void,
  onProgress?: (progress: VkExportProgress) => void,
  coverage?: VkArchiveCoverage,
): Promise<VkUserExportResult> {
  options = {
    ...options,
    messageIds: options.messageIds && [...options.messageIds],
    downloadedMedia: options.downloadedMedia?.map((item) => ({ ...item })),
  }
  const check = () => {
    options.signal?.throwIfAborted()
    verifyPeer()
  }
  if (options.chunkRows !== 100 && options.chunkRows !== 500) throw Error('Invalid VK export page size')
  if (
    options.messageIds !== undefined &&
    (!Array.isArray(options.messageIds) ||
      options.messageIds.length < 1 ||
      options.messageIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
  )
    throw Error('Invalid VK export selection')
  const selectedIds = options.messageIds === undefined ? null : new Set(options.messageIds)
  const format = options.format ?? 'json'
  const packaging = options.packaging ?? 'zip'
  if (!['json', 'markdown', 'text'].includes(format)) throw Error('Invalid VK export format')
  if (!['zip', 'none'].includes(packaging)) throw Error('Invalid VK export packaging')
  if (options.includeMedia && packaging !== 'zip')
    throw Error('VK media inclusion requires ZIP packaging')
  const missingSelectedIds = selectedIds ? new Set(selectedIds) : null
  check()
  const total = await reader.countMessages(peerId)
  check()
  if (coverage && coverage.savedCount !== total)
    throw Error('VK archive changed after coverage validation')
  if (!total) throw Error('No saved VK messages for ZIP export')
  const entries: { path: string; blob: Blob }[] = []
  const chunkManifest: { path: string; records: number; sha256: string }[] = []
  const missing: VkExportAttachmentReference[] = []
  const downloaded = new Map(options.downloadedMedia?.map((item) => [item.key, item]) ?? [])
  const exportedPaths = new Set<string>()
  let includedBytes = 0
  let includedCount = 0
  let attachmentReferencesComplete = true
  let cursor: number | undefined
  let processed = 0
  let exported = 0
  let owner: string | undefined
  type ExportRow = {
    normalized: ArchiveMessageV1
    id: number
    sentAt: number | null
    senderId: number | null
    outgoing: boolean | null
    text: string | null
    attachments: VkExportAttachmentReference[]
    snapshot: {
      sourceVersion: string
      encoding: 'archive-clone-v1'
      original: unknown
      previous?: { sourceVersion: string; recordedAtMs: number; original: unknown }[]
    }
  }
  let rawRows: ExportRow[] = []
  const readableParts: Blob[] = []
  const jsonParts: Blob[] = []
  async function flushChunk() {
    check()
    if (!rawRows.length) return
    const path = `messages/${String(chunkManifest.length + 1).padStart(6, '0')}.json`
    if (packaging === 'zip' || format === 'json') {
      const body = serializeArchiveExport('json', { document: rawRows, title: '', records: [] }).text
      const sha256 = await archiveSha256Hex(body)
      check()
      chunkManifest.push({ path, records: rawRows.length, sha256 })
      if (packaging === 'zip')
        entries.push({ path, blob: new Blob([body], { type: 'application/json' }) })
      else jsonParts.push(new Blob([jsonParts.length ? ',\n' : '', body.slice(1, -1)]))
    }
    if (format !== 'json') {
      const readable = serializeArchiveExportChunks(format, {
        document: null,
        title: `VK · ${peerId}`,
        includeTitle: false,
        includeOriginal: options.includeOriginal === true,
        records: rawRows.map((row) => ({
          heading: `${row.outgoing ? 'Вы' : row.senderId ? `Участник ${row.senderId}` : 'Отправитель неизвестен'}${row.sentAt !== null && Number.isFinite(new Date(row.sentAt * 1000).getTime()) ? ` · ${new Date(row.sentAt * 1000).toISOString()}` : ''} · #${row.id}`,
          text: row.text ?? '',
          attachments: row.attachments.map((attachment) => ({
            name: attachment.name,
            mime: attachment.mime,
            url: attachment.localPath ?? attachment.sourceUrl,
            status: attachment.status,
          })),
          original: {
            encoding: row.snapshot.encoding,
            value: row.snapshot.original,
            ...(row.snapshot.previous?.length ? { previous: row.snapshot.previous } : {}),
          },
        })),
      })
      readableParts.push(new Blob([...readable.chunks, '\n'], { type: readable.mime }))
    }
    rawRows = []
  }
  while (processed < total) {
    check()
    const limit = Math.min(options.chunkRows, total - processed)
    const page = await reader.listMessages(peerId, limit, cursor)
    if (!page.length || page.length > limit) throw Error('VK export source changed during paging')
    let previousId = cursor ?? 0
    for (const row of page) {
      check()
      if (!Number.isSafeInteger(row.messageId) || row.messageId <= previousId)
        throw Error('VK export source cursor changed during paging')
      owner ??= row.ownerId
      if (!owner || row.ownerId !== owner || row.peerId !== peerId)
        throw Error('Mismatched VK export owner or conversation')
      previousId = row.messageId
      processed++
      if (selectedIds && !selectedIds.has(row.messageId)) continue
      const original = await reader.getOriginal(peerId, row.messageId)
      check()
      if (!original || original.ownerId !== row.ownerId || original.key !== row.key)
        throw Error('Missing verified original VK snapshot')
      const raw: VkMessage = original.raw
      if (raw.id !== row.messageId || (raw.peer_id !== undefined && raw.peer_id !== peerId))
        throw Error('Mismatched VK source snapshot during export')
      const normalized = readVkArchiveMessage(
        raw,
        {
          ownerId: original.ownerId,
          conversationId: String(peerId),
          sourceKind: 'vk-history',
          sourceVersion: original.sourceVersion,
          observedAtMs: original.recordedAtMs,
        },
        original.normalized,
      )
      const exportedAttachments: VkExportAttachmentReference[] = []
      const exportRow: ExportRow = {
        normalized,
        id: row.messageId,
        sentAt: normalized.time.createdAtMs === null ? null : normalized.time.createdAtMs / 1000,
        senderId: normalized.author.id === null ? null : Number(normalized.author.id),
        outgoing:
          normalized.context.direction === null ? null : normalized.context.direction === 'outgoing',
        text: archiveMessageText(normalized),
        attachments: exportedAttachments,
        snapshot: {
          sourceVersion: original.sourceVersion,
          encoding: 'archive-clone-v1',
          original:
            packaging === 'zip' || format === 'json' || options.includeOriginal
              ? await encodeArchiveClone(raw)
              : null,
          ...(original.previous?.length &&
          (packaging === 'zip' || format === 'json' || options.includeOriginal)
            ? {
                previous: await Promise.all(
                  original.previous.map(async (observation) => ({
                    sourceVersion: observation.sourceVersion,
                    recordedAtMs: observation.recordedAtMs,
                    original: await encodeArchiveClone(observation.raw),
                  })),
                ),
              }
            : {}),
        },
      }
      check()
      rawRows.push(exportRow)
      exported++
      missingSelectedIds?.delete(row.messageId)
      {
        const references = inspectVkAssets(raw)
        attachmentReferencesComplete &&= !references.truncated
        for (const ref of references.assets) {
          const candidate = downloaded.get(ref.key)
          let path: string | null = null
          let digest: string | null = null
          if (
            options.includeMedia === true &&
            candidate?.blob instanceof Blob &&
            candidate.blob.size > 0 &&
            candidate.blob.size <= 64 * 1024 * 1024 &&
            includedBytes + candidate.blob.size <= 512 * 1024 * 1024
          ) {
            const safe = attachmentFileName(candidate.name)
            path = `attachments/${row.messageId}/${safe}`
            if (exportedPaths.has(path))
              path = `attachments/${row.messageId}/${ref.key.replace(/[^a-z0-9_-]/gi, '_')}-${safe}`
            const base = path
            for (let suffix = 1; exportedPaths.has(path); suffix++) path = `${base}-${suffix}`
            exportedPaths.add(path)
            entries.push({ path, blob: candidate.blob })
            digest = await archiveSha256Hex(await candidate.blob.arrayBuffer())
            check()
            includedBytes += candidate.blob.size
            includedCount++
          }
          const reference: VkExportAttachmentReference = {
            messageId: row.messageId,
            key: ref.key,
            type: ref.type,
            name: candidate?.name ?? ref.choices[0]?.name ?? `${ref.type} · ${ref.key}`,
            sourceUrl: options.includeReferences ? (ref.external ?? ref.choices[0]?.url ?? null) : null,
            sourceUrls: options.includeReferences
              ? [...(ref.external ? [ref.external] : []), ...ref.choices.map((choice) => choice.url)]
              : [],
            status: path
              ? 'included'
              : ref.type === 'link'
                ? 'link'
                : !ref.choices.length
                  ? 'unavailable'
                  : options.includeMedia
                    ? 'not_downloaded'
                    : 'not_included',
            localPath: path,
            sha256: digest,
            size: path ? (candidate?.blob.size ?? null) : null,
            mime: path ? candidate?.blob.type || null : null,
          }
          missing.push(reference)
          if (options.includeReferences || path) exportedAttachments.push(reference)
        }
      }
      if (rawRows.length === options.chunkRows) await flushChunk()
    }
    cursor = page.at(-1)?.messageId
    onProgress?.({ phase: 'reading', done: processed, total })
  }
  check()
  if ((await reader.countMessages(peerId)) !== total) throw Error('VK archive changed during ZIP export')
  check()
  if (missingSelectedIds?.size) throw Error('Selected VK messages are no longer saved')
  if (!exported) throw Error('No saved VK messages for ZIP export')
  await flushChunk()
  const manifest = {
    format: packaging === 'zip' ? 'koba-vk-conversation-zip-v1' : 'koba-vk-conversation-v1',
    exportedAt: new Date().toISOString(),
    peerId,
    recordCount: exported,
    savedRecordCount: total,
    selection: selectedIds
      ? { mode: 'selected', messageIds: [...selectedIds].sort((a, b) => a - b) }
      : { mode: 'all' },
    completeness:
      coverage?.integrity.chain === 'verified' && (!selectedIds || selectedIds.size === total)
        ? 'verified'
        : 'unknown',
    coverage: coverage ?? null,
    fullSavedSelection: !selectedIds || selectedIds.size === total,
    readableFormat: format,
    packaging,
    mediaRequested: options.includeMedia === true,
    attachmentReferencesComplete,
    readablePath: format === 'json' ? null : `conversation.${format === 'markdown' ? 'md' : 'txt'}`,
    attachmentBytesIncluded: includedBytes,
    attachmentFilesIncluded: includedCount,
    missingAttachmentCount: missing.filter((entry) =>
      ['not_downloaded', 'not_included', 'unavailable'].includes(entry.status),
    ).length,
    chunks:
      packaging === 'zip'
        ? chunkManifest
        : chunkManifest.map(({ records, sha256 }) => ({ records, sha256 })),
    attachmentManifest:
      packaging === 'zip' && options.includeReferences ? 'attachments/status.json' : null,
    note:
      packaging === 'zip' || format === 'json' || options.includeOriginal
        ? 'This user export contains saved original message snapshots, not a full IndexedDB backup.'
        : 'This readable user export contains saved message text and requested attachment references, not a full IndexedDB backup.',
  }
  const title = `VK · ${peerId}`
  const summary = `Saved messages: ${exported}/${total}. History: ${manifest.completeness}. Attachment files included: ${includedCount}. Missing attachment files: ${manifest.missingAttachmentCount}. Attachment reference coverage: ${attachmentReferencesComplete ? 'known saved slots' : 'partial'}. Source links are references and may expire.\n\n`
  const readableBlob =
    format === 'json'
      ? null
      : new Blob([`${format === 'markdown' ? '# ' : ''}${title}\n\n${summary}`, ...readableParts], {
          type: format === 'markdown' ? 'text/markdown' : 'text/plain',
        })
  if (packaging === 'zip' && manifest.readablePath && readableBlob)
    entries.push({
      path: manifest.readablePath,
      blob: readableBlob,
    })
  if (packaging === 'zip' && options.includeReferences)
    entries.push({
      path: 'attachments/status.json',
      blob: new Blob([JSON.stringify(missing)], { type: 'application/json' }),
    })
  if (packaging === 'zip')
    entries.push({ path: 'manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)]) })
  onProgress?.({ phase: 'packaging', done: exported, total: exported })
  check()
  const blob =
    packaging === 'zip'
      ? await createStoredZipFromBlobs(entries, options.signal)
      : (readableBlob ??
        new Blob(
          [
            '{\n"format":"koba-vk-conversation-v1",\n"manifest":',
            JSON.stringify(manifest),
            ',\n"messages":[',
            ...jsonParts,
            '\n]}\n',
          ],
          { type: 'application/json' },
        ))
  check()
  return {
    blob,
    extension:
      packaging === 'zip' ? 'zip' : format === 'markdown' ? 'md' : format === 'text' ? 'txt' : 'json',
    mime: packaging === 'zip' ? 'application/zip' : (readableBlob?.type ?? 'application/json'),
    packaged: packaging === 'zip',
    recordCount: exported,
    attachmentFilesIncluded: includedCount,
    missingAttachmentCount: manifest.missingAttachmentCount,
  }
}
/** Compatibility port always packages ZIP; no implicit network download. */
export async function createVkUserExportZip(
  reader: Reader,
  peerId: number,
  options: VkUserExportOptions,
  verifyPeer: () => void,
  onProgress?: (progress: VkExportProgress) => void,
  coverage?: VkArchiveCoverage,
): Promise<Blob> {
  return (
    await createVkUserExport(
      reader,
      peerId,
      { ...options, packaging: 'zip' },
      verifyPeer,
      onProgress,
      coverage,
    )
  ).blob
}
