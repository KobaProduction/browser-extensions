import {
  archiveRecordAttachments,
  archiveRecordKind,
  archiveRecordText,
} from '@chatgpt-booster/chatgpt'
import {
  ArchiveExportBlockedError,
  type ArchiveExportBlocker,
  type ArchiveExportOutcome,
  type ArchiveExportProgress,
  type ArchiveExportProgressListener,
} from '@chatgpt-booster/core'
import { createStoredZipFromBlobs } from './archive-package'
import type {
  ArchiveV4Message,
  ArchiveV4PathIndex,
  ArchiveV4PathResult,
  ArchiveV4PathStatus,
  ArchiveV4SourceRevisionWindow,
  ArchiveV4Store,
  ArchiveV4SubmissionEvidence,
} from './archive-v4-store'
import { normalizeConversationMessage } from './conversation-records'

export const ARCHIVE_V4_EXPORT_SCHEMA = 'chatgpt-booster.export.v2'
export type ArchiveV4ContentMode = 'basic' | 'selective' | 'technical'
export type ArchiveV4OutputFormat = 'json-compact' | 'json-readable' | 'markdown' | 'text'
export interface ArchiveV4ExportRequest {
  accountId: string
  conversationId: string
  selectedTipId: string
  mode: ArchiveV4ContentMode
  format: ArchiveV4OutputFormat
  packaging?: 'none' | 'zip'
  reasoning?: boolean
  tools?: boolean
  internal?: boolean
  reasoningRecap?: boolean
  reasoningFull?: boolean
  toolCalls?: boolean
  toolResults?: boolean
  toolSourceContent?: boolean
  modelEvidence?: boolean
  dictationEditEvidence?: boolean
  sourceRevisions?: boolean
  attachmentMetadata?: boolean
  signal?: AbortSignal
  onProgress?: ArchiveExportProgressListener
  /** Caller-supplied verified owner/context epoch, rechecked at await boundaries. */
  stillAuthorized?: () => boolean
}

function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
}

export interface ArchiveV4ObservedModel {
  messageId: string
  modelSlug: string | null
  resolvedModelSlug: string | null
}

/** Submitted parameters and resolved message metadata retain separate provenance. */
interface SubmittedSelectionPoint {
  messageId: string
  requestedModel: string
  thinkingEffort: string | null
  effortPresent: boolean
  observedAtUtcSeconds: number | null
  source: 'native-composer-submit'
}
interface SubmittedSelectionChange {
  kind: 'submitted_selection_changed'
  before: SubmittedSelectionPoint
  after: SubmittedSelectionPoint
  fields: ('requestedModel' | 'thinkingEffort')[]
  selectorInteraction: 'not_observed'
}

