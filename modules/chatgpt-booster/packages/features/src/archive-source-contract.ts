import { ARCHIVE_SOURCE_INCOMPATIBLE_EVENT } from '@chatgpt-booster/core'
import {
  type ConversationArchiveEventDetail,
  type ConversationSubmissionSelection,
  SUBMISSION_SELECTION_SCHEMA,
} from '@chatgpt-booster/observer'

/**
 * Source contracts are intentionally independent of IndexedDB and export schema versions.
 * The message's original JSON object is never rewritten by this validator.
 *
 * v1 and v2 remain registered as their original strict signatures. v3 only
 * adds field names and structural types observed in native ChatGPT history
 * on 2026-10-09. Database and export versions remain independent.
 */
export const NATIVE_HISTORY_CONTRACT_V1 = 'chatgpt-history-2026-10-v1'
export const NATIVE_HISTORY_CONTRACT_V2 = 'chatgpt-history-2026-10-v2'
export const NATIVE_HISTORY_CONTRACT_VERSION = 'chatgpt-history-2026-10-v3'

/** Retain ambiguity even if a repeated message ID is submitted before its first capture. */
export interface ArchiveSubmissionSnapshot {
  selection: ConversationSubmissionSelection
  conflicted: boolean
}
export function sameSubmissionSelection(
  left: ConversationSubmissionSelection,
  right: ConversationSubmissionSelection,
): boolean {
  return (
    left.messageId === right.messageId &&
    left.requestedModel === right.requestedModel &&
    left.effortPresent === right.effortPresent &&
    left.thinkingEffort === right.thinkingEffort
  )
}

export type ArchiveContractFailure = {
  conversationId: string
  version: string
  path: string
  reason: 'missing' | 'unexpected' | 'type' | 'identity' | 'unsupported'
}
export class ArchiveContractError extends Error {
  override readonly name = 'ArchiveContractError'
  constructor(readonly failure: ArchiveContractFailure) {
    super('archive.error.incompatibleSource')
  }
}

const initialKeys = new Set(
  `
  async_status atlas_mode_enabled blocked_urls context_scopes context_truncation_continuation
  conversation_id conversation_origin conversation_template_id create_time current_node
  default_model_slug disabled_tool_ids gizmo_id gizmo_type is_archived is_do_not_remember
  is_read_only is_starred is_study_mode is_temporary_chat memory_scope messages
  moderation_results owner page_info pinned_time plugin_ids safe_urls sectioned_conversation
  sugar_item_id sugar_item_visible title update_time voice
`
    .trim()
    .split(/\s+/),
)
const continuationKeys = new Set('messages page_info safe_urls blocked_urls'.split(' '))
const messageKeys = new Set(
  'id author create_time update_time content status end_turn weight metadata recipient channel'.split(
    ' ',
  ),
)
const authorKeys = new Set('role name metadata'.split(' '))
const pageInfoKeys = new Set('start_cursor end_cursor has_previous_page has_next_page'.split(' '))
/** Recognized metadata field names and outer structural types from observed native history. */
type MetadataFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'nullable-string'
  | 'nullable-array'

