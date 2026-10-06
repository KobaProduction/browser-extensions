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
      "id": "9061a1ff-2980-428e-8fc3-2426a09e4f80",
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
data-turn-key = 9061a1ff-2980-428e-8fc3-2426a09e4f80
data-talvt-turn-state = in_progress
native Stop control = present
```

The turn key matched the final user message id from the main `/f/conversation` payload.

At the same time, the turn still had only the user search-unit; there was no assistant search-unit or `data-chatgpt-selection-message-id` yet. Nevertheless ChatGPT was already rendering activity/reasoning headers and generated progress text inside the turn.

Therefore live request state and request-timer mounting must **not** depend on an assistant search-unit existing. The outbound request/state store is available earlier than the final assistant renderer contract.

#### Booster 0.8.38 stale-timer finding

The inspected tab was still running Booster 0.8.38. After the fresh message started, the native turn correctly changed to the new user id and exposed Stop, but Booster's global request status incorrectly continued the previous stopped/recovery elapsed value (`Запрос 1:17:38`, later `1:19:11`) instead of restarting from the new message's `create_time`.

This is Booster behavior, not ChatGPT behavior. The fresh ChatGPT transport supplied the correct new id and source timestamp. A newer outbound `/f/conversation` request for the current conversation must replace any stale older active run in the live read model/UI; an old DOM turn that still says `in_progress` must not be allowed to re-promote or visually dominate the newer request lifecycle.

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
requestId      = 9061a1ff-2980-428e-8fc3-2426a09e4f80
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
  "conversation_id": "6ac5144e-ebf0-83eb-b145-72ee142accc3",
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