function modelObservationCollector() {
  let previous: { modelSlug: string | null; resolvedModelSlug: string | null } | null = null
  let baseline: ArchiveV4ObservedModel | null = null
  const changedObservedValues: ArchiveV4ObservedModel[] = []
  let requestedBaseline: SubmittedSelectionPoint | null = null
  let previousRequest: SubmittedSelectionPoint | null = null
  let unknownSubmissions = 0
  let conflictingSubmissions = 0
  let observedSubmissions = 0
  const resumedBaselines: SubmittedSelectionPoint[] = []
  const confirmedSubmissionChanges: SubmittedSelectionChange[] = []
  return {
    observeSubmission(messageId: string, evidence: ArchiveV4SubmissionEvidence) {
      if (evidence.status !== 'observed') {
        unknownSubmissions++
        if (evidence.status === 'conflicted') conflictingSubmissions++
        previousRequest = null // A missing observation is a gap, never a model transition.
        return
      }
      const selection = evidence.selection
      if (selection.messageId !== messageId) throw new Error('archive.error.sourceChanged')
      const point: SubmittedSelectionPoint = {
        messageId,
        requestedModel: selection.requestedModel,
        thinkingEffort: selection.thinkingEffort,
        effortPresent: selection.effortPresent,
        observedAtUtcSeconds: compactUtcSeconds(selection.observedAtMs, 'milliseconds'),
        source: 'native-composer-submit',
      }
      observedSubmissions++
      if (!requestedBaseline) requestedBaseline = point
      else if (!previousRequest) resumedBaselines.push(point)
      if (previousRequest) {
        const fields: SubmittedSelectionChange['fields'] = []
        if (previousRequest.requestedModel !== point.requestedModel) fields.push('requestedModel')
        if (
          previousRequest.effortPresent !== point.effortPresent ||
          previousRequest.thinkingEffort !== point.thinkingEffort
        )
          fields.push('thinkingEffort')
        if (fields.length)
          confirmedSubmissionChanges.push({
            kind: 'submitted_selection_changed',
            before: previousRequest,
            after: point,
            fields,
            selectorInteraction: 'not_observed',
          })
      }
      previousRequest = point
    },
    observe(message: { messageId: string; raw: Record<string, unknown> }) {
      const raw = message.raw.metadata
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
      const metadata = raw as Record<string, unknown>
      const modelSlug =
        typeof metadata.model_slug === 'string' && metadata.model_slug ? metadata.model_slug : null
      const resolvedModelSlug =
        typeof metadata.resolved_model_slug === 'string' && metadata.resolved_model_slug
          ? metadata.resolved_model_slug
          : null
      if (!modelSlug && !resolvedModelSlug) return
      if (
        previous &&
        previous.modelSlug === modelSlug &&
        previous.resolvedModelSlug === resolvedModelSlug
      )
        return
      const observation = { messageId: message.messageId, modelSlug, resolvedModelSlug }
      if (!baseline) baseline = observation
      else changedObservedValues.push(observation)
      previous = { modelSlug, resolvedModelSlug }
    },
    result() {
      return {
        baseline,
        changedObservedValues,
        requestedModel: requestedBaseline?.requestedModel ?? null,
        thinkingEffort: requestedBaseline?.thinkingEffort ?? null,
        requestedBaseline,
        resumedBaselines,
        confirmedSubmissionChanges,
        observedSubmissions,
        unknownSubmissions,
        conflictingSubmissions,
        // Composer request differences prove submitted parameters, not a model-picker click.
        userModelSwitchesVerified: false,
      }
    },
  }
}

export function summarizeArchiveV4ModelObservations(
  messages: readonly { messageId: string; raw: Record<string, unknown> }[],
) {
  const collector = modelObservationCollector()
  for (const message of messages) {
    collector.observe(message)
    if (isUserSource(message.raw))
      collector.observeSubmission(message.messageId, { status: 'unobserved', selection: null })
  }
  return collector.result()
}

function isUserSource(raw: Record<string, unknown>): boolean {
  const author = raw.author
  return (
    !!author &&
    typeof author === 'object' &&
    !Array.isArray(author) &&
    (author as Record<string, unknown>).role === 'user'
  )
}

function technicalDocument(
  path: Pick<ArchiveV4PathResult, 'selectedTipId' | 'rootId' | 'coverageReadId'>,
  conversationId: string,
  originals: readonly Record<string, unknown>[],
) {
  return {
    schema: ARCHIVE_V4_EXPORT_SCHEMA,
    mode: 'technical',
    conversationId,
    selectedTipId: path.selectedTipId,
    verifiedRootId: path.rootId,
    sourceReadId: path.coverageReadId,
    sourceOriginals: originals,
    binaryAssetsIncluded: false,
    fidelity: 'parsed JSON objects; not original response bytes',
  }
}

/** Compose an ordinary technical JSON file without allocating one huge output string. */
type TechnicalFileIdentity = Pick<
  ArchiveV4PathIndex,
  'status' | 'rootId' | 'selectedTipId' | 'coverageReadId' | 'conversationRevision'
>
type TechnicalFormatSelection = Pick<
  ArchiveV4ExportRequest,
  'conversationId' | 'selectedTipId' | 'format'
>

