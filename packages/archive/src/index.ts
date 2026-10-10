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