const metadataTypes: Readonly<Record<string, MetadataFieldType>> = {
  attachments: 'array',
  bidi_voice_fem_message: 'boolean',
  bidi_voice_mode_message: 'boolean',
  branching_from_conversation_id: 'string',
  branching_from_conversation_owner: 'string',
  branching_from_conversation_title: 'string',
  can_save: 'boolean',
  chime_version: 'number',
  citations: 'array',
  classifier_response: 'string',
  code_blocks: 'object',
  content_references: 'array',
  cot_version: 'string',
  debug_sonic_thread_id: 'string',
  default_model_slug: 'string',
  dictation: 'boolean',
  dictation_asset_format: 'string',
  dictation_asset_pointer: 'string',
  dictation_auto_submitted: 'boolean',
  dictation_edited: 'boolean',
  dictation_original_text: 'string',
  disable_turn_actions: 'boolean',
  finish_details: 'object',
  finished_duration_sec: 'number',
  hide_inline_actions: 'boolean',
  image_gen_async: 'boolean',
  image_results: 'array',
  inline_cot_expandable_content: 'object',
  is_complete: 'boolean',
  is_thinking_preamble_message: 'boolean',
  is_visually_hidden_from_conversation: 'boolean',
  message_source: 'nullable-string',
  message_type: 'string',
  model_adjustments: 'array',
  model_slug: 'string',
  model_switcher_deny: 'array',
  paragen_ui_treatment: 'string',
  parent_id: 'nullable-string',
  real_time_audio_has_video: 'boolean',
  reasoning_end_time: 'number',
  reasoning_recap_type: 'string',
  reasoning_start_time: 'number',
  reasoning_status: 'string',
  reasoning_title: 'string',
  reasoning_title_content_transition: 'string',
  reasoning_titles: 'array',
  rebase_developer_message: 'boolean',
  rebase_system_message: 'boolean',
  request_id: 'string',
  resolved_model_slug: 'string',
  safe_urls: 'array',
  search_model_queries: 'object',
  search_queries: 'array',
  search_result_groups: 'array',
  skip_reasoning_title: 'string',
  story_events: 'array',
  system_hints: 'array',
  tc_session_id: 'string',
  tool_icons: 'array',
  tool_summary_type: 'string',
  trigger_async_ux: 'boolean',
  turn_exchange_id: 'string',
  voice_mode_message: 'boolean',
  voice_session_id: 'string',
  working_turn_id: 'string',
  writing_blocks: 'object',
}
const contentKeys: Readonly<Record<string, ReadonlySet<string>>> = {
  text: new Set(['content_type', 'parts']),
  multimodal_text: new Set(['content_type', 'parts']),
  model_editable_context: new Set([
    'content_type',
    'model_set_context',
    'repo_summary',
    'repository',
    'structured_context',
  ]),
  thoughts: new Set(['content_type', 'source_analysis_msg_id', 'thoughts']),
  reasoning_recap: new Set(['content_type', 'content']),
}
const asObject = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const v2MetadataTypes: Readonly<Record<string, MetadataFieldType>> = {
  ...metadataTypes,
  aggregate_result: 'object',
  connector_tool_payload: 'string',
  conversation_followup_suggestions_eligible: 'boolean',
  invoked_plugin: 'object',
  invoked_resource: 'object',
  is_free_thinking_preview_turn: 'boolean',
  reasoning_title: 'nullable-string',
  reasoning_titles: 'nullable-array',
  serialization_metadata: 'object',
  tool_hide_expanded_content: 'boolean',
  tool_invoked_message: 'string',
  tool_invoking_message: 'string',
  write_like_me_offer_policy: 'string',
}
// Observed in a live, already-authorized ChatGPT native history response
// (510 messages). Preserve the fields unmodified and accept only recorded
// outer types; never admit unrecognized future metadata.
const v3MetadataTypes: Readonly<Record<string, MetadataFieldType>> = {
  ...v2MetadataTypes,
  thinking_effort: 'string',
  gizmo_id: 'string',
  reasoning_group_id: 'string',
  model_dil_v2: 'object',
  view_state: 'object',
  summary_type: 'string',
  is_merged_message: 'boolean',
  source_message_ids: 'array',
  continuation_message_id: 'string',
  logical_answer_prefix_activity: 'object',
  genui_components: 'array',
}
const v2ContentKeys: Readonly<Record<string, ReadonlySet<string>>> = {
  ...contentKeys,
  code: new Set(['content_type', 'language', 'response_format_name', 'text']),
  execution_output: new Set(['content_type', 'text']),
}

