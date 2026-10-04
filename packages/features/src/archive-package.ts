import { archiveRecordAttachments } from '@chatgpt-booster/chatgpt'
import type {
  ArchiveAttachmentView,
  ArchiveExportOptions,
  ArchiveThreadView,
} from '@chatgpt-booster/core'
import { archiveAssetContentUrl, fetchArchiveAssetBytes } from '@chatgpt-booster/observer'
import {
  type ArchiveExportPipeline,
  DEFAULT_ARCHIVE_EXPORT_PIPELINE,
  exportIncludes,
} from './archive-export'
import type { ArchivedAsset, ArchivedConversation } from './archive-store'

export interface ArchivePackageManifestAsset extends ArchiveAttachmentView {
  path: string | null
  status: 'included' | 'missing_url' | 'fetch_failed' | 'size_mismatch' | 'package_limit'
  actualSizeBytes: number | null
  sha256: string | null
  error: string | null
}

export interface ArchivePackageResult {
  blob: Blob
  extension: 'zip'
  manifest: {
    schema: 'chatgpt-booster.package.v1'
    createdAt: string
    complete: boolean
    historyVerified: boolean
    captureVerified: boolean
    assetsComplete: boolean
    historyCoverage: unknown
    transcript: string
    assets: ArchivePackageManifestAsset[]
  }
}

interface ZipEntry {
  path: string
  bytes: Uint8Array
}

const encoder = new TextEncoder()
let crcTable: Uint32Array | undefined

