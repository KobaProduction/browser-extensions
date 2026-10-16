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
export declare function createGzipFromBlob(
  input: Blob,
  signal?: AbortSignal,
  onBytes?: (processed: number, total: number) => void,
): Promise<Blob>
/** Record identity is an archive concern, not a provider or UI concern. The
 * last local update wins without reordering existing identities. */
export declare function indexArchiveRecords<T>(
  records: readonly T[],
  identity: (record: T) => string | number,
): Map<string | number, T>
/** JSON tuple keys prevent delimiter collisions and are stable across targets. */
export declare function archiveCompositeKey(...components: string[]): string
/** SHA-256 is shared by ChatGPT source fingerprints and VK media receipts.
 * Caller owns storage of hashes; this function never stores or logs bytes. */
export declare function archiveSha256Hex(bytes: ArrayBuffer | Uint8Array | string): Promise<string>
export type { ArchivePageFoldOptions, ArchivePageFoldResult, ArchivePageMode } from './page-fold'
export { foldArchivePage } from './page-fold'
/** Bounded, streaming, lossless output for asynchronous archive JSONL records.
 * Unlike compressing an already-materialized Blob, this never retains an
 * uncompressed archive copy in memory. The caller owns final user download. */
export declare function createGzipFromChunks(
  input: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<Blob>
export type { ArchiveChangeFeed } from './archive-events'
export { createArchiveChangeFeed } from './archive-events'
export type {
  ChatCollectionController,
  ChatCollectionPort,
  ChatCollectionSnapshot,
} from './chat-collection'
export { createChatCollectionController } from './chat-collection'
export type {
  ArchiveExportInput,
  ArchiveRange,
  ArchiveReadableRecord,
  ChunkedArchiveExport,
  ResolvedArchiveRange,
  SerializedArchiveExport,
  SharedArchiveExportFormat,
} from './conversation-export'
export {
  collectArchiveRange,
  serializeArchiveExport,
  serializeArchiveExportChunks,
} from './conversation-export'
export type {
  ArchiveConversationIntegrity,
  ArchiveGraphNode,
  ArchiveIntegrityEvidence,
  LinearArchiveEvidence,
} from './conversation-integrity'
export { conversationIntegrityFromGraph, linearArchiveIntegrity } from './conversation-integrity'
export type { ArchivePageScan, ArchivePageSelection, ArchiveScanMode } from './linear-selection'
export { selectArchivePage } from './linear-selection'
export type { ArchiveMediaReadOptions, ArchiveMediaResult } from './media'
export { readArchiveMedia } from './media'
export type {
  ArchiveMessageElementV1,
  ArchiveMessageIdentity,
  ArchiveMessageSourceContext,
  ArchiveMessageV1,
} from './message-model'
export {
  ARCHIVE_MESSAGE_MODEL_VERSION,
  archiveMessageKey,
  archiveMessageText,
  resolveArchiveMessage,
  validateArchiveMessage,
} from './message-model'
export type {
  LinearArchiveCommit,
  LinearArchiveSource,
  LinearScanOptions,
  LinearScanResult,
  LinearScanState,
} from './scan-linear'
export { scanLinearArchive } from './scan-linear'
export type { ZipEntry } from './stored-zip'
/** One ZIP32 implementation reused by ChatGPT and VK export adapters. */
export { createStoredZip, createStoredZipFromBlobs } from './stored-zip'
export type { ArchiveCloneNode } from './structured'
export {
  ARCHIVE_CLONE_JSON_MAX_DEPTH,
  ARCHIVE_CLONE_MAX_DEPTH,
  decodeArchiveClone,
  encodeArchiveClone,
} from './structured'
