import { ARCHIVE_SOURCE_INCOMPATIBLE_EVENT } from '@chatgpt-booster/core'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'

/**
 * Source contracts are intentionally independent of IndexedDB and export schema versions.
 * The message's original JSON object is never rewritten by this validator.
 *
 * Version 1 covers native initial/older history pages and the content variants observed
 * in ChatGPT history. Nested values for known opaque metadata fields are preserved as-is;
 * additional top-level/schema-discriminating keys require another reviewed version.
 */
export const NATIVE_HISTORY_CONTRACT_VERSION = 'chatgpt-history-2026-10-v1'

export type ArchiveContractFailure = {
  conversationId: string
  version: string
  path: string
  reason: 'missing' | 'unexpected' | 'type' | 'identity' | 'unsupported'
}
export class ArchiveContractError extends Error {
  readonly name = 'ArchiveContractError'
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
const metadataTypes: Readonly<
  Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object' | 'nullable-string'>
> = {
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
const metaKeys = new Set(Object.keys(metadataTypes))
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

function assertHistoryPage(detail: ConversationArchiveEventDetail, projected: boolean): void {
  const failure = (path: string, reason: ArchiveContractFailure['reason']): never => {
    throw new ArchiveContractError({
      conversationId: detail.conversationId,
      version: NATIVE_HISTORY_CONTRACT_VERSION,
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
    const schema = contentKeys[type as string]
    if (!schema) failure(`${path}.content.content_type`, 'unsupported')
    keys(content, schema as ReadonlySet<string>, `${path}.content`)
    if (type === 'text' || type === 'multimodal_text') {
      if (!Array.isArray(required(content, 'parts', `${path}.content`)))
        failure(`${path}.content.parts`, 'type')
    }
    const metadata = obj(required(message, 'metadata', path), `${path}.metadata`)
    keys(metadata, metaKeys, `${path}.metadata`)
    for (const [key, value] of Object.entries(metadata)) {
      const expected = metadataTypes[key]
      const fieldPath = [path, 'metadata', key].join('.')
      if (!expected) failure(fieldPath, 'unsupported')
      const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
      if (
        actual !== expected &&
        !(expected === 'nullable-string' && (actual === 'null' || actual === 'string'))
      )
        failure(fieldPath, 'type')
      if (expected === 'number' && typeof value === 'number' && !Number.isFinite(value))
        failure(fieldPath, 'type')
    }
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

/**
 * Unsupported native payloads lock capture/export for a conversation until a new
 * adapter is released (or the page runtime is restarted with a supported version).
 * No raw message content is included in diagnostics.
 */
export class ArchiveSourceGate {
  #blocked = new Map<string, ArchiveContractFailure>()
  // Synthetic fixtures need an explicit opt-in. Production uses the default false.
  constructor(private readonly allowSyntheticFixtures = false) {}

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
    if (this.allowSyntheticFixtures && detail.sourceUrl.startsWith('fixture://')) return
    try {
      assertHistoryPage(detail, projected)
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
    const fail = (path: string, reason: ArchiveContractFailure['reason']): never => {
      throw this.reject({
        conversationId,
        version: NATIVE_HISTORY_CONTRACT_VERSION,
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
    if (typeof content.content_type !== 'string')
      fail('stream.message.content.content_type', 'type')
    const contentShape = contentKeys[content.content_type as string]
    if (!contentShape) fail('stream.message.content.content_type', 'unsupported')
    allowed(content, contentShape as ReadonlySet<string>, 'stream.message.content')
    if (
      (content.content_type === 'text' || content.content_type === 'multimodal_text') &&
      !Array.isArray(content.parts)
    )
      fail('stream.message.content.parts', 'type')
    if (message.metadata !== undefined) {
      const metadata = object(message.metadata, 'stream.message.metadata')
      allowed(metadata, metaKeys, 'stream.message.metadata')
      for (const [key, value] of Object.entries(metadata)) {
        const expected = metadataTypes[key]
        const observed = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
        if (
          !expected ||
          (observed !== expected &&
            !(expected === 'nullable-string' && (observed === 'null' || observed === 'string')))
        )
          fail(['stream.message.metadata', key].join('.'), 'type')
        if (expected === 'number' && typeof value === 'number' && !Number.isFinite(value))
          fail(['stream.message.metadata', key].join('.'), 'type')
      }
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

  assertCompatible(conversationId: string) {
    const failed = this.get(conversationId)
    if (failed) throw new ArchiveContractError(failed)
  }
}