/** Shared serializer preserves the existing exact compact/readable JSON contract. */
function technicalBlobWriter(path: TechnicalFileIdentity, request: TechnicalFormatSelection) {
  if (
    path.status !== 'verified' ||
    !path.rootId ||
    path.conversationRevision === null ||
    path.selectedTipId !== request.selectedTipId
  )
    throw new Error('archive.error.unverifiedPath')
  if (request.format !== 'json-compact' && request.format !== 'json-readable')
    throw new Error('archive.error.technicalRequiresJson')
  const pretty = request.format === 'json-readable'
  const skeleton = JSON.stringify(
    technicalDocument(path, request.conversationId, []),
    null,
    pretty ? 2 : undefined,
  )
  const property = skeleton.indexOf('"sourceOriginals"')
  const listStart = skeleton.indexOf('[]', property)
  if (property < 0 || listStart < 0) throw new Error('Archive v4 technical schema mismatch')
  const parts: BlobPart[] = [skeleton.slice(0, listStart), '[']
  let buffer = ''
  return {
    push(raw: Record<string, unknown>, index: number) {
      const original = JSON.stringify(raw, null, pretty ? 2 : undefined)
      if (original === undefined) throw new Error('Archive v4 source is not JSON serializable')
      if (pretty) buffer += `${index === 0 ? '' : ','}\n    ${original.replace(/\n/g, '\n    ')}`
      else buffer += `${index === 0 ? '' : ','}${original}`
      if ((index + 1) % 128 === 0) {
        parts.push(buffer)
        buffer = ''
      }
    },
    finish() {
      if (buffer) parts.push(buffer)
      parts.push(pretty ? '\n  ]' : ']', skeleton.slice(listStart + 2))
      return new Blob(parts, { type: 'application/json;charset=utf-8' })
    },
  }
}

/** Two-pass technical export reads just one source-original record at a time. */
export async function createArchiveV4TechnicalBlobFromIndex(
  path: ArchiveV4PathIndex,
  request: TechnicalFormatSelection,
  lookup: (messageId: string) => Promise<ArchiveV4Message | undefined>,
  assertActive: () => void = () => undefined,
  onRecord?: (records: number) => void,
): Promise<Blob> {
  if (!path.messageIds.length) throw new Error('archive.error.unverifiedPath')
  const writer = technicalBlobWriter(path, request)
  for (let i = 0; i < path.messageIds.length; i++) {
    assertActive()
    const messageId = path.messageIds[i]
    if (!messageId) throw new Error('archive.error.sourceChanged')
    const record = await lookup(messageId)
    assertActive()
    if (!record || record.messageId !== messageId) throw new Error('archive.error.sourceChanged')
    writer.push(record.raw, i)
    onRecord?.(i + 1)
    assertActive()
  }
  assertActive()
  return writer.finish()
}

export function createArchiveV4TechnicalBlob(
  path: ArchiveV4PathResult,
  request: Pick<ArchiveV4ExportRequest, 'conversationId' | 'selectedTipId' | 'format'>,
  assertActive: () => void = () => undefined,
): Blob {
  if (
    path.status !== 'verified' ||
    !path.rootId ||
    !path.messages.length ||
    path.conversationRevision === null ||
    path.selectedTipId !== request.selectedTipId
  )
    throw new Error('archive.error.unverifiedPath')
  const writer = technicalBlobWriter(path, request)
  for (let i = 0; i < path.messages.length; i++) {
    assertActive()
    const message = path.messages[i]
    if (!message) throw new Error('archive.error.sourceChanged')
    writer.push(message.raw, i)
  }
  assertActive()
  return writer.finish()
}

/** Explicit unit conversion only: a timestamp's magnitude never chooses its timebase. */
function compactUtcSeconds(value: unknown, unit: 'seconds' | 'milliseconds'): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const seconds = Math.floor(unit === 'milliseconds' ? value / 1000 : value)
  return Number.isSafeInteger(seconds) ? seconds : null
}

