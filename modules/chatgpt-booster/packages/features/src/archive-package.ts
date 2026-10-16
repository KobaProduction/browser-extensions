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

import { createStoredZip, type ZipEntry } from '@kobaproduction/browser-archive'

export {
  createGzipFromBlob,
  createStoredZip,
  createStoredZipFromBlobs,
} from '@kobaproduction/browser-archive'

const encoder = new TextEncoder()

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
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

export type ArchiveAssetFetcher = (
  url: string,
  assetId: string,
  signal?: AbortSignal,
) => Promise<ArrayBuffer>

const defaultArchiveAssetFetcher: ArchiveAssetFetcher = (url, assetId, signal) =>
  fetchArchiveAssetBytes(url, assetId, window, signal)

const MAX_ARCHIVE_PACKAGE_ASSET_BYTES = 512 * 1024 * 1024

export async function createArchivePackage(
  conversation: ArchivedConversation,
  thread: ArchiveThreadView,
  options: ArchiveExportOptions,
  evidence: unknown,
  assets: ArchivedAsset[],
  fetcher: ArchiveAssetFetcher = defaultArchiveAssetFetcher,
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
      throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
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
      const data = new Uint8Array(await fetcher(url, reference.assetId, signal))
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
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
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
  // Technical full transcripts already include every originalRecord. A second
  // records.raw.json in the same ZIP duplicated potentially huge tool results.
  return { blob: createStoredZip(entries), extension: 'zip', manifest }
}
