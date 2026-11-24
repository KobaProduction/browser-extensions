import { archiveRecordAttachments, buildArchiveThread } from '@chatgpt-booster/chatgpt'
import type {
  ArchiveExportOptions,
  ArchiveExportOutcome,
  ArchiveExportProgressListener,
} from '@chatgpt-booster/core'
import { createGzipFromChunks, createStoredZipFromBlobs } from '@kobaproduction/browser-archive'
import { DEFAULT_ARCHIVE_EXPORT_PIPELINE, exportIncludes } from './archive-export'
import { type PreparedArchiveOriginal, prepareArchiveOriginal } from './archive-export-source'
import type { FixedCanonicalDexieRepository } from './archive-fixed-dexie'
import { chatGptArchiveRecord } from './archive-message-adapter'
import { detachSourceSnapshot } from './archive-source-snapshot'

/** Ordinary selective export reuses the provider serializer and shared packaging. */
export async function exportFixedConversation(
  repository: FixedCanonicalDexieRepository,
  id: string,
  inputOptions: ArchiveExportOptions,
  authorize: () => void,
  signal?: AbortSignal,
  progress?: ArchiveExportProgressListener,
): Promise<ArchiveExportOutcome> {
  const options = {
    ...inputOptions,
    ...(inputOptions.messageIds ? { messageIds: [...inputOptions.messageIds] } : {}),
  }
  const check = () => {
    authorize()
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  }
  check()
  progress?.({ phase: 'checking', unit: null, completed: null, total: null })
  const records = [],
    versions: Record<string, unknown> = Object.create(null),
    versionsEncoding: Record<string, 'archive-clone-v1'> = Object.create(null)
  const originals = new Map<string, PreparedArchiveOriginal>()
  const selected = options.messageIds ? new Set(options.messageIds) : null
  if (
    selected &&
    (!selected.size ||
      [...selected].some((value) => typeof value !== 'string' || !value || value.length > 256))
  )
    throw Error('Invalid selected messages')
  const { header, integrity, count, snapshots } = await repository.readExportSnapshot(
    id,
    selected,
    check,
    (completed, total) => progress?.({ phase: 'reading', unit: 'records', completed, total }),
  )
  for (const [index, snapshot] of snapshots.entries()) {
    check()
    const source = repository.presentSourceSnapshot(snapshot, id, header)
    const messageId = typeof source.raw.id === 'string' ? source.raw.id : null
    const record = chatGptArchiveRecord(source.raw, source.normalized)
    if (!record || !messageId || record.messageId !== messageId)
      throw Error('Source message cannot be decoded')
    records.push(record)
    if (options.level === 'full') originals.set(messageId, await prepareArchiveOriginal(source.raw))
    if ((options.level === 'custom' && options.sourceRevisions) || options.level === 'full') {
      const detached = detachSourceSnapshot({
        ...source,
        versions: [...repository.sourceVersions(id, source)],
      })
      const prepared = await prepareArchiveOriginal(detached.versions ?? [detached])
      versions[messageId] = prepared.value
      if (prepared.encoding) versionsEncoding[messageId] = prepared.encoding
    }
    if ((index + 1) % 64 === 0 || index + 1 === snapshots.length) {
      progress?.({
        phase: 'serializing',
        unit: 'records',
        completed: records.length,
        total: snapshots.length,
      })
      if (index + 1 < snapshots.length) await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  check()
  const thread = buildArchiveThread(records),
    attachments = new Map<string, unknown>()
  for (const turn of thread.turns)
    for (const item of [...turn.messages, ...turn.details]) {
      if (!exportIncludes(item, options)) continue
      for (const reference of archiveRecordAttachments(item.record))
        if (
          (reference.kind === 'image' && options.images) ||
          (reference.kind !== 'image' && options.files)
        )
          attachments.set(reference.assetId, reference)
    }
  const evidence = {
    integrity,
    selectedMessageIds: selected ? [...selected] : null,
    sourceVersions: versions,
    ...(Object.keys(versionsEncoding).length ? { sourceVersionsEncoding: versionsEncoding } : {}),
    binaryAttachmentsIncluded: false,
    missingBinaryAttachments: [...attachments.values()],
  }
  const serialized = DEFAULT_ARCHIVE_EXPORT_PIPELINE.serializeChunks(
    header,
    thread,
    options,
    evidence,
    originals,
  )
  check()
  const encoder = new TextEncoder()
  async function* chunks(): AsyncGenerator<string> {
    let batch = 0
    for (const chunk of serialized.chunks) {
      check()
      yield chunk
      // Give cancellation/owner changes a turn while preparing an uncompressed
      // download too. Retained output is Blob-backed, not one giant JS string.
      if (++batch % 32 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    check()
  }
  let blob: Blob,
    extension = serialized.extension
  const packaging = options.packaging ?? 'none'
  if (packaging === 'gzip') {
    async function* encoded(): AsyncGenerator<Uint8Array> {
      for await (const chunk of chunks()) yield encoder.encode(chunk)
    }
    blob = await createGzipFromChunks(encoded(), signal)
    extension += '.gz'
  } else {
    const parts: BlobPart[] = []
    for await (const chunk of chunks()) parts.push(new Blob([chunk]))
    blob = new Blob(parts, { type: serialized.mime })
  }
  if (packaging === 'zip') {
    blob = await createStoredZipFromBlobs(
      [
        { path: `conversation.${serialized.extension}`, blob },
        {
          path: 'manifest.json',
          blob: new Blob(
            [
              JSON.stringify(
                {
                  schema: 'chatgpt-booster.package.v1',
                  integrity,
                  complete:
                    integrity.chain === 'verified' &&
                    (!selected || selected.size === count) &&
                    !attachments.size,
                  binaryAttachmentsIncluded: false,
                  missingAssets: [...attachments.values()],
                },
                null,
                2,
              ),
            ],
            { type: 'application/json' },
          ),
        },
      ],
      signal,
      (completed, total) => {
        check()
        progress?.({ phase: 'packaging', unit: 'bytes', completed, total })
        check()
      },
    )
    extension = 'zip'
  }
  check()
  const current = await repository.getConversation(id)
  if (!current || current.instanceId !== header.instanceId) throw Error('archive.error.sourceChanged')
  check()
  progress?.({ phase: 'ready', unit: 'bytes', completed: blob.size, total: blob.size })
  check()
  return {
    blob,
    extension,
    packaged: packaging !== 'none',
    complete:
      integrity.chain === 'verified' && (!selected || selected.size === count) && !attachments.size,
    includedAssets: 0,
    missingAssets: attachments.size,
  }
}
