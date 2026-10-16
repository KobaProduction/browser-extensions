import { archiveRecordAttachments } from '@chatgpt-booster/chatgpt'
import {
  type ArchiveExportFormatDescriptor,
  type ArchiveExportOptions,
  type ArchiveItemView,
  type ArchiveThreadView,
  serverTimeMs,
} from '@chatgpt-booster/core'
import {
  type ArchiveExportInput,
  type ArchiveMessageV1,
  type ArchiveReadableRecord,
  type ChunkedArchiveExport,
  serializeArchiveExportChunks as serializeSharedChunks,
  serializeArchiveExport as serializeSharedExport,
} from '@kobaproduction/browser-archive'
import { isLosslessJsonSource, type PreparedArchiveOriginal } from './archive-export-source'
import { type ChatGptSourceContext, projectChatGptSourceContext } from './archive-source-snapshot'

export interface ArchiveExportRecord {
  id: string
  kind: ArchiveItemView['kind']
  role: string | null
  createdAt: string | null
  text: string
  attachments: ReturnType<typeof archiveRecordAttachments>
  status?: string | null
  recipient?: string | null
  model?: string | null
  parentId?: string | null
  turnExchangeId?: string | null
  originalRecord?: unknown
  originalRecordEncoding?: 'archive-clone-v1'
  context?: ChatGptSourceContext
  normalized?: ArchiveMessageV1
}

export interface ArchiveExportTurn {
  id: string
  association: ArchiveThreadView['turns'][number]['association']
  messages: ArchiveExportRecord[]
  details: ArchiveExportRecord[]
}

export interface ArchiveExportDocument {
  schema: 'chatgpt-booster.export.v1'
  exportedAt: string
  conversation: {
    conversationId: string
    title: string | null
    projectId: string | null
  }
  selection: ArchiveExportOptions
  coverage: unknown
  binaryAttachmentsIncluded: false
  turns: ArchiveExportTurn[]
}

export interface ArchiveSerializedExport {
  text: string
  mime: string
  extension: string
}

export interface ArchiveExportFormatProvider {
  descriptor: Omit<ArchiveExportFormatDescriptor, 'isDefault'>
  serialize(document: ArchiveExportDocument): ArchiveSerializedExport
  /** Optional for external formats; built-ins avoid a whole-output string. */
  serializeChunks?(document: ArchiveExportDocument): ChunkedArchiveExport
}

export function exportIncludes(item: ArchiveItemView, options: ArchiveExportOptions): boolean {
  if (item.kind === 'user' || item.kind === 'answer') return true
  if (options.level === 'full') return true
  if (options.level === 'conversation') return false
  if (item.kind === 'reasoning') return options.reasoning
  if (item.kind === 'tool_call' || item.kind === 'tool_result') return options.tools
  return options.internal
}

function projectItem(
  item: ArchiveItemView,
  options: ArchiveExportOptions,
  originals?: ReadonlyMap<string, PreparedArchiveOriginal>,
): ArchiveExportRecord {
  const record = item.record
  const original = originals?.get(record.messageId)
  if (options.level === 'full' && !original && !isLosslessJsonSource(record.raw))
    throw Error('Lossless source codec preparation required')
  return {
    ...(record.normalized ? { normalized: record.normalized } : {}),
    id: record.messageId,
    kind: item.kind,
    role: record.role,
    createdAt:
      record.createTime === null ? null : new Date(serverTimeMs(record.createTime)).toISOString(),
    text: item.text,
    attachments: archiveRecordAttachments(record),
    ...(options.level === 'custom' || options.level === 'full'
      ? {
          status: record.status,
          recipient: record.recipient,
          model: record.modelSlug,
          parentId: record.parentId,
          turnExchangeId: record.turnExchangeId,
          context: projectChatGptSourceContext(record.raw),
          ...(options.level === 'full'
            ? {
                originalRecord: original ? original.value : record.raw,
                ...(original?.encoding ? { originalRecordEncoding: original.encoding } : {}),
              }
            : {}),
        }
      : {}),
  }
}