function projectArchiveV4CompactEntry(
  message: ArchiveV4Message,
  request: Pick<
    ArchiveV4ExportRequest,
    | 'conversationId'
    | 'mode'
    | 'format'
    | 'reasoning'
    | 'tools'
    | 'internal'
    | 'reasoningRecap'
    | 'reasoningFull'
    | 'toolCalls'
    | 'toolResults'
    | 'toolSourceContent'
    | 'dictationEditEvidence'
    | 'attachmentMetadata'
  >,
) {
  const normalized = normalizeConversationMessage(
    message.raw,
    request.conversationId,
    null,
    message.lastSeenAt,
  )
  if (!normalized) throw new Error('archive.error.incompatibleSource')
  const kind = archiveRecordKind(normalized)
  const visible = kind === 'user' || kind === 'answer'
  const isRecap = normalized.contentType === 'reasoning_recap'
  const include =
    visible ||
    (request.mode === 'selective' &&
      ((kind === 'reasoning' &&
        request.reasoning === true &&
        (isRecap ? request.reasoningRecap !== false : request.reasoningFull !== false)) ||
        (kind === 'tool_call' && request.tools === true && request.toolCalls !== false) ||
        (kind === 'tool_result' && request.tools === true && request.toolResults !== false) ||
        (kind === 'internal' && request.internal === true)))
  if (!include) return []
  const sourceMetadata = message.raw.metadata
  const metadata =
    sourceMetadata && typeof sourceMetadata === 'object' && !Array.isArray(sourceMetadata)
      ? (sourceMetadata as Record<string, unknown>)
      : null
  const nativeToolContent =
    (kind === 'tool_call' || kind === 'tool_result') &&
    request.mode === 'selective' &&
    request.toolSourceContent === true &&
    (request.format === 'json-compact' || request.format === 'json-readable')
      ? message.raw.content
      : undefined
  const explicitDictationEdit =
    request.mode === 'selective' &&
    request.dictationEditEvidence === true &&
    metadata?.dictation_edited === true
  const attachments =
    request.mode === 'selective' && request.attachmentMetadata === true
      ? archiveRecordAttachments(normalized)
      : []
  const time = message.raw.create_time
  return [
    {
      messageId: message.messageId,
      kind,
      role: normalized.role,
      timestampUtcSeconds: compactUtcSeconds(time, 'seconds'),
      text: archiveRecordText(normalized),
      ...(request.mode === 'selective'
        ? { channel: normalized.channel, recipient: normalized.recipient }
        : {}),
      ...(nativeToolContent !== undefined
        ? {
            sourceToolContent: nativeToolContent,
            sourceToolContentFidelity:
              'parsed native content object; not a reconstructed invocation',
          }
        : {}),
      ...(explicitDictationEdit
        ? {
            sourceEditEvidence: { kind: 'dictation_edited', path: 'metadata.dictation_edited' },
          }
        : {}),
      ...(attachments.length
        ? {
            attachmentDescriptors: attachments,
            attachmentBytesIncluded: false,
          }
        : {}),
    },
  ]
}

interface SourceRevisionProjection {
  previous: {
    previousRevision: number
    previousLastSeenUtcSeconds: number | null
    sourceReadId: string | null
    sourceReadStartedUtcSeconds: number | null
  }[]
  olderRevisionsOmitted: boolean
  currentRevision: number
  changeActor: 'not_observed'
}

function projectRevisionEvidence(
  source: ArchiveV4SourceRevisionWindow,
  currentRevision: number,
): SourceRevisionProjection {
  return {
    previous: source.previous.map((item) => ({
      previousRevision: item.previousRevision,
      previousLastSeenUtcSeconds: compactUtcSeconds(item.previousLastSeenAtMs, 'milliseconds'),
      sourceReadId: item.sourceReadId,
      sourceReadStartedUtcSeconds: compactUtcSeconds(item.sourceReadStartedAtMs, 'milliseconds'),
    })),
    olderRevisionsOmitted: source.olderRevisionsOmitted,
    currentRevision,
    changeActor: 'not_observed',
  }
}
type CompactEntry = NonNullable<ReturnType<typeof projectArchiveV4CompactEntry>>[number] & {
  sourceRevisionEvidence?: SourceRevisionProjection
}
type ModelEvidence = ReturnType<typeof summarizeArchiveV4ModelObservations>

/** Report explicit source-only edit evidence, never infer a human edit from timestamps. */
function humanArchiveV4Entry(entry: CompactEntry, markdown: boolean): string {
  const title = `${markdown ? '## ' : ''}${entry.role ?? entry.kind}`
  const edited =
    'sourceEditEvidence' in entry && entry.sourceEditEvidence
      ? '\n[Source evidence: metadata.dictation_edited = true; no general user edit verified]'
      : ''
  const revisions = entry.sourceRevisionEvidence
  const replacementSummary =
    revisions && (revisions.previous.length || revisions.olderRevisionsOmitted)
      ? `\n[Observed source replacements: previous revisions ${revisions.previous.map((item) => item.previousRevision).join(', ') || 'unavailable'}${revisions.olderRevisionsOmitted ? ', earlier revisions omitted' : ''}; not proof of a user edit]`
      : ''
  const attachments =
    'attachmentDescriptors' in entry && entry.attachmentDescriptors?.length
      ? `\n[Attachment metadata: ${entry.attachmentDescriptors.length} descriptor(s); binary files not included]`
      : ''
  return `${title}\n${entry.text}${edited}${replacementSummary}${attachments}`
}

