/** Provider-independent ZIP32 archive builder extracted from ChatGPT Booster.
 * Caller supplies validated relative entry paths and any media bytes.
 * This is STORE-only ZIP: the caller must not claim unavailable files exist. */
export interface ZipEntry {
  path: string
  bytes: Uint8Array
}
export declare function createStoredZip(entries: ZipEntry[]): Blob
/**
 * Store-only ZIP32 for Blob-backed exports. The archive does not need a
 * second full Uint8Array copy of each document; CRC32 is computed over
 * bounded 64 KiB Blob slices. Native-source/path data are still materialized
 * by the caller, so this is not end-to-end streaming export.
 */
/** Lossless gzip container for large source-native JSON without cloning its
 * uncompressed bytes into an additional JavaScript string. The browser stream
 * owns compression; completed buffers are released on cancellation. */
export declare function createStoredZipFromBlobs(
  entries: {
    path: string
    blob: Blob
  }[],
  signal?: AbortSignal,
  onProgress?: (completedBytes: number, totalBytes: number) => void,
): Promise<Blob>