export function createArchiveExportDocument(
  conversation: { conversationId: string; title: string | null; projectId: string | null },
  thread: ArchiveThreadView,
  options: ArchiveExportOptions,
  evidence: unknown,
  originals?: ReadonlyMap<string, PreparedArchiveOriginal>,
): ArchiveExportDocument {
  const turns = thread.turns
    .map((turn) => ({
      id: turn.id,
      association: turn.association,
      messages: turn.messages
        .filter((item) => exportIncludes(item, options))
        .map((item) => projectItem(item, options, originals)),
      details: turn.details
        .filter((item) => exportIncludes(item, options))
        .map((item) => projectItem(item, options, originals)),
    }))
    .filter((turn) => turn.messages.length || turn.details.length)

  return {
    schema: 'chatgpt-booster.export.v1',
    exportedAt: new Date().toISOString(),
    conversation: {
      conversationId: conversation.conversationId,
      title: conversation.title,
      projectId: conversation.projectId,
    },
    selection: { ...options },
    coverage: evidence,
    binaryAttachmentsIncluded: false,
    turns,
  }
}

const jsonFormat: ArchiveExportFormatProvider = {
  descriptor: {
    id: 'json',
    label: 'JSON',
    mimeType: 'application/json',
    fileExtension: 'json',
  },
  serialize(document) {
    return serializeSharedExport('json', { document, title: '', records: [] })
  },
  serializeChunks: (document) => serializeSharedChunks('json', { document, title: '', records: [] }),
}

function exportEntries(turn: ArchiveExportTurn): ArchiveExportRecord[] {
  return [
    ...turn.messages.filter((message) => message.kind === 'user'),
    ...turn.details,
    ...turn.messages.filter((message) => message.kind !== 'user'),
  ]
}

function readableKind(kind: ArchiveExportRecord['kind']): string {
  if (kind === 'user') return 'User'
  if (kind === 'answer') return 'Assistant'
  return kind
}

function readableMessageText(message: ArchiveExportRecord): string {
  const assets = new Set(message.attachments.map((item) => item.assetId))
  return message.text
    .split(/\r?\n/)
    .filter((line) => {
      const pointer = line.trim().match(/^\[[^\]]+\]\s+(?:sediment:\/\/)?(file_[\w-]+)$/)
      return !pointer || !assets.has(pointer[1] ?? '')
    })
    .join('\n')
    .trim()
}

function readableExportInput(document: ArchiveExportDocument): ArchiveExportInput {
  return {
    document,
    title: document.conversation.title ?? 'Untitled',
    includeOriginal: document.selection.level === 'full',
    records: (function* (): Generator<ArchiveReadableRecord> {
      for (const turn of document.turns)
        for (const message of exportEntries(turn))
          yield {
            heading: readableKind(message.kind),
            headingLevel: message.kind === 'user' || message.kind === 'answer' ? 2 : 3,
            text: readableMessageText(message),
            attachments: message.attachments.map((attachment) => ({
              name: attachment.fileName || 'File',
              mime: attachment.mimeType,
            })),
            ...(message.originalRecord !== undefined
              ? {
                  original: message.originalRecordEncoding
                    ? { encoding: message.originalRecordEncoding, value: message.originalRecord }
                    : message.originalRecord,
                }
              : {}),
          }
    })(),
  }
}

const markdownFormat: ArchiveExportFormatProvider = {
  descriptor: {
    id: 'markdown',
    label: 'Markdown · readable',
    mimeType: 'text/markdown',
    fileExtension: 'md',
  },
  serialize(document) {
    return serializeSharedExport('markdown', readableExportInput(document))
  },
  serializeChunks: (document) => serializeSharedChunks('markdown', readableExportInput(document)),
}

const textFormat: ArchiveExportFormatProvider = {
  descriptor: {
    id: 'text',
    label: 'Plain text · readable',
    mimeType: 'text/plain',
    fileExtension: 'txt',
  },
  serialize(document) {
    return serializeSharedExport('text', readableExportInput(document))
  },
  serializeChunks: (document) => serializeSharedChunks('text', readableExportInput(document)),
}