interface NativeHistoryValidationProfile {
  version: string
  metadata: Readonly<Record<string, MetadataFieldType>>
  content: Readonly<Record<string, ReadonlySet<string>>>
}
const v1Profile: NativeHistoryValidationProfile = {
  version: NATIVE_HISTORY_CONTRACT_V1,
  metadata: metadataTypes,
  content: contentKeys,
}
const v2Profile: NativeHistoryValidationProfile = {
  version: NATIVE_HISTORY_CONTRACT_V2,
  metadata: v2MetadataTypes,
  content: v2ContentKeys,
}
const v3Profile: NativeHistoryValidationProfile = {
  version: NATIVE_HISTORY_CONTRACT_VERSION,
  metadata: v3MetadataTypes,
  content: v2ContentKeys,
}
function metadataTypeMatches(expected: MetadataFieldType, value: unknown): boolean {
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (expected === 'nullable-string') return actual === 'null' || actual === 'string'
  if (expected === 'nullable-array') return actual === 'null' || actual === 'array'
  return (
    actual === expected &&
    (expected !== 'number' || (typeof value === 'number' && Number.isFinite(value)))
  )
}
/**
 * The only observed serialization_metadata structure has an empty offsets array.
 * Non-empty offsets are a new source shape until their entry types are observed.
 */
function validateSerializationMetadata(
  value: unknown,
  path: string,
  fail: (path: string, reason: ArchiveContractFailure['reason']) => never,
) {
  const entry = asObject(value)
  if (!entry) fail(path, 'type')
  for (const name of Object.keys(entry))
    if (name !== 'custom_symbol_offsets') fail(`${path}.${name}`, 'unexpected')
  if (!Array.isArray(entry.custom_symbol_offsets)) fail(`${path}.custom_symbol_offsets`, 'type')
  if (entry.custom_symbol_offsets.length !== 0) fail(`${path}.custom_symbol_offsets`, 'unsupported')
}
function validateMetadata(
  metadata: Record<string, unknown>,
  path: string,
  profile: NativeHistoryValidationProfile,
  fail: (path: string, reason: ArchiveContractFailure['reason']) => never,
) {
  for (const [name, value] of Object.entries(metadata)) {
    const fieldPath = `${path}.${name}`
    const expected = profile.metadata[name]
    if (!expected) fail(fieldPath, 'unexpected')
    if (!metadataTypeMatches(expected, value)) fail(fieldPath, 'type')
    if (profile !== v1Profile && name === 'serialization_metadata')
      validateSerializationMetadata(value, fieldPath, fail)
  }
}

