# ChatGPT runtime contracts

This is the implementation-facing runtime map for ChatGPT Booster.

Read this document before changing request timers, reasoning/activity UI, Stop handling, stream recovery, safety/moderation handling, transport observation, or `ConversationStateStore` lifecycle logic.

Use the companion documents for different purposes:

- `docs/ARCHITECTURE.md` — normative ownership and architectural invariants.
- `docs/CHATGPT_CLIENT_RESEARCH.md` — raw/live reverse-engineering evidence and proof boundaries.
- GitHub issues — concrete Booster defects and implementation work.

Do not move a known implementation bug into the architecture contract. Convert the evidence into a normative rule here and track the defect in an issue.

## 1. Source authority

Runtime state is derived from several sources. They are not equally authoritative.

Use this precedence unless a more specific verified contract overrides it:

1. ChatGPT transport request/response payloads and stream events.
2. Explicit server acknowledgement of lifecycle mutations such as Stop.
3. Initial/history conversation payloads returned by ChatGPT.
4. Booster's normalized in-memory state derived from those sources.
5. ChatGPT DOM as corroboration or bounded fallback.
6. Local wall-clock observation only for rendering an open-ended elapsed duration or evaluating a local threshold.

A lower-authority source must not overwrite contradictory higher-authority evidence. In particular, stale DOM `in_progress` must not resurrect a stopped run or replace a newer outbound run.

## 2. Independent runtime axes

Do not model ChatGPT execution as one enum. A turn can simultaneously have independent states.

### Run lifecycle

```text
unknown
idle
in_progress
stop_requested
stopped
complete
cancelled
failed
```

This axis answers: is the logical request still running, stopped, or terminal?

### Transport / recovery health

Representative states are:

```text
healthy
reconnecting
resume_unavailable
recovering
recovery_unconfirmed
recovery_failed
```

This axis answers: can the client still receive/recover the live stream?

A turn may remain logically `in_progress` while transport recovery has already failed.

### Server async status

The observed client enum includes:

```text
STREAMING           = 3
UNREAD              = 4
REALTIME            = 5
REALTIME_BUSY       = 6
REALTIME_BACKGROUND = 7
```

Server async status is not the same thing as transport health. A persisted conversation can still report `STREAMING` after resume is unavailable.

### Reasoning / activity phase

Reasoning and tool activity come from message/source records and explicit metadata. They must not be inferred only from rendered labels such as `Думаю`.

### Safety review

A separate stream-driven state:

```text
inactive
active(protectionType=bio|cyber, message=...)
```

Safety review is neither reasoning nor transport failure nor a moderation block.

### Moderation outcome

Moderation is another independent layer and can carry warnings, limited behavior, blocks, disclaimers, interventions, or conversation-disable signals.

## 3. Endpoint catalog

This catalog contains runtime routes that have been directly observed or client-code confirmed in the current ChatGPT build. It is not a complete private API specification.

| Route | Method | Role | Booster authority/use |
| --- | --- | --- | --- |
| `/backend-api/f/conversation/prepare` | POST | composer preflight, may return conduit token | observe only; never use as request timer boundary |
| `/backend-api/f/conversation` | POST | actual fresh submission and streamed response | authoritative new-run boundary; source message id/create_time |
| `/backend-api/stop_conversation` | POST | native Stop mutation | authoritative Stop request/response lifecycle |
| `/backend-api/f/conversation/resume` | POST | resume lost completion stream | transport-recovery evidence |
| `/backend-api/conversation/{id}/stream_status` | GET | query server stream status | transport/server recovery evidence |
| `/backend-api/conversations/{id}?num_turns=...` | GET | fetch current conversation state | initial/history/server async-state evidence |
| `/backend-api/celsius/ws/user` | GET | obtain realtime/WebSocket connection information | transport evidence; do not persist returned credentials/tokens |
| `/backend-api/conversation/init` | POST | page/conversation initialization path | observed bootstrap; not a run timer boundary |
| `/backend-api/sentinel/chat-requirements/prepare` | POST | ChatGPT internal request requirements/preflight | observed around submission; no Booster lifecycle authority established |
| `/backend-api/sentinel/chat-requirements/finalize` | POST | ChatGPT internal request requirements finalization | observed around submission; no Booster lifecycle authority established |