export const BUILTIN_ARCHIVE_EXPORT_FORMATS: readonly ArchiveExportFormatProvider[] = [
  markdownFormat,
  textFormat,
  jsonFormat,
]

export class ArchiveExportPipeline {
  readonly #providers: Map<string, ArchiveExportFormatProvider>
  readonly #defaultFormatId: string

  constructor(
    providers: readonly ArchiveExportFormatProvider[] = BUILTIN_ARCHIVE_EXPORT_FORMATS,
    defaultFormatId = 'json',
  ) {
    if (!providers.length) throw new Error('Archive export pipeline requires at least one format')
    this.#providers = new Map()
    for (const provider of providers) {
      const id = provider.descriptor.id.trim()
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id))
        throw new Error(`Invalid archive export format id: ${id}`)
      if (this.#providers.has(id)) throw new Error(`Duplicate archive export format id: ${id}`)
      this.#providers.set(id, provider)
    }
    this.#defaultFormatId = this.#providers.has(defaultFormatId)
      ? defaultFormatId
      : (this.#providers.keys().next().value ?? '')
  }

  listFormats(): ArchiveExportFormatDescriptor[] {
    return [...this.#providers.values()].map((provider) => ({
      ...provider.descriptor,
      isDefault: provider.descriptor.id === this.#defaultFormatId,
    }))
  }

  resolveFormatId(formatId: string): string {
    return this.#providers.has(formatId) ? formatId : this.#defaultFormatId
  }

  serialize(
    conversation: { conversationId: string; title: string | null; projectId: string | null },
    thread: ArchiveThreadView,
    options: ArchiveExportOptions,
    evidence: unknown,
    originals?: ReadonlyMap<string, PreparedArchiveOriginal>,
  ): ArchiveSerializedExport {
    const format = this.resolveFormatId(options.format)
    const provider = this.#providers.get(format)
    if (!provider) throw new Error('Archive export pipeline has no default format')
    const resolvedOptions = format === options.format ? options : { ...options, format }
    return provider.serialize(
      createArchiveExportDocument(conversation, thread, resolvedOptions, evidence, originals),
    )
  }

  serializeChunks(
    conversation: { conversationId: string; title: string | null; projectId: string | null },
    thread: ArchiveThreadView,
    options: ArchiveExportOptions,
    evidence: unknown,
    originals?: ReadonlyMap<string, PreparedArchiveOriginal>,
  ): ChunkedArchiveExport {
    const format = this.resolveFormatId(options.format),
      provider = this.#providers.get(format)
    if (!provider) throw Error('Archive export pipeline has no default format')
    const document = createArchiveExportDocument(
      conversation,
      thread,
      format === options.format ? options : { ...options, format },
      evidence,
      originals,
    )
    if (provider.serializeChunks) return provider.serializeChunks(document)
    const serialized = provider.serialize(document)
    return { mime: serialized.mime, extension: serialized.extension, chunks: [serialized.text] }
  }
}

export function createArchiveExportPipeline(
  additionalProviders: readonly ArchiveExportFormatProvider[] = [],
  defaultFormatId = 'json',
): ArchiveExportPipeline {
  return new ArchiveExportPipeline(
    [...BUILTIN_ARCHIVE_EXPORT_FORMATS, ...additionalProviders],
    defaultFormatId,
  )
}

export const DEFAULT_ARCHIVE_EXPORT_PIPELINE = createArchiveExportPipeline()

export function serializeArchiveExport(
  conversation: { conversationId: string; title: string | null; projectId: string | null },
  thread: ArchiveThreadView,
  options: ArchiveExportOptions,
  evidence: unknown,
): ArchiveSerializedExport {
  return DEFAULT_ARCHIVE_EXPORT_PIPELINE.serialize(conversation, thread, options, evidence)
}
