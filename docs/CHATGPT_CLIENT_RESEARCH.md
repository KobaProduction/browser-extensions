# ChatGPT client research

This document records client behavior observed in an authenticated `chatgpt.com` desktop session. It separates verified observations from implementation hypotheses.

The research contract is read-only: Booster observes requests and responses initiated by ChatGPT itself. It must not issue private ChatGPT API requests to populate the archive.

## Evidence boundary

Verified observations below were captured from a logged-in Chromium session through browser DevTools/network inspection while opening existing conversations. Message bodies and account credentials are intentionally omitted from this document.

Never commit:

- authorization headers or cookies;
- account/user/session/device identifiers;
- real conversation text;
- private file URLs or signed asset URLs;
- raw response fixtures from a user's account.

Schema examples must use placeholders or synthetic values.

## Conversation navigation

A normal conversation URL has this shape:

```text
https://chatgpt.com/c/{conversation_id}
```

The path identifier is the conversation identifier used by the history endpoint.

When an existing conversation is opened, the current client performs a request with this observed shape:

```http
GET /backend-api/conversations/{conversation_id}?include_has_versions=true&num_turns=10
```

The client may make many unrelated bootstrap/telemetry requests around the same time. Booster must identify conversation-history traffic by route/response shape rather than by assuming a fixed request order.

## Conversation history response

The current response is page-oriented and contains `messages[]`. Older clients used other shapes, including mapping-like trees; Booster must version/feature-detect rather than assume one permanent representation.

Observed top-level keys include:

```text
conversation_id
conversation_origin
conversation_template_id
create_time
current_node
default_model_slug
gizmo_id
gizmo_type
is_archived
is_do_not_remember
is_read_only
is_starred
is_study_mode
is_temporary_chat
memory_scope
messages
moderation_results
owner
page_info
pinned_time
plugin_ids
sectioned_conversation
sugar_item_id
sugar_item_visible
title
update_time
voice
context_scopes
context_truncation_continuation
disabled_tool_ids
safe_urls
blocked_urls
async_status
atlas_mode_enabled
```

Not every field is present or non-null for every conversation.

### Pagination

Observed `page_info` shape:

```json
{
  "start_cursor": "message-or-page-cursor",
  "end_cursor": "message-or-page-cursor",
  "has_previous_page": true,
  "has_next_page": false
}
```

A short conversation can return the complete history in the first response with `has_previous_page=false`.

A long branched conversation was observed with:

```text
has_previous_page = true
has_next_page = false
```

This confirms that the client can load only a suffix of conversation history and later request older pages.

The older-page continuation request has now been observed during normal upward scrolling:

```http
GET /backend-api/conversations/{conversation_id}/messages?before={start_cursor}&include_has_versions=true&num_turns=10
```

The continuation response is slimmer than the initial conversation response. Observed top-level keys are:

```text
messages
page_info
safe_urls
blocked_urls
```

It does not repeat `conversation_id`, title or project/gizmo metadata, so an observer must derive conversation identity from the request URL and merge the page into the already-known conversation envelope rather than replacing metadata with nulls.

## Message record

Observed message records use this common envelope:

```ts
interface ObservedChatGptMessage {
  id: string
  author: {
    role: string
    name?: string | null
    metadata?: Record<string, unknown>
  }
  create_time: number | null
  update_time: number | null
  content: Record<string, unknown>
  status: string
  end_turn: boolean | null
  weight: number
  metadata: Record<string, unknown>
  recipient: string | null
  channel: string | null
}
```

Observed author roles:

```text
system
user
assistant
tool
```

Do not implement a closed role enum in persistent storage. Preserve unknown future values.

## Observed content types

The following `content.content_type` values have been observed in authenticated history responses:

```text
text
multimodal_text
model_editable_context
thoughts
reasoning_recap
multimodal_text
```

### `text`

Observed shape includes a `parts` collection:

```json
{
  "content_type": "text",
  "parts": ["..."]
}
```

Parts must be treated as structured/unknown values rather than assuming they are always plain strings.

### `multimodal_text`

Observed on an older history page. Preserve the full parts/content structure because it can contain mixed text/file/image references and should not be flattened during ingest.

### `model_editable_context`

Observed records can contain fields such as:

```text
model_set_context
repo_summary
repository
structured_context
```

The contents are client-visible conversation context records. Archive them as raw data; do not treat them as user-authored chat text.

### `thoughts`

Observed as a distinct content type associated with reasoning records. Preserve the entire raw object. Rendering and interpretation belong to a later adapter layer.

### `reasoning_recap`

Observed as a distinct content type. It is not equivalent to the final assistant answer and must remain separately addressable in storage.

## Message metadata

Metadata is extensible and must be preserved in full. Fields already observed include the following groups.

### Turn correlation

```text
request_id
turn_exchange_id
working_turn_id
parent_id
message_type
message_source
```

`turn_exchange_id` and `working_turn_id` are useful for grouping records belonging to one user/assistant exchange.

`metadata.parent_id` has been observed on message records and provides graph linkage between messages. Do not assume the visible conversation is a simple linear list.

### Model identity

```text
model_slug
default_model_slug
resolved_model_slug
model_switcher_deny
model_adjustments
```

### Reasoning lifecycle

Observed fields include:

```text
cot_version
reasoning_status
reasoning_start_time
reasoning_end_time
finished_duration_sec
reasoning_titles
reasoning_title
reasoning_recap_type
reasoning_title_content_transition
inline_cot_expandable_content
hide_inline_actions
disable_turn_actions
```

These fields make it possible to distinguish reasoning records and measure/describe their lifecycle without inferring from rendered DOM text.

### Tool-related metadata

Observed fields include:

```text
tool_icons
tool_summary_type
recipient
message_type
```

History responses also contain records whose author role is `tool`.

The exact argument/result representation varies by tool/message type and still needs additional examples. Booster must preserve full raw records so newly discovered tool contracts remain recoverable without refetching the conversation.

### Response completion/rendering metadata

Observed fields include:

```text
finish_details
is_complete
citations
content_references
story_events
code_blocks
search_result_groups
search_queries
image_results
writing_blocks
system_hints
```

These are not guaranteed on every message.

## Branching

A conversation explicitly shown by the ChatGPT UI as a branch was inspected.

Observed branch-related metadata includes:

```text
branching_from_conversation_id
branching_from_conversation_title
branching_from_conversation_owner
```

Message IDs can be reused between a source conversation and its branched conversation. Therefore `message.id` is only unique within the archive when scoped by `conversation_id`; a global message-ID primary key is incorrect.

The branched conversation has its own conversation ID. Therefore archive identity must support both:

1. message-level parent relationships inside a conversation;
2. conversation-level branch origin linking one conversation to another.

Synthetic example:

```json
{
  "conversation_id": "branch-conversation-id",
  "branch_origin": {
    "conversation_id": "source-conversation-id",
    "title": "Source conversation",
    "owner": "owner-placeholder"
  }
}
```

No assumption should be made that branch origin metadata appears at the top level; currently observed values came from message metadata.

## Current node

The response exposes a `current_node` identifier. It should be preserved with each conversation snapshot/page state. It can help identify which branch path is currently selected, but its exact semantics across edits/regenerations still need additional verification.

## Project context

Project behavior has now been observed through the normal ChatGPT UI.

A project URL uses this shape:

```text
https://chatgpt.com/g/{project_id}-{slug}/project
```

Observed project identifiers use the `g-p-...` form. The same identifier is used as the conversation's `gizmo_id`.

Moving an existing conversation into a project through the UI produced:

```http
PATCH /backend-api/conversation/{conversation_id}
Content-Type: application/json

{
  "gizmo_id": "g-p-project-id"
}
```

The observed response was a simple success object. Booster does not need to call this endpoint for archival behavior; this is documented to understand project identity.

After moving the conversation, the normal history endpoint remained unchanged:

```http
GET /backend-api/conversations/{conversation_id}?include_has_versions=true&num_turns=10
```

The history response then exposed:

```text
gizmo_id = project ID
gizmo_type = snorlax
conversation_template_id = project ID
```

No additional project-specific message metadata was observed in that sample. Therefore the normalized archive can derive `projectId` from top-level `gizmo_id` when `gizmo_type`/other evidence identifies a project, while preserving the raw fields for future schema changes.

