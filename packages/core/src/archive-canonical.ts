/**
 * Provider-independent archive projection contract.
 *
 * Native ChatGPT objects belong in an immutable SourceSnapshot stored alongside
 * these canonical records. No current client field names are part of persisted
 * canonical element layout. Conversion is deliberately explicit: unknown
 * content survives as an opaque source reference, not guessed readable text.
 */
export const ARCHIVE_CANONICAL_MODEL_VERSION = 1

export type CanonicalElementKind =
  | 'container'
  | 'text'
  | 'code'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'opaque'

export type CanonicalElementVisibility = 'visible' | 'internal' | 'unknown'

/** Structural tree order, not transient page DOM coordinates or CSS. */
export interface CanonicalContentElement {
  readonly elementId: string
  readonly messageKey: string
  readonly parentElementId: string | null
  readonly siblingOrder: number
  readonly kind: CanonicalElementKind
  readonly visibility: CanonicalElementVisibility
  readonly text: string | null
  readonly language: string | null
  /** Address within the immutable companion source snapshot, never inferred. */
  readonly sourcePath: string
}

export interface CanonicalMessageProjection {
  readonly modelVersion: number
  readonly accountId: string
  readonly conversationId: string
  readonly messageId: string
  readonly messageKey: string
  readonly role: string | null
  readonly channel: string | null
  readonly recipient: string | null
  readonly parentMessageId: string | null
  readonly parentObserved: boolean
  readonly sourceCreateTime: number | null
  readonly sourceUpdateTime: number | null
  readonly elements: readonly CanonicalContentElement[]
  /** Partial never means source invalid; opaque elements still require raw snapshot. */
  readonly renderCoverage: 'typed' | 'contains_opaque'
}

export interface CanonicalSourceSnapshotLink {
  readonly messageKey: string
  readonly sourceVersion: string
  readonly sourceFingerprint: string
  readonly sourceKind: 'native' | 'legacy_v3' | 'legacy_v4'
  readonly observedAtMs: number
}

type RecordValue = Record<string, unknown>
const asRecord = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null
const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const asTime = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * Source adapter output -> canonical v1, for an already validated source object.
 * No IndexedDB access, account guessing, content mutation or source-page proof.
 * Authoritative native adapter signature/owner validation happens before this call.
 */
export function projectNativeMessage(
  raw: Readonly<RecordValue>,
  scope: { accountId: string; conversationId: string },
): CanonicalMessageProjection {
  if (!scope.accountId || !scope.conversationId || typeof raw.id !== 'string' || !raw.id)
    throw new Error('Canonical archive identity missing')
  const key = JSON.stringify([scope.accountId, scope.conversationId, raw.id])
  const metadata = asRecord(raw.metadata)
  const content = asRecord(raw.content)
  const role = asText(asRecord(raw.author)?.role)
  const recipient = asText(raw.recipient)
  const channel = asText(raw.channel)
  const kind = asText(content?.content_type)
  const elements: CanonicalContentElement[] = []
  const rootId = JSON.stringify([key, 'root'])
  const visibility: CanonicalElementVisibility =
    role === 'user' || (role === 'assistant' && (channel === null || channel === 'final'))
      ? 'visible'
      : role === 'assistant' || role === 'tool'
        ? 'internal'
        : 'unknown'
  const rootKind: CanonicalElementKind =
    role === 'tool'
      ? 'tool_result'
      : role === 'assistant' && recipient && recipient !== 'all'
        ? 'tool_call'
        : kind === 'thoughts' || kind === 'reasoning_recap'
          ? 'reasoning'
          : kind === 'code'
            ? 'code'
            : 'container'
  elements.push({
    elementId: rootId,
    messageKey: key,
    parentElementId: null,
    siblingOrder: 0,
    kind: rootKind,
    visibility,
    text: null,
    language: null,
    sourcePath: 'content',
  })
  const append = (
    index: number,
    elementKind: CanonicalElementKind,
    sourcePath: string,
    text: string | null,
    language: string | null = null,
  ) => {
    elements.push({
      elementId: JSON.stringify([key, 'content', index]),
      messageKey: key,
      parentElementId: rootId,
      siblingOrder: index,
      kind: elementKind,
      visibility,
      text,
      language,
      sourcePath,
    })
  }
  if ((kind === 'text' || kind === 'multimodal_text') && Array.isArray(content?.parts)) {
    content.parts.forEach((part: unknown, i: number) => {
      append(
        i,
        typeof part === 'string' ? 'text' : 'opaque',
        `content.parts[${i}]`,
        typeof part === 'string' ? part : null,
      )
    })
  } else if (
    (kind === 'code' || kind === 'execution_output') &&
    typeof content?.text === 'string'
  ) {
    append(
      0,
      kind === 'code' ? 'code' : 'tool_result',
      'content.text',
      content.text,
      kind === 'code' ? asText(content.language) : null,
    )
  } else if (kind === 'reasoning_recap' && typeof content?.content === 'string') {
    append(0, 'reasoning', 'content.content', content.content)
  } else {
    // Opaque placeholder preserves the source slot without decoding unsupported
    // contents, which remain recoverable from the immutable snapshot.
    append(0, 'opaque', 'content', null)
  }

  return {
    modelVersion: ARCHIVE_CANONICAL_MODEL_VERSION,
    accountId: scope.accountId,
    conversationId: scope.conversationId,
    messageId: raw.id,
    messageKey: key,
    role,
    channel,
    recipient,
    parentMessageId: asText(metadata?.parent_id),
    parentObserved:
      !!metadata &&
      Object.hasOwn(metadata, 'parent_id') &&
      (metadata.parent_id === null || typeof metadata.parent_id === 'string'),
    sourceCreateTime: asTime(raw.create_time),
    sourceUpdateTime: asTime(raw.update_time),
    elements,
    renderCoverage: elements.some((element) => element.kind === 'opaque')
      ? 'contains_opaque'
      : 'typed',
  }
}
