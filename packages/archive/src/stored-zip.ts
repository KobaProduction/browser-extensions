/** Provider-independent ZIP32 archive builder extracted from ChatGPT Booster.
 * Caller supplies validated relative entry paths and any media bytes.
 * This is STORE-only ZIP: the caller must not claim unavailable files exist. */
export interface ZipEntry {
  path: string
  bytes: Uint8Array
}

/** ZIP paths must remain relative to the export root on every extraction target. */
function entryName(path: string): Uint8Array {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
    [...path].some((character) => character.charCodeAt(0) < 32)
  )
    throw Error('Unsafe ZIP entry path')
  return encoder.encode(path)
}

const encoder = new TextEncoder()
let crcTable: Uint32Array | undefined

function table() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    crcTable[index] = value >>> 0
  }
  return crcTable
}

function crc32Update(initial: number, bytes: Uint8Array) {
  let crc = initial
  const values = table()
  for (const byte of bytes) crc = (values[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return crc >>> 0
}

function crc32(bytes: Uint8Array) {
  return (crc32Update(0xffffffff, bytes) ^ 0xffffffff) >>> 0
}

function view(size: number) {
  return new DataView(new ArrayBuffer(size))
}

function bytes(value: DataView) {
  return new Uint8Array(value.buffer)
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

function concat(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

export function createStoredZip(entries: ZipEntry[]): Blob {
  if (entries.length > 0xffff) throw new Error('export.tooManyFiles')
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  const stamp = dosDateTime()
  for (const entry of entries) {
    const name = entryName(entry.path)
    if (name.byteLength > 0xffff || entry.bytes.byteLength > 0xffffffff)
      throw new Error('export.fileTooLarge')
    const crc = crc32(entry.bytes)
    const local = view(30)
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(8, 0, true)
    local.setUint16(10, stamp.time, true)
    local.setUint16(12, stamp.date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, entry.bytes.byteLength, true)
    local.setUint32(22, entry.bytes.byteLength, true)
    local.setUint16(26, name.byteLength, true)
    local.setUint16(28, 0, true)
    const localBytes = concat([bytes(local), name, entry.bytes])
    if (offset + localBytes.byteLength > 0xffffffff) throw new Error('export.packageTooLarge')
    locals.push(localBytes)

    const central = view(46)
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 0, true)
    central.setUint16(12, stamp.time, true)
    central.setUint16(14, stamp.date, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, entry.bytes.byteLength, true)
    central.setUint32(24, entry.bytes.byteLength, true)
    central.setUint16(28, name.byteLength, true)
    central.setUint16(30, 0, true)
    central.setUint16(32, 0, true)
    central.setUint16(34, 0, true)
    central.setUint16(36, 0, true)
    central.setUint32(38, 0, true)
    central.setUint32(42, offset, true)
    centrals.push(concat([bytes(central), name]))
    offset += localBytes.byteLength
  }
  const centralBytes = concat(centrals)
  if (centralBytes.byteLength > 0xffffffff || offset + centralBytes.byteLength > 0xffffffff)
    throw new Error('export.packageTooLarge')
  const end = view(22)
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(4, 0, true)
  end.setUint16(6, 0, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralBytes.byteLength, true)
  end.setUint32(16, offset, true)
  end.setUint16(20, 0, true)
  return new Blob([...locals, centralBytes, bytes(end)].map(asArrayBuffer), {
    type: 'application/zip',
  })
}

/**
 * Store-only ZIP32 for Blob-backed exports. The archive does not need a
 * second full Uint8Array copy of each document; CRC32 is computed over
 * bounded 64 KiB Blob slices. Native-source/path data are still materialized
 * by the caller, so this is not end-to-end streaming export.
 */
/** Lossless gzip container for large source-native JSON without cloning its
 * uncompressed bytes into an additional JavaScript string. The browser stream
 * owns compression; completed buffers are released on cancellation. */

export async function createStoredZipFromBlobs(
  entries: { path: string; blob: Blob }[],
  signal?: AbortSignal,
  onProgress?: (completedBytes: number, totalBytes: number) => void,
): Promise<Blob> {
  if (entries.length > 0xffff) throw new Error('export.tooManyFiles')
  const assertActive = () => {
    if (signal?.aborted) throw new DOMException('ZIP packaging cancelled', 'AbortError')
  }
  const totalBytes = entries.reduce((total, entry) => total + entry.blob.size, 0)
  let completedBytes = 0
  assertActive()
  onProgress?.(0, totalBytes)
  const parts: BlobPart[] = []
  const centrals: Uint8Array[] = []
  const stamp = dosDateTime()
  let offset = 0
  for (const entry of entries) {
    assertActive()
    const name = entryName(entry.path)
    if (name.byteLength > 0xffff || entry.blob.size > 0xffffffff) throw new Error('export.fileTooLarge')
    if (offset + 30 + name.byteLength + entry.blob.size > 0xffffffff)
      throw new Error('export.packageTooLarge')
    let crc = 0xffffffff
    for (let position = 0; position < entry.blob.size; position += 64 * 1024) {
      assertActive()
      const block = new Uint8Array(await entry.blob.slice(position, position + 64 * 1024).arrayBuffer())
      assertActive()
      crc = crc32Update(crc, block)
      completedBytes += block.byteLength
      onProgress?.(completedBytes, totalBytes)
      assertActive()
    }
    assertActive()
    crc = (crc ^ 0xffffffff) >>> 0
    const local = view(30)
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(8, 0, true)
    local.setUint16(10, stamp.time, true)
    local.setUint16(12, stamp.date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, entry.blob.size, true)
    local.setUint32(22, entry.blob.size, true)
    local.setUint16(26, name.byteLength, true)
    local.setUint16(28, 0, true)
    parts.push(asArrayBuffer(bytes(local)), asArrayBuffer(name), entry.blob)

    const central = view(46)
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 0, true) // ZIP method 0 = stored; never encode the DOS time here
    central.setUint16(12, stamp.time, true)
    central.setUint16(14, stamp.date, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, entry.blob.size, true)
    central.setUint32(24, entry.blob.size, true)
    central.setUint16(28, name.byteLength, true)
    central.setUint32(42, offset, true)
    centrals.push(concat([bytes(central), name]))
    offset += 30 + name.byteLength + entry.blob.size
  }
  assertActive()
  const centralBytes = concat(centrals)
  if (offset + centralBytes.byteLength + 22 > 0xffffffff) throw new Error('export.packageTooLarge')
  const end = view(22)
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(4, 0, true)
  end.setUint16(6, 0, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralBytes.byteLength, true)
  end.setUint32(16, offset, true)
  assertActive()
  return new Blob([...parts, asArrayBuffer(centralBytes), asArrayBuffer(bytes(end))], {
    type: 'application/zip',
  })
}