function assertHistoryPage(
  detail: ConversationArchiveEventDetail,
  projected: boolean,
  profile: NativeHistoryValidationProfile,
): void {
  const failure = (path: string, reason: ArchiveContractFailure['reason']): never => {
    throw new ArchiveContractError({
      conversationId: detail.conversationId,
      version: profile.version,
      path,
      reason,
    })
  }
  const obj = (value: unknown, path: string) => asObject(value) ?? failure(path, 'type')
  const keys = (value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string) => {
    for (const key of Object.keys(value))
      if (!allowed.has(key)) failure(`${path}.${key}`, 'unexpected')
  }
  const required = (value: Record<string, unknown>, key: string, path: string) => {
    if (!Object.hasOwn(value, key)) failure(`${path}.${key}`, 'missing')
    return value[key]
  }
  const string = (value: unknown, path: string) => {
    if (typeof value !== 'string') failure(path, 'type')
  }
  const optional = (value: Record<string, unknown>, name: string, path: string, type: string) => {
    if (Object.hasOwn(value, name) && value[name] !== null && typeof value[name] !== type)
      failure(`${path}.${name}`, 'type')
  }
  if (!detail.conversationId || !detail.sourceUrl) failure('conversationId', 'identity')
  const url = (() => {
    try {
      return new URL(detail.sourceUrl)
    } catch {
      return null
    }
  })()
  const route = url?.pathname.match(/^\/backend-api\/conversations\/([^/]+)(\/messages)?$/)
  if (
    url?.origin !== 'https://chatgpt.com' ||
    !route ||
    route[1] !== encodeURIComponent(detail.conversationId) ||
    (route[2] === '/messages') === (detail.isInitial === true)
  )
    failure('sourceUrl', 'identity')

  // DOM fallback is a separate, visibly synthetic source class and never qualifies
  // as a validated ChatGPT native signature.
  if (detail.sourceUrl.includes('#chatgpt-booster-dom-snapshot')) {
    failure('sourceUrl', 'unsupported')
  }
  const payload = obj(detail.payload, 'payload')
  const initial = detail.isInitial === true
  const allowedKeys = projected
    ? new Set([...(initial ? initialKeys : continuationKeys), 'booster_capture'])
    : initial
      ? initialKeys
      : continuationKeys
  keys(payload, allowedKeys, 'payload')
  if (initial) {
    string(required(payload, 'conversation_id', 'payload'), 'payload.conversation_id')
    if (payload.conversation_id !== detail.conversationId)
      failure('payload.conversation_id', 'identity')
  } else if (Object.hasOwn(payload, 'conversation_id')) {
    failure('payload.conversation_id', 'unexpected')
  }
  for (const key of ['title', 'gizmo_id', 'gizmo_type', 'current_node', 'default_model_slug'])
    optional(payload, key, 'payload', 'string')
  const pageInfo = obj(required(payload, 'page_info', 'payload'), 'payload.page_info')
  keys(pageInfo, pageInfoKeys, 'payload.page_info')
  for (const key of pageInfoKeys) required(pageInfo, key, 'payload.page_info')
  for (const key of ['has_previous_page', 'has_next_page'])
    optional(pageInfo, key, 'payload.page_info', 'boolean')
  for (const key of ['start_cursor', 'end_cursor'])
    optional(pageInfo, key, 'payload.page_info', 'string')
  const messages = required(payload, 'messages', 'payload')
  if (!Array.isArray(messages)) failure('payload.messages', 'type')
  const entries = messages as unknown[]
  for (let i = 0; i < entries.length; i++) {
    const path = `payload.messages[${i}]`
    const message = obj(entries[i], path)
    keys(message, messageKeys, path)
    for (const key of messageKeys) required(message, key, path)
    const id = required(message, 'id', path)
    string(id, `${path}.id`)
    if (!id) failure(`${path}.id`, 'identity')
    const author = obj(required(message, 'author', path), `${path}.author`)
    keys(author, authorKeys, `${path}.author`)
    string(required(author, 'role', `${path}.author`), `${path}.author.role`)
    optional(author, 'name', `${path}.author`, 'string')
    if (Object.hasOwn(author, 'metadata')) {
      const authorMeta = obj(author.metadata, `${path}.author.metadata`)
      keys(authorMeta, new Set(['real_author']), `${path}.author.metadata`)
    }
    const content = obj(required(message, 'content', path), `${path}.content`)
    const type = required(content, 'content_type', `${path}.content`)
    string(type, `${path}.content.content_type`)
    const schema = profile.content[type as string]
    if (!schema) failure(`${path}.content.content_type`, 'unsupported')
    keys(content, schema as ReadonlySet<string>, `${path}.content`)
    if (type === 'text' || type === 'multimodal_text') {
      if (!Array.isArray(required(content, 'parts', `${path}.content`)))
        failure(`${path}.content.parts`, 'type')
    }
    if (profile !== v1Profile && type === 'code') {
      string(required(content, 'language', `${path}.content`), `${path}.content.language`)
      string(required(content, 'text', `${path}.content`), `${path}.content.text`)
      optional(content, 'response_format_name', `${path}.content`, 'string')
    }
    if (profile !== v1Profile && type === 'execution_output')
      string(required(content, 'text', `${path}.content`), `${path}.content.text`)
    const metadata = obj(required(message, 'metadata', path), `${path}.metadata`)
    validateMetadata(metadata, `${path}.metadata`, profile, failure)
    for (const key of [
      'parent_id',
      'request_id',
      'turn_exchange_id',
      'working_turn_id',
      'model_slug',
      'resolved_model_slug',
      'message_type',
    ])
      optional(metadata, key, `${path}.metadata`, 'string')
    for (const key of ['create_time', 'update_time', 'weight']) {
      optional(message, key, path, 'number')
      if (typeof message[key] === 'number' && !Number.isFinite(message[key]))
        failure(`${path}.${key}`, 'type')
    }
    for (const key of ['status', 'recipient', 'channel']) optional(message, key, path, 'string')
    optional(message, 'end_turn', path, 'boolean')
  }
}