The project page loads project-scoped conversations through an observed route of this form:

```http
GET /backend-api/gizmos/{project_id}/conversations?cursor=0
```

Project-scoped system-hint requests also carry `gizmo_id={project_id}`. Project connector/source endpoints use the same project identifier.

The archive should treat `gizmo_id` as the currently observed project identity field, but keep the normalized field named `projectId` so the persistence/UI contract does not inherit ChatGPT's internal product terminology.

## Related conversation resources

The client has also been observed requesting conversation-scoped resources such as:

```text
/backend-api/conversation/{conversation_id}/textdocs
/backend-api/bazaar/conversation/{conversation_id}/ads
```

`textdocs` is potentially relevant to archive completeness. Ads are not archive content and should not be persisted as conversation history.

Real image attachment traffic is now classified for the current client. Archived message metadata may expose a stable `file_...` asset identifier. The normal ChatGPT page has been observed rendering the matching bytes from:

```text
GET /backend-api/estuary/content?id={file_id}&...signed query...
```

The signed URL is transient and must be accepted only when its origin/path and `id` match the archived asset. Booster does not synthesize or guess resolver URLs. A live acceptance run verified both expiry/failure handling and a fresh successful JPEG fetch whose byte count and SHA-256 matched the ZIP manifest.

## Live transport

### Verified fresh composer start contract (2026-10-07)

A live external-Playwright experiment on the `Обзор RedmiBook Pro 16` conversation sent one ordinary user message, `продолжить`, through ChatGPT's native composer after the previous stuck/recovery turn had been server-stopped. The Playwright Enter call itself timed out, so it was **not** retried blindly; the resulting DOM and transport evidence proved that the message had already been submitted exactly once.

The fresh start used a two-request sequence.

#### 1. Prepare / preflight

ChatGPT first sent:

```text
POST /backend-api/f/conversation/prepare -> 200
```

The observed request included, among other fields:

```json
{
  "conversation_id": "<conversation_id>",
  "action": "next",
  "model": "gpt-5-6-thinking",
  "parent_message_id": "<previous current node>",
  "thinking_effort": "standard",
  "conversation_mode": {
    "kind": "gizmo_interaction",
    "gizmo_id": "<project gizmo id>"
  },
  "local_function_names": ["local.continue_in_work"],
  "partial_query": {
    "author": { "role": "user" },
    "content": { "content_type": "text", "parts": ["продолжить"] },
    "id": "<prepare-local partial id>"
  },
  "client_prepare_dispatch": "debounced",
  "client_prepare_source": "composer_editor_state"
}
```

The response was:

```json
{
  "status": "ok",
  "conduit_token": "<opaque short-lived token>"
}
```

The conduit token is transport material and must be treated as opaque/sensitive; Booster has no reason to persist or expose it.

The `partial_query.id` used by `/prepare` was **not** the final user message id. Therefore the prepare request is preflight evidence only and must not be used as the authoritative message identity or request-timing boundary.

#### 2. Actual conversation start

ChatGPT then sent:

```text
POST /backend-api/f/conversation -> 200
```

with the actual user message in `messages[0]`. Relevant observed fields were:

```json
{
  "turn_attribution": { "turn_trigger": "composer" },
  "conversation_id": "<conversation_id>",
  "action": "next",
  "parent_message_id": "<previous current node>",
  "model": "gpt-5-6-thinking",
  "thinking_effort": "standard",
  "messages": [
    {
      "id": "<fresh_user_message_id>",
      "author": { "role": "user" },
      "content": { "content_type": "text", "parts": ["продолжить"] },
      "create_time": 1791323726.555,
      "status": "finished_successfully",
      "recipient": "all"
    }
  ],
  "supported_encodings": ["v1"],
  "client_prepare_state": "success"
}
```

The response was a live stream:

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store
X-Conduit-Token: <opaque token>
```

This confirms that ordinary fresh generation in the captured client uses the streamed `/f/conversation` response directly. No new `/f/conversation/resume` or `/conversation/{id}/stream_status` request was emitted for this fresh turn. The only resume/status calls visible in the page log had lower request indices and belonged to the previous recovery incident.

#### Source timing and identity consequence

For Booster, the authoritative fresh-request boundary is the actual user message in the outbound `/backend-api/f/conversation` body:

```text
user message id     = messages[0].id
request start       = messages[0].create_time
conversation        = conversation_id
parent/current edge = parent_message_id
```

`/prepare` must not start the request timer. Its local `partial_query.id` may differ from the final message id. If `messages[0].create_time` is absent, the actual outbound `/f/conversation` transport boundary remains the fallback; the prepare request timestamp is not the fallback.

#### Early renderer state

Immediately after submission the new rendered turn showed:

```text
data-turn-key = <fresh_user_message_id>
data-talvt-turn-state = in_progress
native Stop control = present
```

The turn key matched the final user message id from the main `/f/conversation` payload.

At the same time, the turn still had only the user search-unit; there was no assistant search-unit or `data-chatgpt-selection-message-id` yet. Nevertheless ChatGPT was already rendering activity/reasoning headers and generated progress text inside the turn.

Therefore live request state and request-timer mounting must **not** depend on an assistant search-unit existing. The outbound request/state store is available earlier than the final assistant renderer contract.

#### Booster 0.8.38 stale-timer finding

The inspected tab was still running Booster 0.8.38. After the fresh message started, the native turn correctly changed to the new user id and exposed Stop, but Booster's global request status incorrectly continued the previous stopped/recovery elapsed value (`Запрос 1:17:38`, later `1:19:11`) instead of restarting from the new message's `create_time`.

This is Booster behavior, not ChatGPT behavior. The fresh ChatGPT transport supplied the correct new id and source timestamp. A newer outbound `/f/conversation` request for the current conversation must replace any stale older active run in the live read model/UI; an old DOM turn that still says `in_progress` must not be allowed to re-promote or visually dominate the newer request lifecycle.

Implementation of this defect is tracked in GitHub issue `#29`; the normative supersession rule is documented in `docs/CHATGPT_RUNTIME_CONTRACTS.md`.

### Verified safety-review processing state (2026-10-07)

During the same fresh `продолжить` generation, ChatGPT rendered a new native status inside the active turn:

```text
Наши системы выполняют дополнительную обработку этого запроса, прежде чем предоставить ответ.
```

This was not an error banner. The rendered element was:

```text
role="status"
aria-live="polite"
data-talvt-turn-state="in_progress"  # on the owning turn
```

with a shimmer treatment and a dedicated shield/processing icon. The native Stop-generation control remained present, so generation was still active.

A read-only React-fiber inspection of the rendered native component exposed the source state directly:

```text
conversationId = <current conversation>
requestId      = <fresh_user_message_id>
protectionType = "cyber"
message        = "Наши системы выполняют дополнительную обработку этого запроса, прежде чем предоставить ответ."
```

The `requestId` matched the current fresh user-turn id from the outbound `/backend-api/f/conversation` request.

Reverse-engineering the deployed client stream decoder identified the authoritative event contract:

```json
{
  "type": "safety_review_update",
  "active": true,
  "conversation_id": "<conversation_id>",
  "message": "<user-facing processing message>",
  "protection_type": "cyber"
}
```

The observed schema accepts `protection_type` values `"bio"` or `"cyber"`. The client decoder normalizes this into its internal update type `safety-review` with:

```text
active
conversationId
message
protectionType
```

The stream handler applies that update to the current request state. When `active=true`, the state carries the server-provided `message` and `protectionType`; when `active=false`, the review state is deactivated. Therefore the native status should be treated as a source-driven safety-review phase, not inferred from elapsed time or DOM text.

The same stream decoder also has a separate `moderation` / `safety-access-block` path. That is a distinct contract from `safety_review_update`: an active safety review means additional processing is in progress; it is not itself proof that the request was blocked or failed.

#### Booster consequence

Safety review must be modeled independently from request run-state, reasoning phase and transport health. A request can simultaneously be:

```text
run state        = in_progress
reasoning        = active/idle depending on source records
transport        = healthy
safety review    = active, protectionType=cyber
```

Booster UI/alerts for this state should be driven from the `safety_review_update` stream event. The localized `role="status"` DOM is corroborating presentation evidence only and must not be the classifier.

