export interface ArchiveReadableRecord {
  readonly heading: string
  readonly headingLevel?: 2 | 3
  readonly text: string
  readonly attachments?: readonly {
    readonly name: string
    readonly mime?: string | null
    readonly url?: string | null
    readonly status?: string | null
  }[]
  /** Caller supplies a lossless JSON source codec when an original is included. */
  readonly original?: unknown
}
export interface ArchiveExportInput {
  readonly document: unknown
  readonly title: string
  readonly records: Iterable<ArchiveReadableRecord>
  readonly includeOriginal?: boolean
  /** Bounded chunks may append to one readable file without repeating its title. */
  readonly includeTitle?: boolean
}
export interface SerializedArchiveExport {
  readonly text: string
  readonly mime: string
  readonly extension: string
}
export interface ChunkedArchiveExport {
  readonly chunks: Iterable<string>
  readonly mime: string
  readonly extension: string
}
export type SharedArchiveExportFormat = 'json' | 'markdown' | 'text'
/** A renderer never fetches links. Unsupported originals remain in source metadata. */
export declare function safeArchiveExportLink(value: string): string | null
/** Provider-neutral chunk formatter. Chunks end on string boundaries so an
 * astral character is never split across independent UTF-8 encoders. */
export declare function serializeArchiveExportChunks(
  format: SharedArchiveExportFormat,
  input: ArchiveExportInput,
): ChunkedArchiveExport
/** Existing small-document API; large consumers drain the shared chunks. */
export declare function serializeArchiveExport(
  format: SharedArchiveExportFormat,
  input: ArchiveExportInput,
): SerializedArchiveExport
export interface ArchiveRange {
  readonly firstId: string
  readonly lastId: string
}
export interface ResolvedArchiveRange<T> {
  readonly messageIds: readonly string[]
  readonly first: T
  readonly last: T
}
/** Streamed range resolution works across page boundaries without loading all records. */
export declare function collectArchiveRange<T>(
  records: Iterable<T> | AsyncIterable<T>,
  range: ArchiveRange,
  getId: (record: T) => string,
): Promise<ResolvedArchiveRange<T>>