function assertStreamMessage(
  conversationId: string,
  incoming: Record<string, unknown>,
  profile: NativeHistoryValidationProfile,
) {
  const fail = (path: string, reason: ArchiveContractFailure['reason']): never => {
    throw new ArchiveContractError({
      conversationId,
      version: profile.version,
      path,
      reason,
    })
  }
  const object = (value: unknown, path: string) => asObject(value) ?? fail(path, 'type')
  const allowed = (record: Record<string, unknown>, names: ReadonlySet<string>, path: string) => {
    for (const field of Object.keys(record))
      if (!names.has(field)) fail([path, field].join('.'), 'unexpected')
  }
  const message = object(incoming, 'stream.message')
  allowed(message, messageKeys, 'stream.message')
  if (typeof message.id !== 'string' || !message.id) fail('stream.message.id', 'identity')
  const author = object(message.author, 'stream.message.author')
  allowed(author, authorKeys, 'stream.message.author')
  if (typeof author.role !== 'string' || !author.role) fail('stream.message.author.role', 'type')
  const content = object(message.content, 'stream.message.content')
  if (typeof content.content_type !== 'string') fail('stream.message.content.content_type', 'type')
  const contentShape = profile.content[content.content_type as string]
  if (!contentShape) fail('stream.message.content.content_type', 'unsupported')
  allowed(content, contentShape as ReadonlySet<string>, 'stream.message.content')
  if (
    (content.content_type === 'text' || content.content_type === 'multimodal_text') &&
    !Array.isArray(content.parts)
  )
    fail('stream.message.content.parts', 'type')
  if (profile !== v1Profile && content.content_type === 'code') {
    if (
      typeof content.language !== 'string' ||
      typeof content.text !== 'string' ||
      (content.response_format_name !== undefined &&
        content.response_format_name !== null &&
        typeof content.response_format_name !== 'string')
    )
      fail('stream.message.content', 'type')
  }
  if (
    profile !== v1Profile &&
    content.content_type === 'execution_output' &&
    typeof content.text !== 'string'
  )
    fail('stream.message.content.text', 'type')
  if (message.metadata !== undefined) {
    const metadata = object(message.metadata, 'stream.message.metadata')
    validateMetadata(metadata, 'stream.message.metadata', profile, fail)
  }
  for (const [field, kind] of [
    ['status', 'string'],
    ['recipient', 'string'],
    ['channel', 'string'],
    ['create_time', 'number'],
    ['update_time', 'number'],
    ['weight', 'number'],
    ['end_turn', 'boolean'],
  ] as const) {
    const value = message[field]
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== kind || (kind === 'number' && !Number.isFinite(value)))
    )
      fail(['stream.message', field].join('.'), 'type')
  }
}

export interface NativeHistoryAdapterInfo {
  readonly version: string
  readonly evidenceDocument: string
  readonly fixtureFile: string
  readonly knownNullablePaths: readonly string[]
}
interface NativeHistoryAdapter extends NativeHistoryAdapterInfo {
  readonly assertPage: (detail: ConversationArchiveEventDetail, projected: boolean) => void
  readonly assertStream: (conversationId: string, incoming: Record<string, unknown>) => void
}