function humanModelEvidence(evidence: ModelEvidence, markdown: boolean): string {
  if (!evidence.baseline && !evidence.requestedBaseline && !evidence.unknownSubmissions) return ''
  const lines = [
    markdown
      ? '## Observed model metadata (not user changes) and submitted-selection evidence'
      : 'Observed model metadata (not user changes) and submitted-selection evidence',
  ]
  if (evidence.baseline) {
    for (const value of [evidence.baseline, ...evidence.changedObservedValues])
      lines.push(
        `${value.messageId}: model_slug=${value.modelSlug ?? 'unknown'}, resolved_model_slug=${value.resolvedModelSlug ?? 'unknown'}`,
      )
  }
  const describe = (value: SubmittedSelectionPoint) =>
    `${value.messageId}: requested_model=${value.requestedModel}, thinking_effort=${value.effortPresent ? value.thinkingEffort : 'not sent'}`
  if (evidence.requestedBaseline)
    lines.push(`First observed submission: ${describe(evidence.requestedBaseline)}`)
  for (const value of evidence.resumedBaselines)
    lines.push(`Observation resumes after a gap: ${describe(value)}`)
  for (const change of evidence.confirmedSubmissionChanges)
    lines.push(
      `Submitted selection changed (${change.fields.join(', ')}): ${describe(change.before)} -> ${describe(change.after)}`,
    )
  if (evidence.unknownSubmissions)
    lines.push(
      `Requests without usable selection evidence: ${evidence.unknownSubmissions}; conflicting: ${evidence.conflictingSubmissions}. No transition is inferred across these gaps.`,
    )
  lines.push(
    'Submitted parameters are not proof of selector interaction; thinking effort: not verified when absent. Missing effort is not an inferred default or disabled state.',
  )
  return lines.join('\n')
}

function serializeArchiveV4CompactEntries(
  path: Pick<ArchiveV4PathResult, 'selectedTipId' | 'rootId' | 'coverageReadId'>,
  request: Pick<ArchiveV4ExportRequest, 'conversationId' | 'mode' | 'format' | 'modelEvidence'>,
  entries: CompactEntry[],
  modelEvidence: ModelEvidence,
): { text: string; mime: string; extension: string } {
  if (request.format === 'markdown' || request.format === 'text') {
    const markdown = request.format === 'markdown'
    const lines = entries.flatMap((entry) => [humanArchiveV4Entry(entry, markdown), ''])
    if (request.mode === 'selective' && request.modelEvidence !== false) {
      const details = humanModelEvidence(modelEvidence, markdown)
      if (details) lines.unshift(details, '')
    }
    return {
      text: lines.join('\n').trimEnd() + '\n',
      mime: markdown ? 'text/markdown' : 'text/plain',
      extension: markdown ? 'md' : 'txt',
    }
  }
  const document = {
    schema: ARCHIVE_V4_EXPORT_SCHEMA,
    mode: request.mode,
    conversationId: request.conversationId,
    selectedTipId: path.selectedTipId,
    verifiedRootId: path.rootId,
    sourceReadId: path.coverageReadId,
    binaryAssetsIncluded: false,
    ...(request.mode === 'selective' && request.modelEvidence !== false
      ? { observedModelEvidence: modelEvidence }
      : {}),
    timestampTimebase: 'unix_seconds_utc',
    timestampScope: 'derived_fields; explicitly included native fragments retain source units',
    messages: entries,
  }
  return {
    text: JSON.stringify(document, null, request.format === 'json-readable' ? 2 : undefined),
    mime: 'application/json',
    extension: 'json',
  }
}

/**
 * Basic/selective export: retain only verified source IDs, formatted Blob
 * parts and sparse observed model changes; never retain the entire raw path.
 */
