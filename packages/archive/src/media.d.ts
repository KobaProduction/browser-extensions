/** Bounded binary response reader, independent of provider, credentials and storage. */
export interface ArchiveMediaResult {
  bytes: Uint8Array<ArrayBuffer>
  size: number
  sha256: string
  mime: string
}
export interface ArchiveMediaReadOptions {
  maxBytes: number
  /** Provider-declared original file size, not a guessed Content-Length. */
  expectedBytes?: number | null
}
export declare function readArchiveMedia(
  response: Response,
  options: ArchiveMediaReadOptions,
): Promise<ArchiveMediaResult>