#### Observed review completion

A later passive read of the same fresh turn found the safety-review `role="status"` completely absent and no native error alert present. The turn still rendered as `data-talvt-turn-state="in_progress"` at that observation boundary. This proves that the review presentation can end independently of the overall request lifecycle.

The inspected client contract deactivates review state from `safety_review_update` with `active=false`. The exact deactivation SSE packet was not separately captured from the live stream, so the evidence boundary is: the UI transition was observed directly and the `active=false` mechanism is client-code confirmed, but that specific frame was not captured live.

### Verified post-review stream completion with stale renderer (2026-10-07)

A follow-up observation of the same fresh turn captured a distinct state after the `cyber` safety-review presentation disappeared.

Before reload, the active safety-review `role="status"` was gone, no native alert was present, and the native Stop-generation control was also absent. The rendered turn nevertheless still exposed `data-talvt-turn-state="in_progress"`, while Booster 0.8.38 continued counting the request timer. No new `/f/conversation`, `/f/conversation/resume`, or repeating recovery traffic appeared in that quiet interval.

A later context-change preflight was observed:

```text
POST /backend-api/f/conversation/prepare -> 200
client_prepare_source = "context_change"
client_prepare_dispatch = "immediate"
```

It contained no `partial_query` and did not start a new `/f/conversation`; this was transport/context preparation rather than a new user run.

Reloading the same conversation provided authoritative server evidence for the quiet state:

```text
GET /backend-api/conversations/{conversation_id}?num_turns=10... -> 200
async_status = null
current_node = <last persisted thoughts record>
page_info.has_next_page = false
```

The matching stream-status query returned:

```json
{ "status": "COMPLETE" }
```

At the same time, ChatGPT's renderer still marked the latest turn `data-talvt-turn-state="in_progress"`, the native Stop control was absent, and no status/alert was displayed.

This proves another source/DOM contradiction:

```text
server async status = inactive (null)
server stream status = COMPLETE
native Stop          = absent
renderer turn state  = in_progress   # stale/non-authoritative
```

For Booster, `stream_status=COMPLETE` is terminal source evidence and must stop the active request timer. An explicitly inactive `async_status` in a current conversation payload also prevents stale message/renderer state from reopening that run. The DOM `in_progress` value is presentation residue in this scenario, not evidence that generation is still executing.

The exact wall-clock moment at which the server changed to `COMPLETE` was not captured before reload. For live timing, the preferred boundary is the streamed `message_stream_complete` / `main_stream_complete` event when observed. A later `stream_status=COMPLETE` response is a source-confirmation fallback and must not overwrite an earlier, more precise final-message or stream-completion timestamp.

### Verified conversation-length exhaustion UI (2026-10-07)

An almost-full conversation was intentionally driven with one very large full-project report request to capture the context/conversation-length terminal state.

The fresh request itself started normally:

```text
POST /backend-api/f/conversation/prepare -> 200
POST /backend-api/f/conversation         -> 200 (SSE)
```

The answer then streamed a very large response (roughly 48k visible characters in the rendered turn) before ChatGPT terminated the turn and rendered a native error callout.

Direct live UI/DOM evidence:

```text
turn state = complete
native Stop control = absent
role="alert"
primary CTA = "Начать новый чат"
```

Russian localized message:

```text
Вы достигли максимальной длины этого обсуждения, но можете продолжить обсуждение, начав новый чат.
```

The alert was rendered as ChatGPT's ordinary inline conversation error component (`type="error"`) and its parent response-error component held the current `conversationId`, the same error message, retry wiring, and `useDefaultModel=false`.

#### Client-code classification

The deployed client bundle contains `conversation_too_large` in the recognized conversation error-code taxonomy:

```text
conversation_not_found
history_disabled_conversation_not_found
history_disabled_conversation_expired
conversation_deleted
model_cap_exceeded
conversation_too_large
work_usage_limit_exceeded
...
```

The client explicitly groups `conversation_too_large` with conversation-not-found/deleted/expired errors for the **Start new chat** path. The UI component used for these errors renders the CTA whose client description states that it opens a new conversation when the original conversation was deleted, expired, too large, or could not be found.

The retry/continuation selector also special-cases `conversation_too_large`, including a distinct work-conversation continuation path where available.

This makes `conversation_too_large` the client-code-confirmed semantic category that matches the captured maximum-length UI.

#### Evidence boundary

The browser network inspector did not retain the completed SSE response body for this live request, so the exact SSE frame carrying `errorCode="conversation_too_large"` was **not directly captured** in this incident.

Therefore classify the evidence precisely:

- native maximum-length alert + Start-new-chat CTA + terminal turn: **direct live evidence**;
- `conversation_too_large` taxonomy and Start-new-chat handling: **client-code confirmed**;
- exact live frame connecting this particular alert instance to that code: **strongly correlated but not directly captured**.

Do not build Booster detection from the Russian/English localized text alone. Prefer the source error code/metadata once the observer captures the corresponding stream error/event contract.

#### Booster consequence

Conversation-length exhaustion is a critical terminal condition distinct from:

- normal autonomous response completion;
- user-confirmed Stop;
- model usage/cap exhaustion;
- transient recovery/polling fallback;
- `Resume stream unavailable`;
- generic network error;
- safety review/moderation.

It should have its own normalized runtime cause/state and a dedicated high-priority alert policy. The requested product behavior is tracked in issue `#32`: a conspicuous repeated alarm for roughly 2–3 seconds, deduplicated to one alarm per exhaustion boundary.

### Verified exhausted-chat continuation, new-chat creation, branch API, and rename (2026-10-07)

After capturing the native maximum-conversation-length terminal state, the `Start new chat` CTA was exercised end-to-end. This exposed an important distinction: **the exhausted-chat continuation CTA is not the same mechanism as ChatGPT's native branch API.**

#### Exhausted CTA: stage 1 — open a new project-chat draft

The native `Start new chat` action navigated the **same browser tab** to the ChatGPT root rather than immediately creating a persisted conversation.

The client first initialized a new unsaved project chat:

```text
POST /backend-api/conversation/init -> 200
```

Observed request shape:

```json
{
  "conversation_id": null,
  "conversation_origin": null,
  "gizmo_id": "<project_id>",
  "requested_default_model": null,
  "system_hints": null,
  "timezone": "<local timezone>",
  "timezone_offset_min": "<offset>"
}
```

ChatGPT then prepared a draft through:

```text
POST /backend-api/f/conversation/prepare -> 200
```

Relevant fields:

```json
{
  "action": "next",
  "parent_message_id": "client-created-root",
  "conversation_mode": {
    "kind": "gizmo_interaction",
    "gizmo_id": "<project_id>"
  },
  "gizmo_id": "<project_id>",
  "partial_query": {
    "author": { "role": "user" },
    "content": {
      "content_type": "text",
      "parts": ["<last user prompt from exhausted conversation>"]
    },
    "id": "<temporary prepare id>"
  },
  "client_prepare_dispatch": "immediate",
  "client_prepare_source": "composer_editor_state"
}
```

The root UI presented a composer labelled as a **new chat inside the same project**, prefilled with the last user prompt from the exhausted conversation.

At this stage:

- no new `/f/conversation` submission had occurred;
- no server conversation id had been allocated;
- no `source_conversation_id` was present;
- no `boundary_message_id` was present;
- no parent from the exhausted conversation graph was present;
- the project/gizmo association was preserved.

Therefore this stage is a draft continuation convenience, not persisted branching of the old message graph.

#### Exhausted CTA: stage 2 — actual new conversation creation

A persisted conversation was created only when the prefilled draft was actually submitted. The client then sent:

```text
POST /backend-api/f/conversation -> 200
```

Relevant creation payload:

```json
{
  "turn_attribution": { "turn_trigger": "composer" },
  "action": "next",
  "parent_message_id": "client-created-root",
  "conversation_mode": {
    "kind": "gizmo_interaction",
    "gizmo_id": "<project_id>"
  },
  "gizmo_id": "<project_id>",
  "messages": [
    {
      "id": "<new user message id>",
      "author": { "role": "user" },
      "create_time": "<new source timestamp>",
      "content": {
        "content_type": "text",
        "parts": ["<copied exhausted-chat prompt>"]
      }
    }
  ],
  "client_prepare_state": "success"
}
```

