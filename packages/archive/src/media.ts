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

export async function readArchiveMedia(
  response: Response,
  options: ArchiveMediaReadOptions,
): Promise<ArchiveMediaResult> {
  const { maxBytes, expectedBytes = null } = options
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('Invalid media limit')
  if (expectedBytes !== null && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0))
    throw new Error('Invalid expected media size')
  if (!response.ok) throw new Error('Media HTTP ' + response.status)
  const mime = (response.headers.get('content-type') || 'application/octet-stream')
    .split(';', 1)[0]!.trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml')
    throw new Error('HTML returned instead of media')
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader !== null && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > maxBytes)
    throw new Error('Media exceeds size limit')
  if (!response.body) throw new Error('Missing media stream')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0, complete = false
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) {complete = true; break}
      size += value.byteLength
      if (size > maxBytes) throw new Error('Media exceeds size limit')
      chunks.push(value)
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  if (!size || (expectedBytes !== null && size !== expectedBytes))
    throw new Error('Invalid original media size')
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength}
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const sha256 = Array.from(digest, x => x.toString(16).padStart(2, '0')).join('')
  return {bytes, size, sha256, mime}
}
