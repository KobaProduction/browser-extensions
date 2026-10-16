/** Streaming POSIX ustar writer and strict reader. A TAR contains ordinary files, never nested archives. */
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const BLOCK = 512
const MAX_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_NAME_BYTES = 100
const allowedName = (name: string): boolean =>
  /^[a-z][a-z0-9_./-]*$/.test(name) &&
  !name.includes('..') &&
  !name.includes('//') &&
  !name.startsWith('/') &&
  encoder.encode(name).length <= MAX_NAME_BYTES

function octal(buffer: Uint8Array, start: number, size: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value.toString(8).length >= size)
    throw Error('TAR numeric field exceeds ustar limits')
  const valueBytes = encoder.encode(value.toString(8).padStart(size - 1, '0'))
  buffer.set(valueBytes, start)
  buffer[start + size - 1] = 0
}
function parseOctal(bytes: Uint8Array): number {
  const value = decoder.decode(bytes).replace(/\0.*$/s, '').trim()
  if (!/^[0-7]+$/.test(value)) throw Error('Invalid TAR octal field')
  const number = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(number) || number < 0) throw Error('Invalid TAR numeric value')
  return number
}
function header(name: string, length: number): Uint8Array<ArrayBuffer> {
  if (!allowedName(name) || length > MAX_ENTRY_BYTES || length < 0)
    throw Error('Invalid TAR file path or excessive single entry')
  const bytes = new Uint8Array(BLOCK)
  bytes.set(encoder.encode(name), 0)
  octal(bytes, 100, 8, 0o600)
  octal(bytes, 108, 8, 0)
  octal(bytes, 116, 8, 0)
  octal(bytes, 124, 12, length)
  octal(bytes, 136, 12, Math.floor(Date.now() / 1000))
  bytes.fill(32, 148, 156)
  bytes[156] = 48 // ordinary file
  bytes.set(encoder.encode('ustar\0'), 257)
  bytes.set(encoder.encode('00'), 263)
  octal(
    bytes,
    148,
    8,
    bytes.reduce((sum, n) => sum + n, 0),
  )
  return bytes
}
export interface TarEntry {
  readonly name: string
  readonly bytes: Uint8Array<ArrayBuffer>
}
export class TarStreamWriter {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array<ArrayBuffer>>
  private readonly names = new Set<string>()
  private closed = false
  constructor(sink: WritableStream<Uint8Array<ArrayBuffer>>) {
    this.writer = sink.getWriter()
  }
  async add(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (this.closed || this.names.has(name)) throw Error('TAR closed or duplicate file')
    this.names.add(name)
    await this.writer.write(header(name, bytes.length))
    await this.writer.write(bytes)
    const pad = (BLOCK - (bytes.length % BLOCK)) % BLOCK
    if (pad) await this.writer.write(new Uint8Array(pad))
  }
  async finish(): Promise<void> {
    if (this.closed) throw Error('TAR writer already finished')
    this.closed = true
    try {
      await this.writer.write(new Uint8Array(BLOCK * 2))
      await this.writer.close()
    } finally {
      this.writer.releaseLock()
    }
  }
  async abort(error: unknown): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      await this.writer.abort(error)
    } finally {
      this.writer.releaseLock()
    }
  }
}

class StreamCursor {
  private pending = new Uint8Array(0)
  private readonly reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>
  private readonly onAbort = () => {
    void this.reader.cancel(this.signal?.reason).catch(() => undefined)
  }
  constructor(
    stream: ReadableStream<Uint8Array<ArrayBuffer>>,
    private readonly signal?: AbortSignal,
  ) {
    signal?.throwIfAborted()
    this.reader = stream.getReader()
    signal?.addEventListener('abort', this.onAbort, { once: true })
  }
  async take(size: number): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ENTRY_BYTES + BLOCK)
      throw Error('TAR bounded reader refuses excessive entry')
    const output = new Uint8Array(size)
    let at = 0
    while (at < size) {
      this.signal?.throwIfAborted()
      if (!this.pending.length) {
        const next = await this.reader.read()
        this.signal?.throwIfAborted()
        if (next.done) throw Error('Unexpected end of TAR stream')
        this.pending = next.value
      }
      const n = Math.min(size - at, this.pending.length)
      output.set(this.pending.subarray(0, n), at)
      at += n
      this.pending = this.pending.subarray(n)
    }
    return output
  }
  async eof(): Promise<boolean> {
    let trailing = 0
    while (true) {
      this.signal?.throwIfAborted()
      trailing += this.pending.byteLength
      if (trailing > 1024 * 1024) throw Error('Excessive TAR zero padding')
      if (this.pending.some((b) => b !== 0)) return false
      const next = await this.reader.read()
      this.signal?.throwIfAborted()
      if (next.done) return true
      this.pending = next.value
    }
  }
  async close() {
    this.signal?.removeEventListener('abort', this.onAbort)
    await this.reader.cancel().catch(() => undefined)
    this.reader.releaseLock()
  }
}
export async function* readTarEntries(
  input: ReadableStream<Uint8Array<ArrayBuffer>>,
  options: { readonly signal?: AbortSignal } = {},
): AsyncGenerator<TarEntry> {
  const cursor = new StreamCursor(input, options.signal)
  const seen = new Set<string>()
  try {
    while (true) {
      const bytes = await cursor.take(BLOCK)
      if (bytes.every((n) => n === 0)) {
        if (!(await cursor.take(BLOCK)).every((n) => n === 0) || !(await cursor.eof()))
          throw Error('Unexpected data after TAR terminator')
        return
      }
      const provided = parseOctal(bytes.subarray(148, 156))
      let sum = 0
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (bytes[i] ?? 0)
      if (
        provided !== sum ||
        decoder.decode(bytes.subarray(257, 263)) !== 'ustar\0' ||
        bytes[156] !== 48
      )
        throw Error('Invalid TAR header or unsupported entry type')
      const end = bytes.indexOf(0)
      if (end < 1 || end > MAX_NAME_BYTES) throw Error('TAR missing filename')
      const name = decoder.decode(bytes.subarray(0, end))
      if (!allowedName(name) || seen.has(name)) throw Error('Unsafe or repeated TAR path')
      seen.add(name)
      const length = parseOctal(bytes.subarray(124, 136))
      if (length > MAX_ENTRY_BYTES) throw Error('TAR chunk exceeds memory bound')
      const data = await cursor.take(length)
      const pad = (BLOCK - (length % BLOCK)) % BLOCK
      if (pad && !(await cursor.take(pad)).every((n) => n === 0)) throw Error('Nonzero TAR padding')
      yield { name, bytes: data }
    }
  } finally {
    await cursor.close()
  }
}

/** Standard gzip stream: repeated API keys and values are compressed across all file boundaries. */
export function gzipTarInput(blob: Blob): ReadableStream<Uint8Array<ArrayBuffer>> {
  return blob.stream().pipeThrough(new DecompressionStream('gzip'))
}