Crucially, the observed body had **no `conversation_id`**. The server allocated the new conversation id as part of this first submission and the client then navigated to the new `/c/<id>` route.

The observed request still had no `source_conversation_id`, `boundary_message_id`, or old-message parent. Thus the exhausted CTA is verified as:

```text
exhausted conversation
  -> Start new chat
  -> root/project draft with last user prompt copied
  -> first normal /f/conversation submission
  -> server allocates a new conversation id
```

It is **not** the true `new_branch` transport contract described below.

#### Temporary title synchronization difference

Immediately after creation, the active conversation page displayed an automatically generated title, while the project conversation list still temporarily showed the generic `New chat` / localized `Новый чат` entry with the prompt preview. This proves that active-page title presentation and project-list cache synchronization can be temporarily out of phase.

Do not infer persisted title state solely from `document.title` or one renderer surface. Observe the conversation metadata/list update contract when title correctness matters.

#### True native branch API — client-code confirmed

The deployed client contains a distinct branch method:

```text
POST /backend-api/conversation/new_branch
```

with request body:

```json
{
  "conversation_id": "<source conversation id>",
  "message_id": "<branch boundary message id>"
}
```

The client receives a new `conversation` object and also generates a fresh local `clientThreadId` for the branch operation.

This branch endpoint was identified directly in the deployed client code, but was **not live-executed in this particular capture**. Evidence level: client-code confirmed, not live-accepted yet.

#### Native chat rename — live verified

The deployed client rename function trims the requested title and no-ops on an empty title or a title identical to the previous value. A real rename was then performed through the native project conversation-list UI.

Native dialog contract observed:

```text
Dialog title: Rename chat / Переименовать чат
Input aria-label: Chat title / Название чата
Placeholder: Add a title… / Добавьте название…
Actions: Cancel / Save
```

The default unsynchronized list entry displayed localized `Новый чат`, while the rename input's underlying value was `New chat`, another indication that default-title presentation may be localized separately from stored/default source text.

Saving the new title emitted exactly:

```text
POST /backend-api/conversation/id/{conversation_id}/rename -> 200
```

with body:

```json
{
  "title": "<new title>"
}
```

and response:

```json
{
  "success": true
}
```

The project conversation list updated immediately to the new title after the successful response.

Client code also shows that successful rename updates local conversation/query/search caches and supports undo/redo through the title transition queue when a previous title is known.

#### Runtime consequences

Treat these as three separate operations:

```text
exhausted Start-new-chat continuation
    = new root draft + copied last user prompt + normal first submission

true branch
    = POST /conversation/new_branch with source conversation + boundary message

rename
    = POST /conversation/id/{conversation_id}/rename with {title}
```

Do not infer a branch merely because old content remains temporarily visible during route transition, and do not infer persisted title state from a single UI surface.

### Verified native Stop-generation contract (2026-10-07)

A live external-Playwright experiment on the same `Обзор RedmiBook Pro 16` conversation reloaded the page, waited for ChatGPT to restore the active generation/recovery state, and then invoked the native Stop control once. No other ChatGPT controls were clicked during the experiment.

#### Native control signature

In the observed renderer the active composer Stop control was:

```html
<button aria-label="Остановить">…</button>
```

It did **not** carry the older `data-testid="stop-button"` / `data-testid="stop-generation"` signatures. Therefore Stop-button discovery is renderer/version dependent and must remain behind the ChatGPT DOM adapter if Booster needs the native control as corroborating UI evidence.

Immediately before the click, the affected turn still exposed `data-talvt-turn-state="in_progress"`.

#### Transport request

The native click caused exactly this ChatGPT request:

```http
POST /backend-api/stop_conversation
Content-Type: application/json
```

with body:

```json
{
  "conversation_id": "<conversation_id>",
  "exclude_async_types": []
}
```

The observed response was HTTP `200` with:

```json
{
  "status": "ok",
  "last_message_id": null
}
```

No client-synthesized Booster request was involved; this was the request emitted by ChatGPT's own native Stop action.

#### Immediate and delayed effects

Immediately after the successful response:

- the native `Остановить` button disappeared;
- Booster 0.8.38 removed its request-status timer because the transport-confirmed stop event had completed;
- no native error alert was visible;
- the affected DOM turn still remained `data-talvt-turn-state="in_progress"`.

A later passive read roughly one minute after the click still found that same DOM turn marked `in_progress`, while the native Stop button and Booster request timer remained absent. This directly proves that ChatGPT's rendered turn-state can remain stale after a server-confirmed stop and must not be used as the authoritative stop boundary.

The recovery loop that had been active before the click did not stop at the exact same instant as the `200` response. One final recovery pair was observed after the Stop request:

```text
GET /backend-api/conversation/{conversation_id}/stream_status -> net::ERR_ABORTED
GET /backend-api/conversations/{conversation_id}?num_turns=10... -> 429
```

After that pair, no new repeating `stream_status` polling was observed during the follow-up window. This is consistent with cancellation/cleanup propagating through already-started recovery work rather than retroactively preventing an in-flight polling iteration.

#### Proven lifecycle consequence

For native Stop, Booster should model:

```text
outbound POST /stop_conversation
  -> stop_requested
HTTP 2xx response { status: "ok", ... }
  -> stopped
```

The DOM Stop-button disappearance is useful corroboration but is not the confirmation source. `data-talvt-turn-state` is explicitly non-authoritative for this transition because it remained `in_progress` after the server had already confirmed the stop.

The observed `last_message_id:null` means this specific stopped recovery turn did not produce a new terminal message identifier in the Stop response. Do not assume every successful Stop response will always carry `null`; the field should be recorded as server evidence rather than hard-coded as a constant.

The existing MAIN-world observer can see:

- `fetch`;
- XHR;
- WebSocket;
- EventSource;
- streamed fetch response chunks when body capture is enabled.

Authenticated sessions have shown both ordinary HTTP/fetch traffic and WebSocket traffic. Conversation generation uses streamed HTTP responses in observed sessions; WebSocket traffic also exists for other client functions.

Archive ingestion must be route/content aware. Do not interpret every WebSocket or SSE message as conversation history.

### Verified recovery fallback: `Connection interrupted. Waiting for the complete answer` (2026-10-07)

A live external-Playwright capture in the `Анализ RUSH 11` tab observed a distinct non-terminal recovery state rendered inside the active turn:

```text
Соединение прервано. Ожидание полного ответа
```

The native DOM shape was:

```html
<div role="status" class="...">
  <span class="text-chatgpt-recovery">…</span>
</div>
```

At the capture boundary:

- the owning turn still rendered `data-talvt-turn-state="in_progress"`;
- the native Stop-generation control was present;
- there was no `role="alert"` terminal error;
- Booster's request-status timer was absent in the inspected 0.8.38 runtime.

The deployed client bundle identifies this exact UI as `errors.network.reconnecting_fallback` with the English default message:

```text
Connection interrupted. Waiting for the complete answer
```

and describes it as an informational notice shown when the network connection drops mid-response and the client falls back to a simpler polling implementation.

This is therefore a **recovery-in-progress** state, not a terminal failure. It should be modeled separately from both healthy streaming and final recovery errors such as `Resume stream unavailable` or the generic network-error alert.

The corresponding recovery conversation continued polling `/conversation/{id}/stream_status`; multiple late successful polls returned:

```json
{ "status": "IS_STREAMING" }
```

while other polls in the same recovery episode had already begun failing with `net::ERR_ABORTED`. This matches the client's documented fallback behavior: the live connection is lost, but the server still reports the turn as streaming, so the client waits for completion via polling.

One capture also showed a route/state identity mismatch: the browser URL contained one conversation id while the native recovery component's React props referenced a different conversation id that matched the active `stream_status` polling series. This mismatch is direct evidence, but its semantics are **not yet proven**. It may represent an internal handoff/canonical id or stale client state; do not encode either explanation without additional evidence.

#### Runtime consequence

For Booster, this state should map to transport/recovery health such as `recovering` / `polling_fallback`, while the logical run may remain `in_progress`. The localized `role="status"` text is corroborating presentation only. Classification should come from transport/recovery evidence when the exact source signal is available.

### Verified stream-recovery failure: `Resume stream unavailable` (2026-10-07)

