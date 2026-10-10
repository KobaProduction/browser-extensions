/** Source-neutral archive boundaries. A provider supplies native record mapping;
 * the application owns deduplication and explicit completeness evidence. */
export interface ArchiveRecord<Body = unknown> {
  readonly sourceId: string
  readonly accountId: string
  readonly conversationId: string
  readonly messageId: string
  readonly parentId: string | null
  readonly observedAt: number
  readonly body: Body
}
export interface ArchivePage<T> {
  readonly records: readonly T[]
  readonly nextCursor: string | null
  readonly complete: boolean | null
}
export interface ArchiveSource<T> {
  readonly sourceId: string
  readPage(conversationId: string, cursor: string | null, signal: AbortSignal): Promise<ArchivePage<T>>
}
export interface ArchiveCheckpoint {
  readonly conversationId: string
  readonly sourceId: string
  readonly lastCursor: string | null
  readonly observedAt: number
  readonly complete: boolean
}
export interface ArchiveRepository<T extends ArchiveRecord> {
  readCheckpoint(conversationId: string): Promise<ArchiveCheckpoint | null>
  upsertRecords(conversationId: string, records: readonly T[]): Promise<void>
  commitCheckpoint(conversationId: string, checkpoint: ArchiveCheckpoint): Promise<void>
}
/** Portable lossless gzip output. No provider-specific content is inspected. */
export async function createGzipFromBlob(
  input: Blob,
  signal?: AbortSignal,
  onBytes?: (processed: number, total: number) => void,
): Promise<Blob> {
  if (typeof CompressionStream !== 'function')
    throw new Error('GZIP compression is unavailable in this browser')
  if (signal?.aborted) throw new DOMException('Archive cancelled', 'AbortError')
  const reader = input.stream().pipeThrough(new CompressionStream('gzip')).getReader()
  const parts: BlobPart[] = []
  let compressed = 0
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Archive cancelled', 'AbortError')
      const next = await reader.read()
      if (next.done) break
      if (signal?.aborted) throw new DOMException('Archive cancelled', 'AbortError')
      parts.push(next.value)
      compressed += next.value.byteLength
      onBytes?.(compressed, input.size)
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
  return new Blob(parts, { type: 'application/gzip' })
}

/** Record identity is an archive concern, not a provider or UI concern. The
 * last local update wins without reordering existing identities. */
export function indexArchiveRecords<T>(
  records: readonly T[],
  identity: (record: T) => string | number,
): Map<string | number, T> {
  const indexed = new Map<string | number, T>()
  for (const record of records) {
    const id = identity(record)
    if (typeof id !== 'string' && typeof id !== 'number')
      throw new Error('Archive record requires a stable identity')
    if (typeof id === 'number' && !Number.isSafeInteger(id))
      throw new Error('Archive record identity is not a safe integer')
    if (typeof id === 'string' && !id) throw new Error('Archive record identity is empty')
    indexed.set(id, record)
  }
  return indexed
}

/** JSON tuple keys prevent delimiter collisions and are stable across targets. */
export function archiveCompositeKey(...components: string[]): string {
  if (components.some((value) => typeof value !== 'string'))
    throw new Error('Archive key components must be strings')
  return JSON.stringify(components)
}

/** SHA-256 is shared by ChatGPT source fingerprints and VK media receipts.
 * Caller owns storage of hashes; this function never stores or logs bytes. */
export async function archiveSha256Hex(bytes: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes)
    : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const safeBytes: Uint8Array<ArrayBuffer> = data.buffer instanceof ArrayBuffer
    ? data as Uint8Array<ArrayBuffer> : new Uint8Array(data)
  const digest = await crypto.subtle.digest('SHA-256', safeBytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export { foldArchivePage } from './page-fold'
export type { ArchivePageMode, ArchivePageFoldOptions, ArchivePageFoldResult } from './page-fold'

/** Bounded, streaming, lossless output for asynchronous archive JSONL records.
 * Unlike compressing an already-materialized Blob, this never retains an
 * uncompressed archive copy in memory. The caller owns final user download. */
export async function createGzipFromChunks(
  input: AsyncIterable<Uint8Array>, signal?: AbortSignal,
): Promise<Blob> {
  if (typeof CompressionStream !== 'function')
    throw new Error('Streaming GZIP is unavailable in this browser')
  if (signal?.aborted) throw new DOMException('Archive export aborted', 'AbortError')
  const iterator = input[Symbol.asyncIterator]()
  const chunks = new ReadableStream<BufferSource>({
    async pull(controller) {
      try {
        if (signal?.aborted) throw new DOMException('Archive export aborted', 'AbortError')
        const next = await iterator.next()
        if (next.done) controller.close()
        else {
          const safe: Uint8Array<ArrayBuffer> = next.value.buffer instanceof ArrayBuffer
            ? next.value as Uint8Array<ArrayBuffer> : new Uint8Array(next.value)
          controller.enqueue(safe)
        }
      } catch (error) { controller.error(error) }
    },
    async cancel() { await iterator.return?.(undefined) },
  })
  const reader = chunks.pipeThrough(new CompressionStream('gzip')).getReader()
  const parts: BlobPart[] = []
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Archive export aborted', 'AbortError')
      const next = await reader.read()
      if (next.done) break
      parts.push(next.value)
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
  return new Blob(parts, { type: 'application/gzip' })
}

export { encodeArchiveClone, decodeArchiveClone } from './structured'
export type { ArchiveCloneNode } from './structured'