export async function createArchiveV4CompactBlobFromIndex(
  path: ArchiveV4PathIndex,
  request: Pick<
    ArchiveV4ExportRequest,
    | 'conversationId'
    | 'selectedTipId'
    | 'mode'
    | 'format'
    | 'reasoning'
    | 'tools'
    | 'internal'
    | 'reasoningRecap'
    | 'reasoningFull'
    | 'toolCalls'
    | 'toolResults'
    | 'toolSourceContent'
    | 'modelEvidence'
    | 'dictationEditEvidence'
    | 'sourceRevisions'
    | 'attachmentMetadata'
  >,
  lookup: (messageId: string) => Promise<ArchiveV4Message | undefined>,
  assertActive: () => void = () => undefined,
  revisionEvidence?: (messageId: string) => Promise<ArchiveV4SourceRevisionWindow>,
  onRecord?: (records: number) => void,
  submissionEvidence?: (messageId: string) => Promise<ArchiveV4SubmissionEvidence>,
): Promise<{ blob: Blob; extension: string }> {
  if (
    path.status !== 'verified' ||
    !path.rootId ||
    !path.messageIds.length ||
    path.conversationRevision === null ||
    path.selectedTipId !== request.selectedTipId
  )
    throw new Error('archive.error.unverifiedPath')
  if (request.mode === 'technical') throw new Error('archive.error.unverifiedPath')
  const human = request.format === 'markdown' || request.format === 'text'
  const readable = request.format === 'json-readable'
  const collector = modelObservationCollector()
  const bodyParts: BlobPart[] = []
  let buffer = ''
  let previousHuman: string | null = null
  let included = 0
  let consumed = 0
  for (const messageId of path.messageIds) {
    assertActive()
    if (!messageId) throw new Error('archive.error.sourceChanged')
    const message = await lookup(messageId)
    assertActive()
    if (!message || message.messageId !== messageId) throw new Error('archive.error.sourceChanged')
    if (request.mode === 'selective' && request.modelEvidence !== false) {
      collector.observe(message)
      if (isUserSource(message.raw)) {
        const submission = submissionEvidence
          ? await submissionEvidence(messageId)
          : { status: 'unobserved' as const, selection: null }
        assertActive()
        collector.observeSubmission(messageId, submission)
      }
    }
    const projected = projectArchiveV4CompactEntry(message, request)
    const revisionWindow =
      projected.length &&
      request.mode === 'selective' &&
      request.sourceRevisions === true &&
      message.revision > 1
        ? await revisionEvidence?.(messageId)
        : undefined
    assertActive()
    if (request.mode === 'selective' && request.sourceRevisions === true && !revisionEvidence)
      throw new Error('archive.error.sourceChanged')
    // A revised current record requires a contiguous predecessor chain. An
    // intentional bounded truncation may omit only older revisions, never the
    // immediate predecessor or an internal gap.
    if (
      revisionWindow &&
      (revisionWindow.previous.at(-1)?.previousRevision !== message.revision - 1 ||
        (!revisionWindow.olderRevisionsOmitted &&
          revisionWindow.previous[0]?.previousRevision !== 1))
    )
      throw new Error('archive.error.sourceChanged')
    const entries: CompactEntry[] =
      revisionWindow && (revisionWindow.previous.length > 0 || revisionWindow.olderRevisionsOmitted)
        ? projected.map((item) => ({
            ...item,
            sourceRevisionEvidence: projectRevisionEvidence(revisionWindow, message.revision),
          }))
        : projected
    for (const entry of entries) {
      if (human) {
        if (previousHuman !== null) buffer += `${previousHuman}\n\n`
        previousHuman = humanArchiveV4Entry(entry, request.format === 'markdown')
      } else {
        const record = JSON.stringify(entry, null, readable ? 2 : undefined)
        buffer += readable
          ? `${included ? ',' : ''}\n    ${record.replace(/\n/g, '\n    ')}`
          : `${included ? ',' : ''}${record}`
      }
      included++
      if (included % 128 === 0) {
        bodyParts.push(buffer)
        buffer = ''
      }
    }
    consumed += 1
    onRecord?.(consumed)
    assertActive()
  }
  assertActive()
  const modelEvidence = collector.result()
  if (human) {
    const details =
      request.mode === 'selective' && request.modelEvidence !== false
        ? humanModelEvidence(modelEvidence, request.format === 'markdown')
        : ''
    const parts: BlobPart[] = []
    if (details) parts.push(details, previousHuman === null ? '\n' : '\n\n')
    parts.push(...bodyParts)
    if (buffer) parts.push(buffer)
    if (previousHuman !== null) parts.push(previousHuman.trimEnd(), '\n')
    else if (!details) parts.push('\n')
    return {
      blob: new Blob(parts, {
        type:
          request.format === 'markdown'
            ? 'text/markdown;charset=utf-8'
            : 'text/plain;charset=utf-8',
      }),
      extension: request.format === 'markdown' ? 'md' : 'txt',
    }
  }
  if (buffer) bodyParts.push(buffer)
  const document = {
    schema: ARCHIVE_V4_EXPORT_SCHEMA,
    mode: request.mode,
    conversationId: request.conversationId,
    selectedTipId: path.selectedTipId,
    verifiedRootId: path.rootId,
    sourceReadId: path.coverageReadId,
    binaryAssetsIncluded: false,
    ...(request.mode === 'selective' && request.modelEvidence !== false
      ? { observedModelEvidence: modelEvidence }
      : {}),
    timestampTimebase: 'unix_seconds_utc',
    timestampScope: 'derived_fields; explicitly included native fragments retain source units',
    messages: [],
  }
  const skeleton = JSON.stringify(document, null, readable ? 2 : undefined)
  const arrayStart = skeleton.lastIndexOf('[]')
  if (arrayStart < 0) throw new Error('Archive v4 compact schema mismatch')
  const parts: BlobPart[] = included
    ? [
        skeleton.slice(0, arrayStart),
        '[',
        ...bodyParts,
        readable ? '\n  ]' : ']',
        skeleton.slice(arrayStart + 2),
      ]
    : [skeleton]
  return { blob: new Blob(parts, { type: 'application/json;charset=utf-8' }), extension: 'json' }
}