A live external-Playwright inspection of the ChatGPT tab titled `Обзор RedmiBook Pro 16` captured a real recovery failure state without clicking, retrying, scrolling or reloading the page.

Directly observed UI/DOM facts:

- ChatGPT rendered a native `aside[role="alert"]` containing `Resume stream unavailable` and a `Повторить` action.
- The affected conversation turn still exposed `data-talvt-turn-state="in_progress"`.
- The native Stop-generation control was absent.
- Booster 0.8.37 still displayed the request/reasoning timers (`Запрос 51:23`, `Размышление 51:20`) because the old lifecycle model treated `in_progress` as sufficient evidence that generation was still healthy.

Directly observed transport/console facts from the same tab/session:

- the ChatGPT WebSocket connection to `wss://ws.chatgpt.com/...` failed before establishment;
- `POST /backend-api/f/conversation/resume` returned HTTP `404`;
- an ordinary `POST /backend-api/f/conversation` also produced `net::ERR_HTTP2_PROTOCOL_ERROR` in the same page session;
- repeated conversation refresh requests were also observed returning `429` in that session.

The deployed ChatGPT client chunk (`cdn/assets/7078.b973546175.js`, observed build on 2026-10-07) independently confirms the recovery pipeline:

```text
GET  /backend-api/conversation/{conversation_id}/stream_status
POST /backend-api/f/conversation/resume
GET  /backend-api/celsius/ws/user          -> returns the WebSocket URL
```

The recovered client logic distinguishes at least these stream-status / recovery outcomes:

```text
IS_STREAMING
COMPLETE
FAILURE
UNAVAILABLE          # client maps stream_status HTTP 404 to this value
stream_failure       # FAILURE when no terminal recovered message is available
unconfirmed          # recovery/polling could not prove the terminal result
```

A `410` completion-stream error with `errorCode="persisted_final_available"` is handled specially: the client treats the final response as already persisted and attempts to recover it from conversation data instead of requiring the original stream.

The client also contains user-facing/internal error taxonomy including:

```text
tokenless_resume_unavailable
network_error
network_error_with_reconnection
recovery_unconfirmed
recovery_terminal
```

and retries resume transport through `/f/conversation/resume` with a bounded backoff policy before falling back to recovery polling.

#### What is proven

The live `Resume stream unavailable` state can coexist with a turn that still says `in_progress`. Therefore `data-talvt-turn-state="in_progress"` alone is **not** proof that ChatGPT still has a healthy live generation stream.

For the captured incident, the user-facing alert coincided with a failed WebSocket path and a `404` response from `/f/conversation/resume`. This is sufficient to classify the incident as a stream-recovery/resume failure rather than normal generation.

#### Reload reproduction and long-wait mechanism

The same conversation was then reloaded without clicking Retry or any other ChatGPT control. The failure reproduced as a long-lived recovery state rather than an immediate terminal error.

The first normal conversation load after reload returned HTTP `200` with these relevant fields:

```text
async_status = 3
current_node = <last persisted thoughts record>
page_info.has_next_page = false
```

The deployed client enum in the inspected build maps:

```text
STREAMING           = 3
UNREAD              = 4
REALTIME            = 5
REALTIME_BUSY       = 6
REALTIME_BACKGROUND = 7
```

Therefore the initial payload itself tells the client that the conversation is still `STREAMING`. The `current_node` in this capture pointed to a persisted `thoughts` record whose metadata contained `reasoning_status="is_reasoning"`; there was no later final assistant answer in the returned current page, and `has_next_page=false` showed that this was the current tail rather than a locally truncated newer page.

After that reload ChatGPT automatically attempted stream recovery:

```text
POST /backend-api/f/conversation/resume -> 404
```

The captured response body was:

```json
{
  "detail": {
    "message": "A network error occurred. Please check your connection and try again.",
    "code": "tokenless_resume_unavailable"
  }
}
```

This proves that the reproduced recovery path reaches the internal `tokenless_resume_unavailable` error code. The client then repeatedly polled:

```text
GET /backend-api/conversation/{conversation_id}/stream_status -> 200
{ "status": "IS_STREAMING" }
```

Multiple consecutive polls returned `IS_STREAMING`; later polls in the same recovery loop were observed aborting with `net::ERR_ABORTED`, with occasional later successful `IS_STREAMING` responses again. Conversation refresh requests also began returning `429` repeatedly.

During this entire post-reload observation window:

- the native `Resume stream unavailable` alert disappeared immediately after reload and had not yet reappeared;
- the affected turn remained `data-talvt-turn-state="in_progress"`;
- the native Stop-generation control remained absent;
- Booster 0.8.38 continued the original source-derived timers past one hour because the run lifecycle had no separate transport-health state.

This establishes the long-wait mechanism: the persisted conversation and `stream_status` continue to claim `STREAMING` even after `/f/conversation/resume` is no longer available. ChatGPT therefore enters a polling/recovery loop instead of immediately converting the turn to a terminal error.

#### Recovery exhaustion -> native network error

Continued passive observation of the same reloaded tab captured the next stage of the same recovery loop. After roughly another few minutes, ChatGPT rendered a native `aside[role="alert"]` on the same affected turn with:

```text
A network error occurred. Please check your connection and try again.
```

and a `Повторить` action.

At that instant:

- the affected turn still exposed `data-talvt-turn-state="in_progress"`;
- the native Stop-generation control was still absent;
- Booster 0.8.38 still rendered the old source-derived request/reasoning timers (`Запрос 1:03:35`, `Размышление 1:03:32`);
- `/f/conversation/resume` had not been retried after its earlier `404 tokenless_resume_unavailable` response;
- the recovery loop continued to issue paired conversation-refresh and `stream_status` reads.

The deployed client recovery code explains this delayed transition. Each recovery iteration performs the conversation refresh and `stream_status` request together with `Promise.all`. A rejected iteration increments an internal failure counter `F`; once `F >= 30`, the client records recovery failure and forwards the original completion error out of the polling fallback.

The same live network log, measured after the reload, contained:

```text
30 x GET /backend-api/conversations/{conversation_id}?num_turns=10... -> 429
29 x GET /backend-api/conversation/{conversation_id}/stream_status -> net::ERR_ABORTED
13 x GET /backend-api/conversation/{conversation_id}/stream_status -> 200
```

The paired-request structure is important when interpreting those numbers. A `429` from the conversation refresh can reject the `Promise.all`; the iteration's `finally` then aborts the shared per-attempt controller, which can make the still-pending companion `stream_status` request appear as `net::ERR_ABORTED`. Therefore the 29 aborted `stream_status` calls should not automatically be treated as 29 independent root network failures.

The observed count reaches the client's documented recovery error budget (`F >= 30`) exactly through the repeated `429` refresh failures. This is consistent with, and now strongly explains, why the generic network-error alert appeared only after a long delay rather than immediately after the first resume failure.

The same client bundle contains the generic network-error message in its network error classifier and, on recovery-budget exhaustion, forwards the original recovery error while attaching diagnostics from the last polling failure. In this reproduced case the original resume failure was already captured as:

```json
{
  "detail": {
    "message": "A network error occurred. Please check your connection and try again.",
    "code": "tokenless_resume_unavailable"
  }
}
```

Thus the end-to-end sequence for this incident is now supported as:

```text
persisted conversation says STREAMING
  -> tokenless resume attempt
  -> /f/conversation/resume = 404 tokenless_resume_unavailable
  -> recovery polling while stream_status still says IS_STREAMING
  -> repeated paired polling failures / 429s
  -> recovery error budget reaches 30
  -> native generic network-error alert + Retry action
```

This does **not** prove that every generic `A network error occurred` alert in ChatGPT has this cause. It proves this cause for the captured recovery incident.

### Verified native Stop during recovery (2026-10-07)

The same affected conversation was reloaded once more and the native Stop-generation control was activated almost immediately after ChatGPT restored the still-streaming turn. No Retry action or other conversation mutation was performed first.

The click produced the normal ChatGPT stop request:

```text
POST /backend-api/stop_conversation
```

with request body:

```json
{
  "conversation_id": "<conversation_id>",
  "exclude_async_types": []
}
```

The server replied HTTP `200` with:

```json
{
  "status": "ok",
  "last_message_id": null
}
```

This is direct evidence that a user stop is acknowledged by the dedicated stop endpoint; the native button itself is only the UI trigger. `last_message_id=null` is valid for this recovery/stale-stream case and must not be interpreted as stop failure when the response status is `ok`.

Observed immediately after the stop acknowledgement:

- the native Stop-generation control disappeared;
- Booster's request-status mount disappeared under its transport-confirmed stop handling;
- no native error alert was present;
- the affected turn still remained `data-talvt-turn-state="in_progress"` in the rendered DOM.

The recovery request sequence around the stop was also informative. The stop call appeared as request `242`; one final paired recovery attempt followed in the captured ordering:

```text
243  GET /backend-api/conversation/{id}/stream_status          -> ERR_ABORTED
244  GET /backend-api/conversations/{id}?num_turns=10...       -> 429
```

After that pair, no further conversation-recovery polling appeared during the following observation window (approximately 30 seconds). This supports that the confirmed stop cancels/terminates the active recovery loop even though the renderer's `data-talvt-turn-state` attribute can remain stale as `in_progress`.

The exact causal ownership of requests `243/244` is not proven from ordering alone: they may already have been in flight or scheduled as the stop was acknowledged. Do not treat them as evidence that Stop intentionally starts another recovery poll. The important observed boundary is that polling did not continue after that final pair.

#### Stop lifecycle consequence

For Booster, a successful `POST /backend-api/stop_conversation` response is stronger evidence than native DOM turn state. The correct lifecycle remains:

```text
outbound stop request -> stop_requested
HTTP success/status=ok -> stopped
```

The timer and active-generation UI should end on confirmed stop even if ChatGPT's renderer still exposes the old turn as `in_progress`. Conversely, the disappearance of the Stop button alone is not sufficient confirmation without the transport response.

#### What is not yet proven

The reproduced recovery request now proves that `/f/conversation/resume` returns `code="tokenless_resume_unavailable"` in this failure path. However, the exact one-to-one mapping from the literal rendered alert text `Resume stream unavailable` to that code has still not been observed in the same post-reload instant: the alert disappeared on reload and had not reappeared during the observation window. Treat the code and alert as strongly correlated parts of the same reproduced recovery scenario, but do not encode the literal-text mapping as the sole classifier.

Likewise, the repeated `429` conversation-history/list failures and the `ERR_HTTP2_PROTOCOL_ERROR` were observed in the same page session, but they are not yet proven to be the direct trigger for the recovery failure.

#### Booster design consequence

Generation lifecycle and transport health must be modeled separately. A conversation can be logically `in_progress` while its realtime transport is reconnecting, unavailable or failed. Booster must not infer healthy execution, long-running work, completion sounds or stuck-request warnings solely from native DOM turn state or from the presence/absence of the Stop button.

Transport/recovery classification should be driven by the documented API/WebSocket evidence above. DOM alerts are useful for acceptance verification and presentation correlation, but they are not the primary source of truth for the recovery state.

## Verified product-operation flows (2026-10-07)

This section records one live end-to-end acceptance run covering project lifecycle, project-chat lifecycle, model/reasoning selection, Automations, and Koba MCP Bridge management. Stable implementation guidance is summarized in `docs/CHATGPT_PRODUCT_OPERATIONS.md`.

### Structured user-input question during automation setup — live verified

During a natural-language request to create a daily news summary, the model first requested missing preferences with a structured question.

This capture proved that the rendered question was **GenUI `ask_user_input`, not native agent `request_user_input`**.

The initial fresh submission carried:

```text
suggested_automation_type = daily_brief
force_genui_prefetch      = ask_user_input
model                     = gpt-6-astra-wm
thinking_effort           = standard
```

The assistant completed its source turn successfully with `end_turn=true` and emitted ordinary answer text plus an `ask_user_input` GenUI payload containing a `multi_select` question, options and free-text placeholder.

The native UI rendered:

```text
Waiting for your answer / Ожидание вашего ответа
structured checkbox form
free-text field
Submit button
```

Selecting one option and submitting it produced a new `/f/conversation` request whose message was an ordinary user message. Relevant live request fields:

```text
conversation_id      = <same conversation>
parent_message_id    = <assistant message containing the GenUI question>
model                = gpt-6-astra-wm
thinking_effort      = standard
messages[0].role     = user
messages[0].metadata.message_submission_source = ask_user_input
```

The selected answer was serialized as visible text in the form:

```text
> <question>
<selected answer>
```

The persisted conversation graph confirmed a new user `turn_exchange_id` for this answer. The subsequent model turn then called the automation create tool and received a successful tool result before producing the final confirmation message.

This gives a direct end-to-end correlation chain:

```text
assistant GenUI source message
  -> parent_message_id on answer turn
  -> message_submission_source=ask_user_input
  -> model continuation
  -> downstream tool call/result
```

#### Distinct native `request_user_input` contract

The deployed client separately implements native agent `request_user_input`. Its pending metadata schema includes:

```text
request_id
question_ids[]
status = pending
is_blocking?
expires_at?
```

For this native path the user response is generated as a **tool message**, not a normal user message:

```text
author.role = tool
author.name = request_user_input
channel = commentary
metadata.codex_request_user_input_response.request_id = <original request_id>
```

The answer object is keyed by the original `question_ids`, and `reasoning_group_id` is retained when supplied by the native request. Non-blocking requests can cross an expiry boundary through:

```text
POST /conversation/{conversation_id}/messages/{message_id}/request_user_input/snooze
```

The automation preference question in this capture used the GenUI path; the native submit
path was later accepted live in the dedicated experiment below.

Implementation consequence: do not classify structured questions by UI appearance. Use source widget/metadata and protocol-specific correlation keys.

### Native `request_user_input` answer — live verified (2026-10-07)

A dedicated conversation explicitly requested one native `request_user_input`
single-select question with two options and required the model to wait for the answer.

Before selection, the native UI showed:

```text
Waiting for your answer
single-select radio group
free-text alternative
Skip
```

The active React request object and top-level persisted message metadata both exposed a
pending `codex_request_user_input` with one `question_id` and
`is_blocking=true`. The pending source message itself was:

```text
author.role = tool
author.name = request_user_input
recipient = assistant
channel = commentary
end_turn = true
```

A nested metadata copy under
`content_references[].data.codex_request_user_input` simultaneously retained
`is_blocking=false` and an `expires_at`. No
`/request_user_input/snooze` request was present in the captured page network log.
This proves the copies can diverge; it does not prove why. For current interaction state,
the top-level metadata and active native request object matched the UI and are the
stronger evidence.

Selecting the second radio option immediately resumed the model. The browser-automation
call timed out at the MCP boundary, so it was not retried; the changed DOM and a new
successful request proved the click had already executed once.

The continuation request was:

```text
POST /backend-api/f/conversation -> 200
```

with:

```text
parent_message_id = <native request tool-message id>
model = gpt-6-astra-wm
thinking_effort = standard
messages[0].author.role = tool
messages[0].author.name = request_user_input
messages[0].recipient = all
messages[0].channel = commentary
```

The tool-message content serialized:

```json
{
  "answers": {
    "<question id>": {
      "answers": ["<selected option>"]
    }
  }
}
```

and its metadata carried the same request id under
`codex_request_user_input_response.request_id`.

The continuation completed normally and the final assistant response acknowledged the
selected option.

After completion, a native page reload produced another important observation: the
server history response no longer contained either the pending native tool request or
the submitted tool-response message as standalone records. Instead, the preceding
reasoning record had been rewritten with:

```text
inline_cot_expandable_content.questions[0].question = <question>
inline_cot_expandable_content.questions[0].answers = [<selected answer>]
```

and the final assistant record followed it normally. The continuation used a new
`turn_exchange_id` while retaining the original `working_turn_id`.

Evidence consequence: the live `/f/conversation` request is the lossless authoritative
answer record for native `request_user_input`. Later history can compact the interaction
into reasoning presentation metadata, so an archive that only hydrates after the fact
cannot reconstruct the original native request/response envelope exactly.

### Project memory availability and Instructions settings — mixed live/client-code evidence

A later Project creation/settings capture exposed two separate memory layers.

