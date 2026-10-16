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
export function safeArchiveExportLink(value: string): string | null {
  if (!value || /[\p{Cc}]/u.test(value) || value.trim() !== value) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      const url = new URL(value)
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
        ? url.href.replace(
            /[()<>]/g,
            (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
          )
        : null
    } catch {
      return null
    }
  }
  if (/^[\\/]|[\\?#:]/.test(value)) return null
  try {
    const parts = value.split('/').map(decodeURIComponent)
    if (parts.some((part) => !part || part === '.' || part === '..' || /[\\/:\p{Cc}]/u.test(part)))
      return null
    return parts.map(encodeURIComponent).join('/')
  } catch {
    return null
  }
}
function markdownLabel(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\\[\]`*_<>]/g, '\\$&')
}

/** Pretty JSON without a second whole-document string. Source-native values
 * must already use the provider's lossless codec, just like ordinary export. */
function* jsonParts(value: unknown, depth = 0, ancestors = new Set<object>()): Generator<string> {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    yield JSON.stringify(value)
    return
  }
  if (!value || typeof value !== 'object' || ancestors.has(value))
    throw Error('Archive export requires a JSON source codec')
  const array = Array.isArray(value)
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw Error('Archive export requires a JSON source codec')
  const keys = array
    ? null
    : Object.keys(value).filter((key) => {
        const field = Object.getOwnPropertyDescriptor(value, key)
        if (!field || !('value' in field)) throw Error('Archive export cannot serialize accessors')
        return !['undefined', 'function', 'symbol'].includes(typeof field.value)
      })
  const length = array ? value.length : (keys?.length ?? 0)
  ancestors.add(value)
  try {
    yield array ? '[' : '{'
    for (let index = 0; index < length; index++) {
      const key = keys ? (keys[index] ?? '') : String(index)
      yield `${index ? ',\n' : '\n'}${'  '.repeat(depth + 1)}`
      if (!array) yield `${JSON.stringify(key)}: `
      const field = Object.getOwnPropertyDescriptor(value, key)
      if (field && !('value' in field)) throw Error('Archive export cannot serialize accessors')
      const item: unknown = field?.value
      if (array && ['undefined', 'function', 'symbol'].includes(typeof item)) yield 'null'
      else yield* jsonParts(item, depth + 1, ancestors)
    }
    if (length) yield `\n${'  '.repeat(depth)}`
    yield array ? ']' : '}'
  } finally {
    ancestors.delete(value)
  }
}

function* coalesce(parts: Iterable<string>): Generator<string> {
  let buffered: string[] = [],
    size = 0
  for (const part of parts) {
    buffered.push(part)
    size += part.length
    if (size >= 64 * 1024) {
      yield buffered.join('')
      buffered = []
      size = 0
    }
  }
  if (buffered.length) yield buffered.join('')
}

/** Provider-neutral chunk formatter. Chunks end on string boundaries so an
 * astral character is never split across independent UTF-8 encoders. */
export function serializeArchiveExportChunks(
  format: SharedArchiveExportFormat,
  input: ArchiveExportInput,
): ChunkedArchiveExport {
  if (format === 'json')
    return { chunks: coalesce(jsonParts(input.document)), mime: 'application/json', extension: 'json' }
  if (format !== 'markdown' && format !== 'text') throw Error('Unknown archive export format')
  const markdown = format === 'markdown'
  function* readable(): Generator<string> {
    let started = input.includeTitle !== false
    if (started) yield (markdown ? '# ' : '') + input.title.replace(/[\r\n]+/g, ' ')
    for (const record of input.records) {
      if (started) yield '\n\n'
      started = true
      const heading = record.heading.replace(/[\r\n]+/g, ' ')
      const lines = [markdown ? `${'#'.repeat(record.headingLevel ?? 2)} ${heading}` : `${heading}:`, '']
      if (record.text.trim()) lines.push(record.text.trim(), '')
      if (record.attachments?.length)
        lines.push(
          'Attachments:',
          ...record.attachments.map((item) => {
            const url = item.url ? safeArchiveExportLink(item.url) : null
            const name = markdown ? markdownLabel(item.name) : item.name.replace(/[\r\n]+/g, ' ')
            return (
              '- ' +
              (url ? (markdown ? `[${name}](<${url}>)` : `${name}: ${url}`) : name) +
              (item.mime ? ` (${item.mime.replace(/[\r\n]+/g, ' ')})` : '') +
              (item.status ? ` [${item.status.replace(/[\r\n]+/g, ' ')}]` : '')
            )
          }),
          '',
        )
      if (input.includeOriginal && record.original !== undefined) {
        const body = JSON.stringify(record.original, null, 2)
        if (body === undefined) throw Error('Original archive record requires a JSON codec')
        if (markdown) {
          let fenceSize = 3
          for (const run of body.matchAll(/`+/g)) fenceSize = Math.max(fenceSize, run[0].length + 1)
          const fence = '`'.repeat(fenceSize)
          lines.push('Original record:', '', `${fence}json`, body, fence, '')
        } else lines.push(body, '')
      }
      yield lines.join('\n').trimEnd()
    }
    yield '\n'
  }
  return {
    chunks: coalesce(readable()),
    mime: markdown ? 'text/markdown' : 'text/plain',
    extension: markdown ? 'md' : 'txt',
  }
}

/** Existing small-document API; large consumers drain the shared chunks. */
export function serializeArchiveExport(
  format: SharedArchiveExportFormat,
  input: ArchiveExportInput,
): SerializedArchiveExport {
  const { chunks, ...metadata } = serializeArchiveExportChunks(format, input)
  return { ...metadata, text: [...chunks].join('') }
}
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
export async function collectArchiveRange<T>(
  records: Iterable<T> | AsyncIterable<T>,
  range: ArchiveRange,
  getId: (record: T) => string,
): Promise<ResolvedArchiveRange<T>> {
  if (!range.firstId || !range.lastId) throw Error('Both archive range endpoints are required')
  const messageIds: string[] = [],
    seen = new Set<string>()
  let first: T | undefined,
    last: T | undefined,
    openingId: string | undefined,
    finished = false
  for await (const record of records) {
    const id = getId(record)
    if (!id) throw Error('Invalid archive range record identity')
    if (openingId === undefined) {
      if (id !== range.firstId && id !== range.lastId) continue
      first = record
      openingId = id
    }
    if (seen.has(id)) throw Error('Duplicate archive range identity')
    seen.add(id)
    messageIds.push(id)
    last = record
    if (
      range.firstId === range.lastId ||
      (id !== openingId && (id === range.firstId || id === range.lastId))
    ) {
      finished = true
      break
    }
  }
  if (!finished || first === undefined || last === undefined)
    throw Error('Archive range endpoint is no longer saved')
  return { messageIds, first, last }
}