/** Strict new-format writer; does not interpret or import v1 files. */
export function serializeArchiveV4Path(
  path: ArchiveV4PathResult,
  request: Omit<ArchiveV4ExportRequest, 'accountId' | 'signal' | 'stillAuthorized' | 'onProgress'>,
): { text: string; mime: string; extension: string } {
  if (
    path.status !== 'verified' ||
    !path.rootId ||
    !path.messages.length ||
    path.conversationRevision === null
  )
    throw new Error('archive.error.unverifiedPath')
  if (request.selectedTipId !== path.selectedTipId)
    throw new Error('archive.error.selectedPathChanged')
  if (request.mode === 'technical') {
    if (request.format !== 'json-readable' && request.format !== 'json-compact')
      throw new Error('archive.error.technicalRequiresJson')
    const source = technicalDocument(
      path,
      request.conversationId,
      path.messages.map((message) => message.raw),
    )
    return {
      text: JSON.stringify(source, null, request.format === 'json-readable' ? 2 : undefined),
      mime: 'application/json',
      extension: 'json',
    }
  }

  const modelEvidence =
    request.mode === 'selective' && request.modelEvidence !== false
      ? summarizeArchiveV4ModelObservations(path.messages)
      : modelObservationCollector().result()
  const entries = path.messages.flatMap((message) => projectArchiveV4CompactEntry(message, request))
  return serializeArchiveV4CompactEntries(path, request, entries, modelEvidence)
}

const pathBlockers: Record<Exclude<ArchiveV4PathStatus, 'verified'>, ArchiveExportBlocker> = {
  conversation_missing: 'conversation_missing',
  head_mismatch: 'head_mismatch',
  pagination_incomplete: 'page_incomplete',
  capture_omissions: 'capture_omissions',
  tip_missing: 'tip_missing',
  parent_unknown: 'parent_unknown',
  missing_parent: 'missing_parent',
  cyclic_parent: 'cyclic_parent',
  depth_limit: 'depth_limit',
  source_changed: 'source_changed',
}