function table() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    crcTable[index] = value >>> 0
  }
  return crcTable
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  const values = table()
  for (const byte of bytes) crc = (values[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function view(size: number) {
  return new DataView(new ArrayBuffer(size))
}

function bytes(value: DataView) {
  return new Uint8Array(value.buffer)
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

function concat(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

export function createStoredZip(entries: ZipEntry[]): Blob {
  if (entries.length > 0xffff) throw new Error('export.tooManyFiles')
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  const stamp = dosDateTime()
  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    if (name.byteLength > 0xffff || entry.bytes.byteLength > 0xffffffff)
      throw new Error('export.fileTooLarge')
    const crc = crc32(entry.bytes)
    const local = view(30)
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(8, 0, true)
    local.setUint16(10, stamp.time, true)
    local.setUint16(12, stamp.date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, entry.bytes.byteLength, true)
    local.setUint32(22, entry.bytes.byteLength, true)
    local.setUint16(26, name.byteLength, true)
    local.setUint16(28, 0, true)
    const localBytes = concat([bytes(local), name, entry.bytes])
    if (offset + localBytes.byteLength > 0xffffffff) throw new Error('export.packageTooLarge')
    locals.push(localBytes)

    const central = view(46)
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 0, true)
    central.setUint16(12, stamp.time, true)
    central.setUint16(14, stamp.date, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, entry.bytes.byteLength, true)
    central.setUint32(24, entry.bytes.byteLength, true)
    central.setUint16(28, name.byteLength, true)
    central.setUint16(30, 0, true)
    central.setUint16(32, 0, true)
    central.setUint16(34, 0, true)
    central.setUint16(36, 0, true)
    central.setUint32(38, 0, true)
    central.setUint32(42, offset, true)
    centrals.push(concat([bytes(central), name]))
    offset += localBytes.byteLength
  }
  const centralBytes = concat(centrals)
  if (centralBytes.byteLength > 0xffffffff || offset + centralBytes.byteLength > 0xffffffff)
    throw new Error('export.packageTooLarge')
  const end = view(22)
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(4, 0, true)
  end.setUint16(6, 0, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralBytes.byteLength, true)
  end.setUint32(16, offset, true)
  end.setUint16(20, 0, true)
  return new Blob([...locals, centralBytes, bytes(end)].map(asArrayBuffer), {
    type: 'application/zip',
  })
}

function safeName(value: string) {
  return (
    [...value]
      .map((char) => (char.charCodeAt(0) < 32 ? '-' : char))
      .join('')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/^\.+/, '')
      .slice(0, 120) || 'attachment'
  )
}

function references(thread: ArchiveThreadView, options: ArchiveExportOptions) {
  const result = new Map<string, ArchiveAttachmentView>()
  for (const turn of thread.turns)
    for (const item of [...turn.messages, ...turn.details]) {
      if (!exportIncludes(item, options)) continue
      for (const attachment of archiveRecordAttachments(item.record)) {
        const previous = result.get(attachment.assetId)
        result.set(attachment.assetId, {
          ...previous,
          ...attachment,
          fileName: attachment.fileName ?? previous?.fileName ?? null,
          mimeType: attachment.mimeType ?? previous?.mimeType ?? null,
          sizeBytes: attachment.sizeBytes ?? previous?.sizeBytes ?? null,
          width: attachment.width ?? previous?.width ?? null,
          height: attachment.height ?? previous?.height ?? null,
          kind: attachment.kind === 'image' || previous?.kind === 'image' ? 'image' : 'file',
        })
      }
    }
  return [...result.values()]
}

async function sha256(value: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', asArrayBuffer(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type ArchiveAssetFetcher = (url: string, assetId: string) => Promise<ArrayBuffer>

const MAX_ARCHIVE_PACKAGE_ASSET_BYTES = 512 * 1024 * 1024

export async function createArchivePackage(
  conversation: ArchivedConversation,
  thread: ArchiveThreadView,
  options: ArchiveExportOptions,
  evidence: unknown,
  assets: ArchivedAsset[],
  fetcher: ArchiveAssetFetcher = fetchArchiveAssetBytes,
  signal?: AbortSignal,
  exportPipeline: ArchiveExportPipeline = DEFAULT_ARCHIVE_EXPORT_PIPELINE,
): Promise<ArchivePackageResult> {
  const transcriptOptions: ArchiveExportOptions =
    options.level === 'full'
      ? { ...options, reasoning: true, tools: true, internal: true, images: true, files: true }
      : options
  const transcript = exportPipeline.serialize(conversation, thread, transcriptOptions, evidence)
  const transcriptName = `conversation.${transcript.extension}`
  const entries: ZipEntry[] = [{ path: transcriptName, bytes: encoder.encode(transcript.text) }]
  const stored = new Map(assets.map((asset) => [asset.assetId, asset]))
  const requested = references(thread, transcriptOptions).filter(
    (attachment) =>
      options.level === 'full' || (attachment.kind === 'image' ? options.images : options.files),
  )
  const usedPaths = new Set<string>()
  const manifestAssets: ArchivePackageManifestAsset[] = []
  let includedAssetBytes = 0
  for (const reference of requested) {
    if (signal?.aborted)
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Aborted', 'AbortError')
    const storedAsset = stored.get(reference.assetId)
    const url = storedAsset?.downloadUrl
      ? archiveAssetContentUrl(storedAsset.downloadUrl, reference.assetId)
      : null
    if (!url) {
      manifestAssets.push({
        ...reference,
        path: null,
        status: 'missing_url',
        actualSizeBytes: null,
        sha256: null,
        error: 'No verified signed asset URL was observed for this archived file.',
      })
      continue
    }
    if (
      reference.sizeBytes !== null &&
      includedAssetBytes + reference.sizeBytes > MAX_ARCHIVE_PACKAGE_ASSET_BYTES
    ) {
      manifestAssets.push({
        ...reference,
        path: null,
        status: 'package_limit',
        actualSizeBytes: null,
        sha256: null,
        error: 'Archive package attachment limit is 512 MiB.',
      })
      continue
    }
    try {
      const data = new Uint8Array(
        await (fetcher === fetchArchiveAssetBytes
          ? fetchArchiveAssetBytes(url, reference.assetId, window, signal)
          : fetcher(url, reference.assetId)),
      )
      if (includedAssetBytes + data.byteLength > MAX_ARCHIVE_PACKAGE_ASSET_BYTES) {
        manifestAssets.push({
          ...reference,
          path: null,
          status: 'package_limit',
          actualSizeBytes: data.byteLength,
          sha256: null,
          error: 'Archive package attachment limit is 512 MiB.',
        })
        continue
      }
      let name = safeName(reference.fileName ?? `${reference.assetId}.bin`)
      if (usedPaths.has(name)) name = safeName(`${reference.assetId}-${name}`)
      usedPaths.add(name)
      const path = `attachments/${name}`
      entries.push({ path, bytes: data })
      includedAssetBytes += data.byteLength
      const sizeMismatch = reference.sizeBytes !== null && reference.sizeBytes !== data.byteLength
      manifestAssets.push({
        ...reference,
        path,
        status: sizeMismatch ? 'size_mismatch' : 'included',
        actualSizeBytes: data.byteLength,
        sha256: await sha256(data),
        error: sizeMismatch
          ? `Expected ${reference.sizeBytes} bytes, received ${data.byteLength}.`
          : null,
      })
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        throw error
      manifestAssets.push({
        ...reference,
        path: null,
        status: 'fetch_failed',
        actualSizeBytes: null,
        sha256: null,
        error: error instanceof Error ? error.message : 'Asset fetch failed.',
      })
    }
  }
  const historyVerified =
    Boolean(evidence) &&
    typeof evidence === 'object' &&
    !Array.isArray(evidence) &&
    (evidence as { verified?: unknown }).verified === true
  const captureVerified =
    Boolean(evidence) &&
    typeof evidence === 'object' &&
    !Array.isArray(evidence) &&
    (evidence as { capture?: { verified?: unknown } }).capture?.verified === true
  const assetsComplete = manifestAssets.every((asset) => asset.status === 'included')
  const manifest = {
    schema: 'chatgpt-booster.package.v1' as const,
    createdAt: new Date().toISOString(),
    complete: historyVerified && captureVerified && assetsComplete,
    historyVerified,
    captureVerified,
    assetsComplete,
    historyCoverage: evidence,
    transcript: transcriptName,
    assets: manifestAssets,
  }
  entries.push({ path: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest, null, 2)) })
  if (options.level === 'full') {
    const raw = thread.turns.flatMap((turn) =>
      [...turn.messages, ...turn.details].map((item) => item.record.raw),
    )
    entries.push({ path: 'records.raw.json', bytes: encoder.encode(JSON.stringify(raw, null, 2)) })
  }
  return { blob: createStoredZip(entries), extension: 'zip', manifest }
}
