import type { BackupRow } from '@kobaproduction/browser-core'

export const BACKUP_WIRE_CHUNK = 4 * 1024 * 1024
/** One row is materialized for provider validation; neither parts nor archives
 * are accumulated. This is a transport bound, independent of provider codecs. */
export const MAX_BACKUP_ROW_BYTES = 64 * 1024 * 1024
const FRAGMENT_CHARACTERS = 256 * 1024
const encoder = new TextEncoder()
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const fields = (value: Record<string, unknown>, names: string) =>
  Object.keys(value).sort().join(',') === names
const digest = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

export function assertBackupRow(value: unknown): asserts value is BackupRow {
  if (
    !object(value) ||
    !fields(value, 'key,value') ||
    typeof value.key !== 'string' ||
    !value.key ||
    value.key.length > 2048
  )
    throw Error('Invalid backup row')
}
export function serializedBackupRow(row: BackupRow): { text: string; bytes: number } {
  assertBackupRow(row)
  const text = JSON.stringify(row)
  // Count UTF-8 with bounded allocations, including malformed UTF-16 replacement.
  let bytes = 0
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + FRAGMENT_CHARACTERS)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--
    bytes += encoder.encode(text.slice(start, end)).length
    if (bytes > MAX_BACKUP_ROW_BYTES) throw Error('Backup row exceeds 64 MiB reassembly budget')
    start = end
  }
  const parsed: unknown = JSON.parse(text)
  assertBackupRow(parsed)
  return { text, bytes }
}

/** v2 retains ordinary v1 rows; only oversize rows use authenticated fragments.
 * Each yielded unit fits one TAR part, even with maximal JSON escaping. */
export async function* backupWireLines(row: BackupRow): AsyncGenerator<{ line: string; rows: 0 | 1 }> {
  const { text, bytes } = serializedBackupRow(row)
  if (bytes + 1 <= BACKUP_WIRE_CHUNK) {
    yield { line: `${text}\n`, rows: 1 }
    return
  }
  const fragments = Math.ceil(text.length / FRAGMENT_CHARACTERS)
  let chain = 'koba-backup-fragments-v1'
  for (let index = 0; index < fragments; index++)
    chain = await digest(
      `${chain}:${index}:${await digest(JSON.stringify(text.slice(index * FRAGMENT_CHARACTERS, (index + 1) * FRAGMENT_CHARACTERS)))}`,
    )
  yield {
    line: `${JSON.stringify({ type: 'row-fragments-v1', key: row.key, fragments, characters: text.length, bytes, sha256: chain })}\n`,
    rows: 0,
  }
  for (let index = 0; index < fragments; index++) {
    const payload = text.slice(index * FRAGMENT_CHARACTERS, (index + 1) * FRAGMENT_CHARACTERS)
    yield {
      line: `${JSON.stringify({ type: 'row-fragment-v1', index, payload })}\n`,
      rows: index + 1 === fragments ? 1 : 0,
    }
  }
}

/** One active record, sequential fragments across sequential TAR parts. */
export class BackupFragmentDecoder {
  usedFragments = false
  lastRowBytes = 0
  private active?: {
    section: string
    key: string
    fragments: number
    characters: number
    bytes: number
    sha256: string
    chunks: string[]
    size: number
    utf8Bytes: number
    lastCodeUnit: number
    chain: string
  }
  assertComplete() {
    if (this.active) throw Error('Missing backup row fragment')
  }
  async consume(value: unknown, section: string): Promise<BackupRow | undefined> {
    this.lastRowBytes = 0
    if (object(value) && value.type === 'row-fragments-v1') {
      this.assertComplete()
      if (
        !fields(value, 'bytes,characters,fragments,key,sha256,type') ||
        typeof value.key !== 'string' ||
        !value.key ||
        value.key.length > 2048 ||
        !Number.isSafeInteger(value.fragments) ||
        Number(value.fragments) < 2 ||
        !Number.isSafeInteger(value.characters) ||
        Number(value.characters) <= 0 ||
        Number(value.characters) > MAX_BACKUP_ROW_BYTES ||
        value.fragments !== Math.ceil(Number(value.characters) / FRAGMENT_CHARACTERS) ||
        !Number.isSafeInteger(value.bytes) ||
        Number(value.bytes) < BACKUP_WIRE_CHUNK ||
        Number(value.bytes) > MAX_BACKUP_ROW_BYTES ||
        typeof value.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(value.sha256)
      )
        throw Error('Invalid backup fragment header or reassembly budget')
      this.usedFragments = true
      this.active = {
        section,
        key: value.key,
        fragments: Number(value.fragments),
        characters: Number(value.characters),
        bytes: Number(value.bytes),
        sha256: value.sha256,
        chunks: [],
        size: 0,
        utf8Bytes: 0,
        lastCodeUnit: 0,
        chain: 'koba-backup-fragments-v1',
      }
      return undefined
    }
    if (object(value) && value.type === 'row-fragment-v1') {
      const active = this.active
      if (
        !active ||
        active.section !== section ||
        !fields(value, 'index,payload,type') ||
        value.index !== active.chunks.length ||
        typeof value.payload !== 'string' ||
        value.payload.length !== Math.min(FRAGMENT_CHARACTERS, active.characters - active.size)
      )
        throw Error('Missing, duplicate or unordered backup row fragment')
      let bytes = encoder.encode(value.payload).length
      const first = value.payload.charCodeAt(0)
      // Separate UTF-8 encodes replace split surrogate halves with two U+FFFDs
      // (six bytes); the complete pair is four bytes. Count exact joined UTF-8.
      if (
        active.lastCodeUnit >= 0xd800 &&
        active.lastCodeUnit <= 0xdbff &&
        first >= 0xdc00 &&
        first <= 0xdfff
      )
        bytes -= 2
      if (active.utf8Bytes + bytes > active.bytes || active.utf8Bytes + bytes > MAX_BACKUP_ROW_BYTES)
        throw Error('Backup row fragment exceeds UTF-8 reassembly budget')
      active.utf8Bytes += bytes
      active.lastCodeUnit = value.payload.charCodeAt(value.payload.length - 1)
      active.chain = await digest(
        `${active.chain}:${value.index}:${await digest(JSON.stringify(value.payload))}`,
      )
      active.chunks.push(value.payload)
      active.size += value.payload.length
      if (active.chunks.length < active.fragments) return undefined
      if (active.utf8Bytes !== active.bytes) throw Error('Backup row fragment byte count mismatch')
      const text = active.chunks.join('')
      if (active.size !== active.characters || active.chain !== active.sha256)
        throw Error('Backup row fragment integrity mismatch')
      const parsed: unknown = JSON.parse(text)
      assertBackupRow(parsed)
      if (parsed.key !== active.key || serializedBackupRow(parsed).bytes !== active.bytes)
        throw Error('Backup row fragment identity or byte count mismatch')
      this.lastRowBytes = active.bytes
      this.active = undefined
      return parsed
    }
    this.assertComplete()
    assertBackupRow(value)
    this.lastRowBytes = encoder.encode(JSON.stringify(value)).length
    return value
  }
}