Do not call private routes merely because they are documented here. Booster normally observes requests emitted by the native ChatGPT client. Mutation endpoints require an explicit feature contract; the current Stop behavior is observed from the native Stop action rather than synthesized by Booster.

## 4. Stream/update event catalog

The deployed client stream decoder recognizes multiple update types. The following catalog records the current known semantic classes relevant to Booster. Event names are source contracts; UI copy is not.

| Source event / normalized update | Meaning | Booster relevance |
| --- | --- | --- |
| ordinary message payload / `message` | source message or tool/reasoning record | ingest into RAM/indexes; derive timing/activity |
| `input_message` / `message` | streamed user/input message | message ingestion/identity |
| `conversation_async_status` / `async-status` | server async state | separate server-async axis |
| `message_marker` / `message-marker` | token/search/final markers such as `user_visible_token`, `final_channel_token`, `cot_token`, `last_token` | source timing/phase evidence where explicitly handled |
| `safety_review_update` / `safety-review` | temporary safety review with `active`, `message`, `protection_type` | separate safety-review axis |
| `moderation` blocked+safety metadata / `safety-access-block` | safety access/block outcome | moderation outcome, not review-in-progress |
| `main_stream_complete` / `main-stream-complete` | main stream completion metadata | completion pipeline evidence |
| `message_stream_complete` / `complete` | message stream completed | terminal stream evidence |
| `server_ste_metadata` / `server-ste-metadata` | server turn metadata | diagnostic/identity metadata where needed |
| `conversation_detail_metadata` / `conversation-details` | conversation details update | conversation metadata/state |
| `title_generation` / `title` | generated conversation title | metadata only |
| `content_references_patch` | incremental reference patch | source message enrichment |
| `writing_blocks_metadata_patch` | writing-block metadata update | source message enrichment |
| `toast` | server-driven toast message | presentation/diagnostics; not lifecycle by itself |
| `perf_stats` | performance statistics | diagnostics only unless a future feature explicitly uses it |
| beacon/rejected-beacon updates | product/client control metadata | do not treat as conversation lifecycle by default |

The decoder also handles other product-specific events (ads, paragen, instant-answer debug, etc.). Do not automatically persist or elevate every decoded event into Booster state. Add a normalized field only when a concrete feature/contract needs it.

## 5. Fresh composer start

Verified live flow for a normal new user message:

```text
POST /backend-api/f/conversation/prepare
POST /backend-api/f/conversation
```

### `/f/conversation/prepare`

This is preflight. It can include:

```text
conversation_id
action
model
parent_message_id
thinking_effort
conversation_mode / gizmo_id
local_function_names
partial_query
client_prepare_dispatch
client_prepare_source
```

The response can contain an opaque short-lived `conduit_token`.

Important: `partial_query.id` is not guaranteed to equal the final user message id. Therefore:

- do not start the request timer from `/prepare`;
- do not use `partial_query.id` as authoritative message identity;
- do not persist or expose the conduit token.

### `/f/conversation`

This is the actual run boundary. The outbound body carries the real user message:

```text
conversation_id
parent_message_id
messages[0].id
messages[0].create_time
messages[0].content
turn_attribution.turn_trigger
```

The observed fresh response is an SSE stream:

```text
Content-Type: text/event-stream
Cache-Control: no-store
X-Conduit-Token: <opaque>
```

For Booster:

```text
active run id = messages[0].id
startedAt     = messages[0].create_time
```

If `create_time` is absent, the actual outbound `/f/conversation` transport boundary is the fallback. The `/prepare` timestamp is not the fallback.

A new outbound `/f/conversation` for the current conversation supersedes the previous active-run identity immediately.

### Early DOM is incomplete

A fresh turn can already be running while the DOM contains only the user search-unit and no assistant search-unit or assistant message id yet.

Therefore request lifecycle/timer mounting must not wait for assistant DOM.

## 6. Native Stop contract

Verified native action:

```text
POST /backend-api/stop_conversation
```

Observed body:

```json
{
  "conversation_id": "<conversation_id>",
  "exclude_async_types": []
}
```

Observed successful response in a stale/recovery case:

```json
{
  "status": "ok",
  "last_message_id": null
}
```

Model the lifecycle as:

```text
outbound Stop request -> stop_requested
successful response   -> stopped
failed response       -> in_progress
```

Do not use Stop-button disappearance or DOM turn-state as confirmation. Live evidence showed a server-confirmed stop while the rendered turn still remained `data-talvt-turn-state="in_progress"`.

After the confirmed Stop, one final already-started recovery pair was observed, then recovery polling ceased during the follow-up window. Do not infer that Stop intentionally starts that pair; it can be in-flight cleanup.

`last_message_id:null` is valid evidence in at least one stopped recovery case. Do not hard-code it as a constant for every successful Stop.

## 7. Stream recovery contract

Observed recovery routes:

```text
GET  /backend-api/conversation/{conversation_id}/stream_status
POST /backend-api/f/conversation/resume
GET  /backend-api/celsius/ws/user
```

Observed `stream_status` values / client outcomes include:

```text
IS_STREAMING
COMPLETE
FAILURE
UNAVAILABLE
stream_failure
unconfirmed
```

The observed client maps `stream_status` HTTP 404 to `UNAVAILABLE`.

A `410` completion-stream error with `errorCode="persisted_final_available"` is special: the client treats the final response as persisted and attempts recovery from conversation data.

### Tokenless resume unavailable

Verified response:

```text
POST /backend-api/f/conversation/resume -> 404
```

```json
{
  "detail": {
    "message": "A network error occurred. Please check your connection and try again.",
    "code": "tokenless_resume_unavailable"
  }
}
```

The same conversation can still return:

```json
{ "status": "IS_STREAMING" }
```

from `/stream_status` and can still have initial `async_status=3` (`STREAMING`).

This combination means: persisted/server state still calls the turn streaming, but the client cannot resume the original live stream.

### Long recovery polling

The observed client recovery loop polls conversation data and `stream_status` together. A failed iteration increments an internal failure counter. The inspected client stops recovery when:

```text
F >= 30
```

In the reproduced incident, repeated conversation refreshes returned `429`; companion `stream_status` requests frequently appeared as `ERR_ABORTED` because the paired iteration was cancelled after one side failed.

Do not treat every aborted `stream_status` request as an independent root failure.

After exhausting the recovery error budget, ChatGPT rendered the generic native alert:

```text
A network error occurred. Please check your connection and try again.
```

This causal chain is proven for the captured incident, not for every generic network-error alert.

## 8. Safety-review stream contract

Verified authoritative stream event:

```json
{
  "type": "safety_review_update",
  "active": true,
  "conversation_id": "<conversation_id>",
  "message": "<server-provided user-facing status>",
  "protection_type": "cyber"
}
```

The observed decoder accepts these `safety_review_update.protection_type` values:

```text
bio
cyber
```

The client normalizes this event into an internal `safety-review` update containing:

```text
active
conversationId
message
protectionType
```

### Live cyber review example

The native UI showed:

```text
Наши системы выполняют дополнительную обработку этого запроса, прежде чем предоставить ответ.
```

The React component state exposed:

```text
requestId      = current fresh user turn id
protectionType = cyber
message        = server-provided status
```

Rendered presentation used:

```text
role="status"
aria-live="polite"
```

with a shimmer treatment and a shield/processing icon.

While review was active:

```text
run state     = in_progress
Stop control  = present
alert         = absent
```

So safety review does not itself mean blocked, failed, or stopped.

### Review completion

A later passive observation showed the safety-review status completely gone from the same turn with no native alert. The turn still rendered as `in_progress` at that observation boundary.

The inspected client contract deactivates the review when a `safety_review_update` carries `active=false`. The exact `active=false` packet was not separately captured in the network stream, so document the evidence precisely:

- live UI transition from review-present to review-absent was observed;
- client code proves `active=false` is the deactivation mechanism;
- the exact deactivation SSE frame was not captured directly.

## 9. Moderation contract

Moderation is distinct from `safety_review_update`.

The broader moderation schema can contain:

```text
flagged
blocked
audio_blocked
should_disable_conversation
disclaimers
structured_copy
product_intervention
metadata.safety_limited
metadata.protection_type
metadata.violence_interstitial
metadata.model_incompatibility
metadata.safety_plugin_block_reason
```

The observed moderation policy mapping includes:

```text
protection_type=bio       -> bio_safety_content_policy
protection_type=cyber     -> cyber_safety_content_policy
protection_type=wellbeing -> sensitive_conversations_content_policy
other safety_limited      -> default_safety_limited_content_policy
REGURG_BLOCKED            -> content_regurgitation
model incompatibility     -> model_incompatibility
otherwise blocking        -> content_policy
```

Important distinction:

```text
safety_review_update(active=true)
    = additional safety processing is underway

moderation blocked/safety_limited/etc.
    = a moderation outcome has been produced
```

Do not collapse them into a single boolean named `moderated`.

## 10. DOM signatures are corroboration only

Verified useful DOM signals include:

```text
data-turn-key
[data-talvt-turn-state]
button[aria-label="Остановить"]
role="status" / aria-live="polite"
role="alert"
```

But these are presentation state, not lifecycle authority.

Known contradictions include:

- turn remains `in_progress` after server-confirmed Stop;
- turn remains `in_progress` during failed/unavailable stream recovery;
- assistant DOM may not yet exist after the outbound run has started;
- safety review is rendered as localized text, but the authoritative classifier is the stream event.

Keep renderer/version-specific selectors behind `ChatGptDomAdapter`.

## 11. State precedence rules

The live read model should obey these rules:

1. A fresh outbound `/f/conversation` replaces the previous active run for that conversation.
2. Renderer reconciliation cannot replace a newer run with an older stale `in_progress` turn.
3. Confirmed Stop remains stopped even if DOM still says `in_progress`.
4. Transport recovery state does not change run identity by itself.
5. Safety review does not change run identity or imply failure by itself.
6. Moderation outcome does not get inferred from safety-review presence.
7. DB hydration cannot overwrite fresher live source evidence.
8. Archive persistence policy does not disable live observation.

## 12. Implementation anti-patterns

Do not:

- start timers from `/f/conversation/prepare`;
- use a local stopwatch as the source request boundary;
- wait for assistant DOM before mounting current-request state;
- infer Stop success from button disappearance;
- infer healthy generation from DOM `in_progress` alone;
- infer recovery state from localized error text alone;
- infer safety category from localized status text alone;
- collapse run state, transport health, reasoning, safety review and moderation into one enum;
- let IndexedDB gate current-chat UI;
- persist or surface conduit/auth tokens;
- synthesize private ChatGPT mutations when a feature is only observing native client behavior.

## 13. Observer event targets

The observer layer should normalize source events rather than expose feature modules to raw host details.

Already verified or required normalized domains:

```text
conversation request started
conversation Stop requested/confirmed/failed
server async-status update
transport recovery/status update
safety-review update
moderation/safety-access outcome
message/source record update
message-stream completion
```

Feature/UI code should consume normalized runtime state from `ConversationStateStore`, not separately parse host transport or localized DOM.

## 14. Validation checklist for lifecycle changes

Before claiming a lifecycle change complete, verify at least:

- fresh composer request uses the new message id and source `create_time`;
- no assistant DOM is required for request state;
- old stale DOM cannot resurrect an earlier run;
- Stop transitions only on its transport request/response contract;
- recovery-unavailable state can coexist with `in_progress`;
- safety review can activate and disappear without being treated as a block;
- moderation outcomes remain distinct from review state;
- reload of an active/recovery conversation hydrates source state without waiting on IndexedDB;
- extension and userscript share the same normalized runtime behavior.

## 15. Evidence boundaries

Maintain explicit confidence levels in future reverse-engineering:

- **direct live evidence** — observed request/response/event/DOM state;
- **client-code confirmed** — exact branch/schema found in deployed client JS;
- **correlated** — events co-occurred but causality is not proven;
- **unknown** — do not fill with assumptions.

When a new ChatGPT status appears, capture its source event first when possible, then document presentation. Do not make localized UI strings the architectural contract.