/** Only previously documented/implemented signatures may be registered here. */
const nativeHistoryAdapters: Readonly<Record<string, NativeHistoryAdapter>> = Object.freeze({
  [NATIVE_HISTORY_CONTRACT_V1]: Object.freeze({
    version: NATIVE_HISTORY_CONTRACT_V1,
    evidenceDocument: 'docs/CHATGPT_CLIENT_RESEARCH.md',
    fixtureFile: 'tests/archive-source-contract.test.ts',
    knownNullablePaths: Object.freeze([
      'payload.title',
      'payload.gizmo_id',
      'payload.gizmo_type',
      'payload.current_node',
      'payload.default_model_slug',
      'payload.page_info.start_cursor',
      'payload.page_info.end_cursor',
      'payload.page_info.has_previous_page',
      'payload.page_info.has_next_page',
      'message.author.name',
      'message.create_time',
      'message.update_time',
      'message.weight',
      'message.status',
      'message.recipient',
      'message.channel',
      'message.end_turn',
      'message.metadata.parent_id',
    ]),
    assertPage: (detail: ConversationArchiveEventDetail, projected: boolean) =>
      assertHistoryPage(detail, projected, v1Profile),
    assertStream: (id: string, incoming: Record<string, unknown>) =>
      assertStreamMessage(id, incoming, v1Profile),
  }),
  [NATIVE_HISTORY_CONTRACT_V2]: Object.freeze({
    version: NATIVE_HISTORY_CONTRACT_V2,
    evidenceDocument: 'docs/CHATGPT_CLIENT_RESEARCH.md',
    fixtureFile: 'tests/archive-source-contract.test.ts',
    knownNullablePaths: Object.freeze([
      'payload.title',
      'payload.gizmo_id',
      'payload.gizmo_type',
      'payload.current_node',
      'payload.default_model_slug',
      'payload.page_info.start_cursor',
      'payload.page_info.end_cursor',
      'payload.page_info.has_previous_page',
      'payload.page_info.has_next_page',
      'message.author.name',
      'message.create_time',
      'message.update_time',
      'message.weight',
      'message.status',
      'message.recipient',
      'message.channel',
      'message.end_turn',
      'message.metadata.parent_id',
      'message.metadata.message_source',
      'message.metadata.reasoning_title',
      'message.metadata.reasoning_titles',
      'message.content.response_format_name',
    ]),
    assertPage: (detail: ConversationArchiveEventDetail, projected: boolean) =>
      assertHistoryPage(detail, projected, v2Profile),
    assertStream: (id: string, incoming: Record<string, unknown>) =>
      assertStreamMessage(id, incoming, v2Profile),
  }),
  [NATIVE_HISTORY_CONTRACT_VERSION]: Object.freeze({
    version: NATIVE_HISTORY_CONTRACT_VERSION,
    evidenceDocument: 'docs/CHATGPT_CLIENT_RESEARCH.md',
    fixtureFile: 'tests/archive-source-contract.test.ts',
    // No additional nullable forms were observed in the new metadata keys.
    knownNullablePaths: Object.freeze([]),
    assertPage: (detail: ConversationArchiveEventDetail, projected: boolean) =>
      assertHistoryPage(detail, projected, v3Profile),
    assertStream: (id: string, incoming: Record<string, unknown>) =>
      assertStreamMessage(id, incoming, v3Profile),
  }),
})

/** Safe capability facts, not runtime switches or a mechanism to bypass rejection. */
export function registeredNativeHistoryAdapters(): readonly NativeHistoryAdapterInfo[] {
  return Object.freeze(
    Object.values(nativeHistoryAdapters).map((adapter) =>
      Object.freeze({
        version: adapter.version,
        evidenceDocument: adapter.evidenceDocument,
        fixtureFile: adapter.fixtureFile,
        knownNullablePaths: adapter.knownNullablePaths,
      }),
    ),
  )
}

/**
 * Unsupported native payloads lock capture/export for a conversation until a new
 * adapter is released (or the page runtime is restarted with a supported version).
 * No raw message content is included in diagnostics.
 */
export class ArchiveSourceGate {
  #blocked = new Map<string, ArchiveContractFailure>()
  // Selection is immutable for this runtime. A failed payload never tries another adapter.
  constructor(
    private readonly allowSyntheticFixtures = false,
    readonly version: string = NATIVE_HISTORY_CONTRACT_VERSION,
  ) {}