With account-level Memory disabled, opening the create-project `Default memory` control rendered only an informational item stating that Memory is off and must be enabled in Settings to use it in Projects. No alternate project-memory modes were selectable in that state.

A project was then created with the normal default request:

```json
{
  "memory_scope": "unset"
}
```

The returned project resource nevertheless carried project-level fields equivalent to:

```text
memory_enabled = true
memory_scope   = global
```

After creation, Project Settings rendered:

```text
Memory
Default
Project can access memory from other chats, and vice versa. This cannot be changed.
```

This is not a contradiction if the fields are modeled at the correct levels: the server resource records the project's configured/default memory policy, while the account-level Memory setting controls whether the feature is currently available to the user. Do not collapse them into one boolean.

The same Project Settings dialog exposed an `Instructions` textarea for project-scoped response context.

Deployed client code confirmed persistence through:

```text
PATCH /backend-api/projects/{project_id}
```

with body fields:

```text
emoji
instructions
memory_scope
name
theme
```

The client first fetches current project data, computes changed fields, and then PATCHes a complete effective settings body. Ordinary instructions/name/icon/theme edits pass `memory_scope=null`, preserving the existing memory mode.

A bounded live attempt to discover the native UI commit trigger found that the textarea is **not simple autosave**: typing instructions and then closing the dialog, blurring, waiting, or pressing `Ctrl+Enter` emitted no project PATCH, and reopening showed the original empty instructions. The exact native submit trigger remains unverified in this capture and must not be invented.

### Project creation — live verified

A temporary test Project was created through the native `Add new project` flow. The dialog exposed project name, icon/color and memory configuration.

Creation emitted:

```text
POST /backend-api/projects -> 200
```

with the observed shape:

```json
{
  "emoji": null,
  "instructions": "",
  "memory_scope": "unset",
  "name": "<temporary project name>",
  "theme": null
}
```

The response allocated a new project/gizmo resource and the client navigated to its project route. With the default memory choice, the server resolved the effective project memory configuration rather than treating request `memory_scope="unset"` as disabled memory.

### Project-chat create and ping/pong — live verified

The first user message in the empty project was `ping`. The project did not use a separate chat-create REST mutation; it used the normal prepare + fresh `/f/conversation` submission carrying the project/gizmo context. The server allocated a new conversation id and the assistant returned `pong`.

### Model/reasoning selector — live verified

The Chat model picker contained a five-position reasoning-power control. Accessibility announcements exposed:

```text
Instant       = 1 of 5
Medium        = 2 of 5
High          = 3 of 5
Very High     = 4 of 5
Pro           = 5 of 5
```

Each position was selected and followed by a short message. Actual outbound `/f/conversation` payloads proved:

```text
Instant    -> model gpt-5-6,          thinking_effort omitted
Medium     -> model gpt-5-6-thinking, thinking_effort standard
High       -> model gpt-5-6-thinking, thinking_effort extended
Very High  -> model gpt-5-6-thinking, thinking_effort max
Pro        -> model gpt-6-pro,        thinking_effort omitted
```

This proves that the top `Pro` position changes the transport model family; it is not simply another GPT-5.6 thinking-effort string.

### GPT-6 Pro sub-agent test — negative live result

While the transport was verified as `gpt-6-pro`, a prompt explicitly requested 4–6 independent parallel sub-agents with trivial independent tasks.

The turn entered `in_progress`, and a generic in-progress tool record appeared while the model inspected capabilities. No child-agent conversation/thread records and no dedicated browser `subagent` endpoint appeared.

The final answer explicitly reported that no mechanism for launching sub-agents was available in the current ordinary Chat surface, and that `0 / 6` requested sub-agents had been launched. The main model performed the trivial arithmetic itself.

Evidence boundary: this is a negative result for the tested ordinary Chat surface/build only. Work/Codex/future surfaces remain separate questions.

### Automations — one-time reminder and condition watch

Two test automations were created through natural-language requests in the same chat.

The one-time reminder persisted with:

```text
timing_mode = exact_schedule
executor = cloud
thread_mode = existing_chat
schedule = one-shot VEVENT DTSTART
```

The hourly incident watch persisted with:

```text
timing_mode = condition_watch
executor = cloud
thread_mode = existing_chat
schedule = VEVENT + RRULE:FREQ=HOURLY
```

Native task persistence was read through:

```text
GET /backend-api/automations?filter=scheduled&limit=...
GET /backend-api/automations?filter=paused&limit=...
GET /backend-api/automations?filter=finished&limit=...
```

The inspected client recognizes automation tool operations `create`, `update`, `run_now`, `list`, and `peek`.

A cleanup prompt then asked ChatGPT to disable both test tasks. Subsequent paused-list evidence showed both with `is_enabled=false`. No new tasks were created by the cleanup turn.

The `/scheduled` primary UI in this build displayed a template gallery even while native automation-list requests contained the actual tasks; raw page text is therefore not the authoritative task registry.

### Chat deletion — live verified

The temporary chat was deleted through its project-list `Delete` action and irreversible confirmation.

Transport:

```text
DELETE /backend-api/conversation/id/{conversation_id} -> 200
```

Response:

```json
{ "success": true }
```

The project-list entry disappeared immediately after success.

### Project deletion — live verified

Project deletion was reached through `Project actions -> Project settings -> Delete project`.

The final native warning stated that deletion permanently removes the project and all of its Chat/Work chats and tasks, while files stored in Space are not removed.

Transport:

```text
DELETE /backend-api/gizmos/{project_id} -> 200
```

The captured response body was empty and the client returned to the root page.

### Koba MCP Bridge plugin discovery and management

Literal catalog search for `COBMCP` returned no result. Searching `Koba` exposed the installed app under its actual display name `Koba MCP Bridge`.

Native plugin search used:

```text
GET /backend-api/ps/plugins/search?q={query}&limit=50
```

The management page loaded app/link state through requests including:

```text
GET  /backend-api/ps/plugins/{plugin_id}
GET  /backend-api/aip/connectors/{app_id}?include_actions=true
POST /backend-api/aip/connectors/links/list_accessible
GET  /backend-api/ca/v2/user/connection_status
```

The page exposed OAuth as the active authentication method and provided connected-account actions plus app management.

### Disposable custom MCP lifecycle — live verified

A separate disposable custom MCP app was created through `Add -> Create custom MCP server`.

The dialog exposed optional PNG icon, name, optional description, server URL vs tunnel, three authentication choices (`OAuth`, `None`, `OAuth or None`), advanced OAuth configuration, and an explicit risk acknowledgement.

Entering the known MCP URL triggered OAuth discovery. Advanced settings showed DCR selected, custom OAuth client available, CIMD disabled because the server did not advertise support, default scope `read:user`, the discovered OAuth endpoints/resource and PKCE S256. OIDC remained unavailable because no OIDC configuration URL was advertised.

Creation emitted:

```text
POST /backend-api/aip/connectors/mcp -> 200
```

with `name`, `description`, `mcp_url`, optional `logo_url`, and discovered `auth_request`.

The result was a new independent `asdk_app_...` connector even though it used the same MCP URL as the existing Koba MCP Bridge.

The OAuth connection then completed through `links/oauth` and `links/oauth/callback`, producing an ACTIVE OAuth link with the six bridge actions.

The app metadata reported `enable_multi_links=true`, and native settings exposed `Connect another account`. A separate app object and a second link on one app are therefore distinct product operations.

### Create-time icon — live verified

A second disposable connector was created with a 256 x 256 PNG. The native file input accepted PNG only; product copy recommended at least 256 x 256 and limited the file to 10 KB.

The actual create request embedded the image as a data URL in `logo_url`. The response returned hosted `icon_assets` for square and circular variants.

The resulting app could be managed before connecting an account. Its management surface exposed name, description and delete, but no post-create icon-edit control or file input. Post-create icon editing remains unsupported by the observed native UI; no private mutation is inferred.

### Name and description mutations — live verified

On the connected disposable app:

```text
PATCH /backend-api/aip/connectors/{app_id}/name -> 200
PATCH /backend-api/connectors/{app_id}/description -> 200
```

Each body contained only the changed field and each response returned updated connector metadata.

### Refresh tools — corrected live contract

The original Koba MCP Bridge capture only showed the subsequent GET reconciliation and therefore missed the write boundary. On the disposable connected app, native `Refresh tools` emitted:

```text
POST /backend-api/aip/connectors/mcp/refresh_actions -> 200
```

with:

```json
{ "link_id": "<connected account link>" }
```

and then re-read plugin metadata plus `connector?include_actions=true`.

The six bridge actions remained unchanged. `Refresh tools` is therefore a link-scoped server refresh followed by local/server-state reconciliation, not GET-only behavior.

### Connected-account permissions — live verified

The permission radio values observed were:

```text
always_ask
ask_before_writes
review_important_actions
full_access
```

A new disposable OAuth link defaulted to `review_important_actions`.

All four states were exercised. Each change emitted:

```text
PATCH /backend-api/aip/connectors/links/{link_id} -> 200
```

with:

```json
{ "apps_privacy_control": "<selected value>" }
```

The test link was restored to `review_important_actions` afterward.

### App deletion — live verified

The native confirmation for both connected and unconnected disposable apps stated that the app and its connections would be permanently deleted.

Both used:

```text
DELETE /backend-api/aip/connectors/{app_id} -> 200
```

After deletion the client returned to plugin settings and a subsequent plugin lookup returned `404`.

### OAuth reconnect / reauthorization — live verified

Native `Reconnect` opened a ChatGPT connector-risk/permission disclosure and then continued to the provider OAuth authorization endpoint.

ChatGPT initiated reauthorization through:

```text
POST /backend-api/aip/connectors/links/oauth/reauth -> 200
```

The provider flow used standard OAuth authorization-code + PKCE parameters. Exact client ids, link ids, code/state/challenge values and tokens are intentionally excluded from this document.

After provider authorization, ChatGPT completed:

```text
POST /backend-api/aip/connectors/links/oauth/callback -> 200
```

The returned link was active and OAuth-authenticated; it included the current six connector actions. ChatGPT then refreshed connection/link/action state with requests including `connection_status`, connector metadata/action schema, connector link and accessible-link list.

No extra provider username/password entry was required in this specific capture because an existing provider session completed authorization. This is session-specific and must not be generalized.

### Cleanup boundary

After the operation tests:

- both test automations were disabled;
- the temporary test chat was deleted;
- the temporary test project was deleted;
- both disposable MCP apps were deleted;
- Koba MCP Bridge remained installed and connected after successful OAuth reconnect;
- no OAuth token/code/state/link identifiers or personal account metadata are retained in repository docs.

## Privacy contract

Conversation/archive content is local browser data.

It must not be exported through OTLP telemetry. Telemetry may contain operational facts only, for example:

```text
transport type
network direction
status code
duration
body size
error class
archive ingest counts without content
```

Never export message text, reasoning text, tool arguments/results, attachment URLs, project/chat titles, conversation IDs, message IDs, or raw ChatGPT responses to telemetry by default.

## Known next evidence tasks

1. Collect additional live tool-call DOM examples while a tool is actively running; completed turns in the current client often retain only citation pills rather than a distinct tool DOM block.
2. Extend attachment evidence beyond the verified image/estuary path to other file classes as they are observed.
3. Verify edit/regenerate behavior and how message IDs/parent IDs/current node change.
4. Verify whether loading another branch requires a separate conversation request or an in-conversation version request.


## Verified live message decoration signatures (2026-10-04)

Current ChatGPT conversation turns expose a stable outer `section[data-testid^="conversation-turn-"]`. The visible message node inside the turn carries both `data-message-id` and `data-message-author-role`. Native user/assistant action rows contain `data-testid="copy-turn-action-button"`; its parent is the preferred non-destructive insertion slot for Booster message metadata controls.

Booster may observe append/replace/attribute mutations under the conversation root and decorate these slots, but it must leave ChatGPT buttons, navigation, message layout and event handlers intact. The selector/slot knowledge belongs in `packages/chatgpt`; feature modules consume normalized targets instead of querying these signatures directly.

## Verified Work sub-agent lifecycle (2026-10-07)

A fresh native Work-mode conversation was created specifically to resolve the earlier
ordinary-Chat negative sub-agent result. The prompt required exactly two parallel
sub-agents with trivial independent tasks and required the parent to wait for both.

Direct live UI evidence progressed through:

```text
sub-agent activity: Multiply started
sub-agent activity: Multiply + Primes completed
Subagents panel: Active -> none
Subagents panel: Done -> 2
```

The parent then returned both requested results only after the child activity completed.

A subsequent normal conversation-history read preserved four hidden lifecycle records:
one `started` and one `completed` record for each child. Their metadata contained
`codex_sub_agent_activity` with unique `agentThreadId` values and paths
`/root/multiply` and `/root/primes`.

Two intermediate hidden records used `codex_collab_agent_tool_call` with
`tool="wait"`. The first wait completed after Multiply had completed but before Primes
had completed. Consequently, `wait status=completed` must not be used as a blanket
"all children done" signal.

Opening the completed Multiply child triggered
`/backend-api/flora/subagent/thread/turns` with the parent conversation id and the
child thread id. That detail request returned HTTP 500 in this capture while the parent
still reported the child as Done. Treat detail fetch health independently from child
execution lifecycle.

The same deployed client code maps `tpp` and `flora` conversation origins to the Work
product experience. The live conversation used `tpp`. This gives Booster a
source-level Work classifier rather than relying on renderer copy.

## Verified conversation-scoped load failure (2026-10-07)

A separate native failure surface was captured on a single conversation route:

    Не удалось загрузить этот разговор ChatGPT
    Повторить

This presentation is materially different from a failure to load the chat list or from a global application outage. Another ChatGPT conversation remained open and usable in a separate tab while the affected route showed this error.

Network evidence around the incident was mixed:

- a clean reload reproduced the failure while GET /backend-api/conversations/{id} returned HTTP 429;
- the same conversation endpoint had returned HTTP 200 earlier in the page session;
- conversation-list requests also showed repeated 429 responses.

Therefore HTTP 429 is a live-verified cause of this UI state in the captured reproduction, but the evidence does not justify defining the UI state as a one-to-one alias for HTTP 429 or assuming every occurrence has the same backend cause. Preserve it as its own normalized availability state, conversation_load_failed, and keep it independent from conversation-list availability, transport recovery, generation lifecycle and global service health.

The Retry control is a user-facing recovery action for the current conversation load. In observed renderers its Russian label varied between "Повторить" and "Попробовать снова"; do not make either exact string the architectural classifier. The control is not evidence that every other conversation is unavailable.


### Booster post-deployment Work acceptance (2026-10-07)

After updating to the published Work/sub-agent build, a real Work conversation rendered the Booster warning:

    Режим Work · браузер только для проверки

Three small one-sub-agent test turns were then observed. After each child completed, Booster reconstructed the accumulated child set from the conversation source state and rendered:

    Субагенты 1 · активно 0
    Субагенты 2 · активно 0
    Субагенты 3 · активно 0

The warning tooltip exposed distinct completed child names, while the native Subagents panel independently showed the matching Done count. This live-validates Work classification, warning placement, completed child identity and completed-state counting in the published browser build.

The deployed-build observation did not catch a child in Booster's active counter before completion: the child execution windows completed between inspection snapshots. The earlier raw source capture already live-verified separate started/completed records and the source/unit contract maps started to working, but an explicit browser screenshot/state with Booster showing active > 0 remains a separate acceptance point.


### Verified active-subagent renderer gap (2026-10-07)

A 500 ms page-side sampler captured a live Work child while the native UI had already advanced from three completed children to `Использовано: 4` and rendered `Codex title начал(-и) работу`. Throughout that active window, the published Booster build still displayed the previous `Субагенты 3 · активно 0`. This proves a presentation timing gap: the child `started` state can become visible in the native renderer before Booster receives or hydrates the corresponding source record.

A second live capture recorded the exact active DOM shape:

    section[data-testid="chatgpt-subagent-activity"]
      aria-label="Активность субагента"
      [role="button"] = child display name
      text suffix = "начал(-и) работу"

The captured example was `Multiply 211 223 начал(-и) работу`. The renderer selector belongs in `ChatGptDomAdapter`; feature code consumes a normalized `working` child. This DOM signal is only a bounded live fallback. Persisted/live `codex_sub_agent_activity` records remain authoritative for child identity and terminal state.
