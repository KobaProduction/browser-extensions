/** One application message contract. Provider-native originals remain separate
 * immutable source snapshots; this DTO stores references, never a raw copy. */
export const ARCHIVE_MESSAGE_MODEL_VERSION = 1 as const
export interface ArchiveMessageIdentity {
  readonly providerId: string
  readonly ownerId: string
  readonly conversationId: string
  readonly messageId: string
}
export interface ArchiveMessageElementV1 {
  readonly id: string
  readonly parentId: string | null
  readonly order: number
  readonly kind:
    | 'container'
    | 'text'
    | 'code'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'attachment'
    | 'opaque'
  readonly visibility: 'visible' | 'internal' | 'unknown'
  readonly text: string | null
  readonly language: string | null
  readonly sourcePath: string
}
export interface ArchiveMessageV1 {
  readonly schema: 'koba.message'
  readonly modelVersion: typeof ARCHIVE_MESSAGE_MODEL_VERSION
  readonly key: string
  readonly identity: ArchiveMessageIdentity
  readonly author: {
    readonly id: string | null
    readonly role: string | null
    readonly name: string | null
  }
  readonly time: {
    readonly createdAtMs: number | null
    readonly updatedAtMs: number | null
    readonly observedAtMs: number
  }
  readonly links: {
    readonly parentId: string | null
    readonly parentObserved: boolean
    readonly replyToId: string | null
    readonly threadId: string | null
  }
  readonly context: {
    readonly channel: string | null
    readonly recipient: string | null
    readonly status: string | null
    readonly endTurn: boolean | null
    readonly projectId: string | null
    readonly requestId: string | null
    readonly turnExchangeId: string | null
    readonly workingTurnId: string | null
    readonly requestedModel: string | null
    readonly resolvedModel: string | null
    readonly direction: 'incoming' | 'outgoing' | null
  }
  readonly content: {
    readonly coverage: 'typed' | 'contains-opaque'
    readonly elements: readonly ArchiveMessageElementV1[]
  }
  /** Per-message source evidence, not proof of whole-conversation completeness. */
  readonly evidence: { readonly terminal: 'observed' | 'unknown' }
  readonly source: {
    readonly snapshotKey: string
    readonly kind: string
    readonly version: string
    readonly variantIndex: number | null
  }
}
export interface ArchiveMessageSourceContext {
  readonly ownerId: string
  readonly conversationId: string
  readonly sourceKind: string
  readonly sourceVersion: string
  readonly observedAtMs: number
  readonly projectId?: string | null
  readonly variantIndex?: number | null
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
// Owning source/query/backup ports retain their admission bounds. The shared DTO
// must not impose a narrower limit on a valid provider-native identity.
const identityText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const nullableText = (value: unknown) => value === null || typeof value === 'string'
const nullableTime = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value))
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (
    !object(value) ||
    Object.keys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    throw Error('Invalid normalized message shape')
  return value
}
export function archiveMessageKey(identity: ArchiveMessageIdentity): string {
  if (
    !identity ||
    !identityText(identity.providerId) ||
    !/^[a-z][a-z0-9-]*$/.test(identity.providerId) ||
    !identityText(identity.ownerId) ||
    !identityText(identity.conversationId) ||
    !identityText(identity.messageId)
  )
    throw Error('Invalid normalized message identity')
  return JSON.stringify([
    identity.providerId,
    identity.ownerId,
    identity.conversationId,
    identity.messageId,
  ])
}
/** Strict model/version/identity validation before a stored or remote DTO is used. */
export function validateArchiveMessage(
  input: unknown,
  expected?: ArchiveMessageIdentity,
): ArchiveMessageV1 {
  const value = fields(input, [
    'schema',
    'modelVersion',
    'key',
    'identity',
    'author',
    'time',
    'links',
    'context',
    'content',
    'evidence',
    'source',
  ])
  if (value.schema !== 'koba.message' || value.modelVersion !== ARCHIVE_MESSAGE_MODEL_VERSION)
    throw Error('Unsupported normalized message version')
  const identity = fields(value.identity, [
    'providerId',
    'ownerId',
    'conversationId',
    'messageId',
  ]) as unknown as ArchiveMessageIdentity
  if (
    value.key !== archiveMessageKey(identity) ||
    (expected && value.key !== archiveMessageKey(expected))
  )
    throw Error('Normalized message owner or identity mismatch')
  const author = fields(value.author, ['id', 'role', 'name'])
  if (Object.values(author).some((item) => !nullableText(item))) throw Error('Invalid normalized author')
  const time = fields(value.time, ['createdAtMs', 'updatedAtMs', 'observedAtMs'])
  if (
    !nullableTime(time.createdAtMs) ||
    !nullableTime(time.updatedAtMs) ||
    !Number.isSafeInteger(time.observedAtMs) ||
    (time.observedAtMs as number) < 0
  )
    throw Error('Invalid normalized message time')
  const links = fields(value.links, ['parentId', 'parentObserved', 'replyToId', 'threadId'])
  if (
    typeof links.parentObserved !== 'boolean' ||
    !nullableText(links.parentId) ||
    !nullableText(links.replyToId) ||
    !nullableText(links.threadId) ||
    (!links.parentObserved && links.parentId !== null)
  )
    throw Error('Invalid normalized message links')
  const context = fields(value.context, [
    'channel',
    'recipient',
    'status',
    'endTurn',
    'projectId',
    'requestId',
    'turnExchangeId',
    'workingTurnId',
    'requestedModel',
    'resolvedModel',
    'direction',
  ])
  for (const [key, item] of Object.entries(context)) {
    if (key === 'endTurn') {
      if (item !== null && typeof item !== 'boolean') throw Error('Invalid normalized completion flag')
    } else if (key === 'direction') {
      if (item !== null && item !== 'incoming' && item !== 'outgoing')
        throw Error('Invalid normalized direction')
    } else if (!nullableText(item)) throw Error('Invalid normalized context')
  }
  const content = fields(value.content, ['coverage', 'elements'])
  if (
    !['typed', 'contains-opaque'].includes(String(content.coverage)) ||
    !Array.isArray(content.elements)
  )
    throw Error('Invalid normalized content')
  const ids = new Set<string>()
  for (const item of content.elements) {
    const element = fields(item, [
      'id',
      'parentId',
      'order',
      'kind',
      'visibility',
      'text',
      'language',
      'sourcePath',
    ])
    if (
      typeof element.id !== 'string' ||
      !element.id ||
      ids.has(element.id) ||
      !nullableText(element.parentId) ||
      !Number.isSafeInteger(element.order) ||
      (element.order as number) < 0 ||
      ![
        'container',
        'text',
        'code',
        'reasoning',
        'tool_call',
        'tool_result',
        'attachment',
        'opaque',
      ].includes(String(element.kind)) ||
      !['visible', 'internal', 'unknown'].includes(String(element.visibility)) ||
      !nullableText(element.text) ||
      !nullableText(element.language) ||
      typeof element.sourcePath !== 'string'
    )
      throw Error('Invalid normalized content element')
    ids.add(element.id)
  }
  for (const item of content.elements as ArchiveMessageElementV1[])
    if (item.parentId !== null && !ids.has(item.parentId))
      throw Error('Missing normalized element parent')
  const parents = new Map(
      (content.elements as ArchiveMessageElementV1[]).map((item) => [item.id, item.parentId]),
    ),
    completed = new Set<string>()
  for (const id of ids) {
    const path = new Set<string>()
    let cursor: string | null = id
    while (cursor !== null && !completed.has(cursor)) {
      if (path.has(cursor)) throw Error('Normalized content hierarchy contains a cycle')
      path.add(cursor)
      cursor = parents.get(cursor) ?? null
    }
    for (const visited of path) completed.add(visited)
  }
  if (
    (content.elements as ArchiveMessageElementV1[]).some((item) => item.kind === 'opaque') &&
    content.coverage !== 'contains-opaque'
  )
    throw Error('Unproven normalized render coverage')
  const evidence = fields(value.evidence, ['terminal'])
  if (!['observed', 'unknown'].includes(String(evidence.terminal)))
    throw Error('Invalid normalized evidence')
  const source = fields(value.source, ['snapshotKey', 'kind', 'version', 'variantIndex'])
  if (
    typeof source.snapshotKey !== 'string' ||
    !source.snapshotKey ||
    !identityText(source.kind) ||
    !identityText(source.version) ||
    (source.variantIndex !== null &&
      (!Number.isSafeInteger(source.variantIndex) || (source.variantIndex as number) < 0))
  )
    throw Error('Invalid normalized source reference')
  return input as ArchiveMessageV1
}
/** Unknown fields/types remain in the companion source, rather than guessed text. */
export function archiveMessageText(message: ArchiveMessageV1): string {
  return message.content.elements
    .filter((element) => element.text !== null)
    .map((element) => element.text)
    .join('\n')
}
/** Stored optional envelopes are checked against the immutable source. Missing
 * legacy metadata is adapted in memory; disagreement is never silently trusted. */
export function resolveArchiveMessage(stored: unknown, derived: ArchiveMessageV1): ArchiveMessageV1 {
  validateArchiveMessage(derived)
  if (stored === undefined) return derived
  const message = validateArchiveMessage(stored, derived.identity)
  const equal = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true
    if (Array.isArray(left) && Array.isArray(right))
      return left.length === right.length && left.every((value, index) => equal(value, right[index]))
    if (!object(left) || !object(right)) return false
    const keys = Object.keys(left)
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
    )
  }
  if (!equal(message, derived)) throw Error('Normalized message disagrees with source evidence')
  return message
}