  get registered(): boolean {
    return Object.hasOwn(nativeHistoryAdapters, this.version)
  }

  #selectedAdapter(conversationId: string): NativeHistoryAdapter {
    const selected = this.registered ? nativeHistoryAdapters[this.version] : undefined
    if (!selected)
      throw this.reject({
        conversationId,
        version: /^[a-zA-Z0-9_.-]{1,100}$/.test(this.version)
          ? this.version
          : 'unregistered-version',
        path: 'adapter.version',
        reason: 'unsupported',
      })
    return selected
  }

  get(conversationId: string): ArchiveContractFailure | undefined {
    return this.#blocked.get(conversationId)
  }
  reject(failure: ArchiveContractFailure): ArchiveContractError {
    const previous = this.#blocked.get(failure.conversationId)
    if (!previous) {
      this.#blocked.set(failure.conversationId, failure)
      if (typeof window !== 'undefined')
        window.dispatchEvent(
          new CustomEvent(ARCHIVE_SOURCE_INCOMPATIBLE_EVENT, {
            detail: failure,
          }),
        )
    }
    return new ArchiveContractError(previous ?? failure)
  }
  inspect(detail: ConversationArchiveEventDetail, projected = false) {
    const existing = this.get(detail.conversationId)
    if (existing) throw new ArchiveContractError(existing)
    const adapter = this.#selectedAdapter(detail.conversationId)
    if (this.allowSyntheticFixtures && detail.sourceUrl.startsWith('fixture://')) return
    try {
      adapter.assertPage(detail, projected)
    } catch (cause) {
      if (cause instanceof ArchiveContractError) throw this.reject(cause.failure)
      throw cause
    }
  }
  /**
   * Native streaming message records can be partial while a generation is in
   * progress. Their versioned signature is deliberately less demanding than
   * a persisted history page but does not permit changed field names/types.
   */
  inspectStreamMessage(conversationId: string, incoming: Record<string, unknown>) {
    this.assertCompatible(conversationId)
    if (this.allowSyntheticFixtures) return
    try {
      this.#selectedAdapter(conversationId).assertStream(conversationId, incoming)
    } catch (cause) {
      if (cause instanceof ArchiveContractError) throw this.reject(cause.failure)
      throw cause
    }
  }

  /** Validate a bounded documented request projection before persisting any evidence. */
  inspectSubmissionSelection(conversationId: string, selection: ConversationSubmissionSelection) {
    this.assertCompatible(conversationId)
    const fail = (path: string): never => {
      throw this.reject({
        conversationId,
        version: SUBMISSION_SELECTION_SCHEMA,
        path,
        reason: 'type',
      })
    }
    const value = asObject(selection) ?? fail('submit.selection')
    const keys = new Set([
      'schema',
      'messageId',
      'requestedModel',
      'thinkingEffort',
      'effortPresent',
      'observedAtMs',
      'source',
    ])
    if (
      Object.keys(value).some((name) => !keys.has(name)) ||
      keys.size !== Object.keys(value).length
    )
      fail('submit.selection.keys')
    if (value.schema !== SUBMISSION_SELECTION_SCHEMA || value.source !== 'native-composer-submit')
      fail('submit.selection.schema')
    if (
      typeof value.messageId !== 'string' ||
      !value.messageId ||
      typeof value.requestedModel !== 'string' ||
      !value.requestedModel
    )
      fail('submit.selection.identity')
    if (
      typeof value.effortPresent !== 'boolean' ||
      (value.effortPresent
        ? typeof value.thinkingEffort !== 'string'
        : value.thinkingEffort !== null)
    )
      fail('submit.selection.thinkingEffort')
    if (typeof value.observedAtMs !== 'number' || !Number.isFinite(value.observedAtMs))
      fail('submit.selection.observedAtMs')
  }

  assertCompatible(conversationId: string) {
    const failed = this.get(conversationId)
    if (failed) throw new ArchiveContractError(failed)
    this.#selectedAdapter(conversationId)
  }
}