/** Export is the only intentionally full selected-lineage read. */
export async function prepareArchiveV4Export(
  store: Pick<
    ArchiveV4Store,
    'sourceGate' | 'readSelectedPath' | 'readSelectedPathIndex' | 'getConversation' | 'getMessage'
  > &
    Partial<Pick<ArchiveV4Store, 'getMessageRevisionEvidence' | 'getMessageSubmission'>>,
  request: ArchiveV4ExportRequest,
): Promise<ArchiveExportOutcome> {
  const assertActive = () => {
    assertNotCancelled(request.signal)
    if (request.stillAuthorized && !request.stillAuthorized()) throw new Error('archive.error.auth')
    store.sourceGate.assertCompatible(request.conversationId)
  }
  let lastPhase: ArchiveExportProgress['phase'] | undefined
  let lastPublishedAt = 0
  const report = (progress: ArchiveExportProgress) => {
    assertActive()
    if (!request.onProgress) return
    const now = performance.now()
    const reachedEnd =
      progress.total !== null &&
      progress.completed !== null &&
      progress.completed === progress.total
    // Throttle display notifications only. Counters come from completed work,
    // never timers, estimates or the number of unrelated saved messages.
    if (progress.phase !== lastPhase || reachedEnd || now - lastPublishedAt >= 100) {
      lastPhase = progress.phase
      lastPublishedAt = now
      try {
        request.onProgress(Object.freeze({ ...progress }))
      } catch {
        // A display listener is not part of the archive's integrity boundary.
      }
      assertActive()
    }
  }
  report({ phase: 'checking', unit: null, completed: null, total: null })
  const selected = await store.readSelectedPathIndex(
    request.accountId,
    request.conversationId,
    request.selectedTipId,
    50_000,
    request.signal,
    (completed) => report({ phase: 'tracing', unit: 'records', completed, total: null }),
  )
  assertActive()
  if (selected.status !== 'verified')
    throw new ArchiveExportBlockedError(pathBlockers[selected.status])
  if (selected.conversationRevision === null) throw new ArchiveExportBlockedError('source_changed')
  const assertSnapshot = async () => {
    const current = await store.getConversation(request.accountId, request.conversationId)
    assertActive()
    if (
      !current ||
      current.revision !== selected.conversationRevision ||
      (current.instanceId ?? null) !== (selected.conversationInstanceId ?? null) ||
      current.currentNodeId !== request.selectedTipId
    )
      throw new Error('archive.error.sourceChanged')
  }
  await assertSnapshot()
  const recordCount = selected.messageIds.length
  const serializedRecord = (completed: number) =>
    report({
      phase: 'serializing',
      unit: 'records',
      completed,
      total: recordCount,
    })
  serializedRecord(0)
  const lookup = (id: string) => store.getMessage(request.accountId, request.conversationId, id)
  const readRevisionEvidence = store.getMessageRevisionEvidence?.bind(store)
  const readSubmission = store.getMessageSubmission?.bind(store)
  const sourceFile =
    request.mode === 'technical'
      ? {
          extension: 'json',
          blob: await createArchiveV4TechnicalBlobFromIndex(
            selected,
            request,
            lookup,
            assertActive,
            serializedRecord,
          ),
        }
      : await createArchiveV4CompactBlobFromIndex(
          selected,
          request,
          lookup,
          assertActive,
          request.mode === 'selective' && request.sourceRevisions === true && readRevisionEvidence
            ? (id) => readRevisionEvidence(request.accountId, request.conversationId, id)
            : undefined,
          serializedRecord,
          request.mode === 'selective' && request.modelEvidence !== false && readSubmission
            ? (id) => readSubmission(request.accountId, request.conversationId, id)
            : undefined,
        )
  assertActive()
  let blob = sourceFile.blob
  let extension = sourceFile.extension
  const packaged = request.packaging === 'zip'
  if (packaged) {
    const filename = `conversation.${sourceFile.extension}`
    const manifest = {
      schema: 'chatgpt-booster.archive-package.v2',
      contentSchema: ARCHIVE_V4_EXPORT_SCHEMA,
      path: filename,
      contentFormat: request.format,
      sourceReadId: selected.coverageReadId,
      sourcePathVerified: selected.status === 'verified',
      binaryAssetsIncluded: false,
      compression: 'none',
    }
    blob = await createStoredZipFromBlobs(
      [
        { path: filename, blob: sourceFile.blob },
        { path: 'archive-manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)]) },
      ],
      request.signal,
      (completed, total) => report({ phase: 'packaging', unit: 'bytes', completed, total }),
    )
    extension = 'zip'
  }
  report({ phase: 'verifying', unit: null, completed: null, total: null })
  await assertSnapshot()
  // Read/ZIP counters reaching their maxima never imply export readiness.
  // Ready is emitted only after the final revision/head/owner checks succeed.
  report({ phase: 'ready', unit: 'bytes', completed: blob.size, total: blob.size })
  return {
    packaged,
    complete: true,
    includedAssets: 0,
    missingAssets: 0,
    blob,
    extension,
  }
}
