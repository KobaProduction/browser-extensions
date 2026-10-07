# ChatGPT product operations

This document is the implementation-facing map for ChatGPT product-level operations that are adjacent to, but distinct from, the per-turn runtime state machine.

Read it before changing features that observe or interact with:

- ChatGPT Projects;
- conversation creation, deletion, branching or renaming;
- model/reasoning-effort selection;
- Automations / Scheduled tasks;
- Plugins / Apps / MCP connector management;
- connected-account permissions, reconnect or OAuth reauthorization.

Companion documents:

- `docs/CHATGPT_RUNTIME_CONTRACTS.md` — per-turn lifecycle, transport, recovery, safety and timing contracts.
- `docs/CHATGPT_CLIENT_RESEARCH.md` — raw/live client-behavior evidence and proof boundaries.
- `docs/ARCHITECTURE.md` — package ownership and stable architectural invariants.

The contracts below describe observed ChatGPT client behavior. They are not an invitation to synthesize private ChatGPT mutations. Prefer observing native user/client actions unless a Booster feature has an explicit documented need to perform one.

## 1. Evidence and authority

For product operations use the same evidence discipline as runtime behavior analysis:

1. native request/response emitted by ChatGPT UI;
2. native client code branch/schema from the deployed ChatGPT bundle;
3. native UI state after the operation;
4. DOM text only as presentation evidence.

Mark a contract as **live verified** only when the UI action and resulting transport were both observed.

Mark it **client-code confirmed** when the exact client implementation was found but the mutation was not executed live.

Do not persist private account identifiers, OAuth authorization codes, OAuth state/PKCE values, access/refresh tokens, account email addresses, or connector link IDs in repository documentation.

## 2. Projects

### Create-project UI

Live create-project dialog exposed:

```text
Project name
icon/color picker
memory mode
Create project
Cancel
```

The observed default memory choice was presented as `Default memory` / `Память по умолчанию`.

In a later live capture with account-level Memory disabled, opening the memory selector did **not** expose selectable project-memory modes. Instead it showed: `Memory is off. Turn it on in Settings to use it in projects.` The `Default memory` button remained visible as an entry-point/status surface. This proves that project memory policy and account-level Memory availability are separate concerns.

### Create-project transport

Live verified:

```text
POST /backend-api/projects
```

Observed request shape:

```json
{
  "emoji": null,
  "instructions": "",
  "memory_scope": "unset",
  "name": "<project name>",
  "theme": null
}
```

The response contains the newly created project/gizmo resource and server-assigned project id.

In the captured default-memory case, the request used `memory_scope="unset"` while the returned project resolved to enabled/global memory semantics. Treat `unset` as "let ChatGPT resolve the default", not as proof that project memory is disabled.

After creation ChatGPT navigated to:

```text
/g/{project_id}/project
```

and subsequently loaded project metadata/conversations through routes including:

```text
GET /backend-api/gizmos/{project_id}?include_file_limits=true
GET /backend-api/gizmos/{project_id}/conversations?limit=50&owned_only=false
GET /backend-api/projects/{project_id}/connector_scopes?limit=100
```

### Project settings

The live Project Settings surface exposed:

```text
Project name
Instructions
Memory
Space access
Delete project
```

The memory setting was informational after creation in the tested project; the UI explicitly stated that it could not be changed there. The tested project displayed `Default` and explained that the project can access memory from other chats and vice versa, followed by `This cannot be changed.` Therefore project memory mode is a create-time policy in this build.

Do not equate that stored project policy with current account-level Memory availability. In the same account/build, the create dialog reported that Memory was disabled at account level while the server-created project still returned `memory_enabled=true` and `memory_scope=global` after a request with `memory_scope=unset`. Treat those fields as project configuration semantics, not proof that account Memory is currently usable.

The same settings surface exposes project-level `Instructions`, which act as a project-scoped base prompt/context.

The native commit trigger is the explicit `Save / Сохранить` button in Project Settings. A live instructions save emitted:

```text
PATCH /backend-api/projects/{project_id} -> 200
```

with the observed body:

```json
{
  "emoji": null,
  "instructions": "<project instructions>",
  "name": "<project name>",
  "theme": null
}
```

The response returned the updated project resource with the saved instructions.

This also resolves a version-sensitive discrepancy with the previously inspected client-code path: the live 2026-10-07 request **omitted** `memory_scope` entirely for this ordinary settings save. Do not require or synthesize `memory_scope:null` merely because an earlier deployed-client implementation included it in its effective settings body.

The textarea is not simple autosave. Earlier attempts using close, blur, waiting and `Ctrl+Enter` produced no PATCH. Treat explicit `Save` as the verified native commit boundary for the captured build.

The current Project Settings component renders its footer only after settings become dirty. For an editable project the dirty footer contains `Cancel / Отмена` and a primary `Save / Сохранить` button with `type=submit`; the enclosing form owns the save handler. Closing or cancelling dismisses staged edits without invoking that submit path. The client also rejects instructions longer than 8,000 characters before save.

### Delete project

Native deletion is a two-step destructive UI flow:

```text
Project actions
  -> Project settings
  -> Delete project
  -> irreversible confirmation
```

The confirmation stated that deleting the project permanently deletes the project and all its Chat/Work chats and tasks, while files already saved in Space are not deleted.

Live transport:

```text
DELETE /backend-api/gizmos/{project_id} -> 200
```

The captured successful response body was empty. After success the client returned to the root ChatGPT page.

### Project deletion consequence

Do not assume project deletion is equivalent to deleting Space/library files. The native warning explicitly separates project/chat/task removal from Space-stored files.

## 3. Conversations inside Projects

### First message creates the persisted conversation

A project composer can exist before a persisted conversation exists.

Submitting the first message uses the normal fresh-conversation contract:

```text
POST /backend-api/f/conversation/prepare
POST /backend-api/f/conversation
```

The main request carries the project/gizmo context. No separate `create conversation` REST mutation was observed.

The server allocates the conversation id from that first `/f/conversation` submission and the client moves to:

```text
/g/{project_id}/c/{conversation_id}
```

A live `ping` message in the test project completed normally with a `pong` answer and established this creation path.

### Delete chat

Native project-list chat deletion is also a two-step destructive flow:

```text
chat actions
  -> Delete
  -> confirmation dialog
```

The confirmation explicitly says deletion is permanent and cannot be undone.

Live transport:

```text
DELETE /backend-api/conversation/id/{conversation_id} -> 200
```

Observed response:

```json
{ "success": true }
```

After success the chat disappeared immediately from the project conversation list.

### Rename chat

Live verified contract remains:

```text
POST /backend-api/conversation/id/{conversation_id}/rename
```

```json
{ "title": "<trimmed title>" }
```

Successful response:

```json
{ "success": true }
```

### True branch

Client-code-confirmed branch mutation remains distinct from new-chat or project-chat creation:

```text
POST /backend-api/conversation/new_branch
```

```json
{
  "conversation_id": "<source conversation id>",
  "message_id": "<branch boundary message id>"
}
```

Live UI/postcondition evidence now corroborates the separate-conversation branch model. A test conversation family contained three simultaneously listed conversations with three distinct `/c/{conversation_id}` routes: the original, `Ветка · …`, and nested `Ветка · Ветка · …`. The nested branch rendered a persistent `Ответвление от …` link back to its source branch, and the assistant action menu exposed `Ветка в новом чате`.

This is live acceptance of the native branch presentation and persisted postcondition. The `/conversation/new_branch` request shape remains client-code-confirmed because that exact request was not contemporaneously intercepted in this capture.

OpenAI's public product documentation agrees with this separate-conversation model: the 2025-09-04 ChatGPT release notes describe branching as starting a separate chat from a selected message without losing the original thread, and the current Projects documentation says branched chats appear alongside the original project conversation. Treat this as public product-semantics corroboration, not as documentation of the private endpoint.

The successful branch response returns a full child `conversation` graph. The current client allocates a fresh local `clientThreadId`, hydrates the child mapping/current node plus conversation origin, title, async state, project/moderation context, and records the source `(conversation id, message id)` boundary separately. Branch creation is therefore a server-allocated child conversation followed by local graph hydration, not a client-side clone of the visible DOM.

The deployed transport coalesces duplicate in-flight branch calls for the same
`conversation_id + message_id` boundary and exposes `chatgpt.pending-branch` as a
restart blocker until the branch promise settles. This is useful operationally: a
timeout at an automation boundary must be followed by post-state inspection before a
second native click, because the ChatGPT client itself treats the mutation as one
pending branch operation.

### Regenerate and in-conversation versions — mixed live/client-code evidence

The current deployed client does not expose a dedicated `/regenerate` mutation. Native
regeneration reuses the normal conversation completion transport and changes the request
semantics to a variant submission.

The client submission pipeline sets `action="variant"` whenever the regeneration
descriptor is present. `regenerateFromMessageId` takes precedence during parent
resolution, so the selected message/version boundary becomes the parent for the new
assistant variant.

The request builder can additionally carry:

```text
regeneration_source = <native retry/regenerate source, when present>
variant_purpose = <purpose, when present>
force_use_search = <regeneration search override, when present>
map_search_params = <regeneration map-search parameters, when present>
client_reported_search_source = <regeneration search source, when present>
```

The client then sends the ordinary conversation completion request. Internally the call
carries `regenerateFromMessageId` separately from the optional replacement message
payload.

Current deployed-client logic further derives:

```text
explicit search retry:
  true  -> client_reported_search_source = conversation_regenerate_with_search
  false -> client_reported_search_source = conversation_regenerate_without_search

variant_purpose:
  comparison_implicit
    only for the first added alternative when search is not explicitly overridden
  none
    otherwise
```

`error_retry` is a separate recovery case: if a matching failed turn retained an unsent
submission, the client can replay that original request boundary rather than manufacture
a new ordinary regeneration. Other dedicated retry sources exist for image generation,
safety review and precise-location recovery. The exact source value selected by the
ordinary native `Try again / Попробовать еще раз` menu remains unverified until its live
request is intercepted.

OpenAI's public release notes and ChatGPT Search documentation independently describe
the response retry UI as regeneration of an existing response, including the
`Try again` and `Search the web` choices where available. This corroborates the
product-level variant semantics, but not the exact private request fields.

When a prompt already has child alternatives, the graph treats them as sibling variants.
The source-state layer records:

```text
messageIdToMarkHasVersions
regeneratedMessageId
hasExistingVariants
```

and marks the relevant message with `metadata.has_versions=true`.

Conversation history reads request version awareness explicitly:

```text
GET /backend-api/conversations/{conversation_id}?num_turns=...&include_has_versions=true
GET /backend-api/conversations/{conversation_id}/messages?before=...&num_turns=...&include_has_versions=true
```

When the route contains a `message` or `messageId` query parameter, or when the
pagination cache is already complete, the client forces the full conversation loader
instead of relying only on the bounded recent-turn page. This is relevant to opening a
specific historical branch/version.

The conversation model remains a graph of nodes with `parent` and `children`; the
visible branch is determined by `current_node`. Do not model regeneration as overwriting
the prior assistant response.

Live acceptance on a dedicated test branch established the current UI semantics:

- editing a user message keeps the same conversation id and creates a versioned branch;
- the inline editor exposes `Редактирование сообщения` with `Отменить / Отправить`;
- after submit, native `Показать версии` appears on the edited user turn;
- version navigation exposes `Версия 1`, `Текущая версия`, `Предыдущая версия`, `Следующая версия`, `Вернуться к текущей версии`, and on an older branch `Продолжить в новом чате`;
- previous/next navigation keeps the same `/c/{conversation_id}` URL;
- full reload preserves the edited branch.

The response control labeled `Сменить модель` currently opens a response-variant menu containing `Попробовать еще раз`, `Думай дольше`, `Искать в сети`, and `Попросите изменить ответ`. A custom response variant was executed through the latter: the same conversation id remained active and `OK EDIT` became `OK EDIT 2`, which persisted across reload.

The exact `Попробовать еще раз` item was observed but not invoked in this capture. Its request construction remains the client-code-confirmed `action="variant"` contract above.

## 4. Model and reasoning-effort selector

The tested Chat composer exposed one five-position reasoning-power control. Its visual label is not merely cosmetic: the selected position changes the actual `/f/conversation` transport model/effort contract.

### Live selector positions

Observed accessibility labels:

```text
0 -> Instant       (1 of 5)
1 -> Medium        (2 of 5)
2 -> High          (3 of 5)
3 -> Very High     (4 of 5)
4 -> Pro           (5 of 5)
```

The keyboard-active container carried:

```text
role="menuitem"
aria-label="Power" / "Мощность"
data-reasoning-slider="true"
```

with an internal slider range `0..4`.

### Historical transport matrix (pre-2026-10-07 GPT-6 Chat rollout)

Each row below was verified by submitting a new short message after selecting that position and reading the outbound `/backend-api/f/conversation` body.

| UI level | Transport `model` | Transport `thinking_effort` |
| --- | --- | --- |
| Instant | `gpt-5-6` | omitted |
| Medium | `gpt-5-6-thinking` | `standard` |
| High | `gpt-5-6-thinking` | `extended` |
| Very High | `gpt-5-6-thinking` | `max` |
| Pro | `gpt-6-pro` | omitted |

The matrix above is historical evidence from an earlier client build. Do not assume its GPT-5.6 model values are current after the GPT-6 Chat rollout.

### Important consequence

The top `Pro` position is not merely a higher `thinking_effort` value on GPT-5.6. In the captured product build it switched the actual transport model to `gpt-6-pro`.

Likewise, `Instant` used the non-thinking `gpt-5-6` transport model rather than `gpt-5-6-thinking` with a low effort value.

Feature code must therefore consume actual transport/model metadata and must not derive model identity from ordinal UI position alone.

### Model list vs effort control

The visible model menu and the five-position reasoning-power control are related but distinct product concepts. The exact available model list is account/build dependent and should not be hard-coded from one capture.

### Post-rollout GPT-6 ordinary Chat transport acceptance (2026-10-08)

Fresh external Playwright Pro Chrome test (same approved remote MCP session), on `chatgpt.com` at **1600×1000**. The test tab was reloaded before use; the initial ordinary Chat composer had **Chat selected and Work unselected**, and the model picker had **GPT-6** checked. The separate Work tab was not modified.

Using the native `Мощность` menuitem and Playwright ArrowLeft/ArrowRight, the following **five UI states were all live exercised** (zero-based slider index):

| Slider index | Current label | Verified UI transition |
| --- | --- | --- |
| 0 | Instant (1 of 5) | Yes |
| 1 | Medium / Средний (2 of 5) | Yes |
| 2 | High / Высокий (3 of 5) | Yes |
| 3 | Very High / Очень высокий (4 of 5) | Yes |
| 4 | Pro (5 of 5) | Yes |

Two separate short **normal Chat** turns were submitted and completed in one dedicated test conversation. Passive `browser_network_request` inspection of the actual outgoing **`POST /backend-api/f/conversation` requests**, both returning HTTP 200, established the following **current** transport behavior:

| Selected UI level | Actual `model` | Actual `thinking_effort` | Evidence |
| --- | --- | --- | --- |
| High / 3 of 5 | `gpt-6-thinking` | `extended` | Accepted — native response completed, outbound request body captured |
| Very High / 4 of 5 | `gpt-6-thinking` | `max` | Accepted — native response completed, outbound request body captured |
| Instant / 1 of 5 | *Not captured for GPT-6* | *Not captured* | UI state only |
| Medium / 2 of 5 | *Not captured for GPT-6* | *Not captured* | UI state only |
| Pro / 5 of 5 | *Not captured for GPT-6* | *Not captured* | UI state only; do not infer `gpt-6-pro` from the label |

Both outgoing requests were `action=next`, `turn_attribution.turn_trigger=composer`, and contained no explicit `conversation_origin=tpp` Work marker. The first generated the expected brief reply; the second generated the expected distinct reply. The **test conversation** was `https://chatgpt.com/c/6ac6b567-96d4-83ed-a087-cd6cdcd033f5` (synthetic text only). Both messages and the restored **Very High / 4 of 5** selection remained visible after full page reload; the viewport also stayed at 1600×1000. No existing user conversations or the original Work test tab were modified.

**Refactor rule:** do not map a current model from slider ordinal, a translated user-facing label, or an older snapshot of the GPT-5.6 payload matrix. The actual outbound transport fields are authoritative for the runtime. The old GPT-5.6 matrix is retained as dated product evidence, **not** as the current GPT-6 model map. Model-radio transitions (to GPT-5.6 Sol or GPT-5.5) and GPT-6 Instant/Medium/Pro outbound mappings still require separate acceptance.
## 5. GPT-6 Pro sub-agent capability test

A deliberate live test was run in ordinary Chat mode while the transport model was verified as `gpt-6-pro`.

The prompt requested 4–6 independent parallel sub-agents, each with a trivial independent arithmetic task, followed by aggregation.

### What happened

The turn entered normal `in_progress` state and the persisted message graph temporarily contained an in-progress `tool` record under `model_slug="gpt-6-pro"` while ChatGPT inspected available capabilities.

No child-agent conversation/thread records were observed.

No browser REST endpoint containing a `subagent` operation was observed.

The final answer explicitly reported that no mechanism for launching sub-agents was available in that surface and that `0 / 6` requested sub-agents had actually been launched. The arithmetic was then checked by the main model itself.

### Evidence consequence

For the captured ordinary Chat surface:

```text
GPT-6 Pro transport            = verified
sub-agent spawn requested      = verified
sub-agent capability discovery = observed
actual child agents launched   = 0
```

This is a **negative capability result for ordinary Chat mode in this build**.

It is not proof that Work mode, Codex/Work-specific surfaces, or future builds cannot orchestrate child agents. Test those surfaces separately before making a global product statement.

Do not infer successful delegation merely because the main stream emits a generic tool record while checking capabilities.

## 6. Structured user-input workflows

ChatGPT currently has at least two materially different structured-question protocols. Do not treat every rendered questionnaire as `request_user_input`.

### GenUI `ask_user_input` — live verified

A live automation-creation flow used a final assistant message containing a GenUI question widget. The assistant message itself was a normal successful assistant message with `end_turn=true`; its text contained a rendered `ask_user_input` payload with a multi-select question, predefined options and a free-text placeholder.

The originating fresh submission also carried product hints for this flow:

```text
suggested_automation_type = daily_brief
force_genui_prefetch      = ask_user_input
model                     = gpt-6-astra-wm
```

The UI rendered the widget as a structured questionnaire and displayed a waiting-for-user-answer presentation.

Submitting one selected answer created a **normal new user turn**, not a tool message. The outbound `/f/conversation` body contained:

```text
turn_attribution.turn_trigger = composer
parent_message_id             = <assistant message containing the widget>
messages[0].author.role       = user
messages[0].metadata.message_submission_source = ask_user_input
```

The text representation was serialized as:

```text
> <question text>
<selected answer(s)>
```

For multiple questions the client joins question/answer blocks with blank lines.

Therefore the stable correlation keys for GenUI questions are:

```text
source assistant message id
    -> next user message parent_message_id
    -> message_submission_source = ask_user_input
```

There is no native `request_id/question_ids` correlation object in this protocol.

The live flow then continued as a normal new model turn. In the observed automation case the model subsequently called the automation create tool and received a successful tool result.

### Native agent `request_user_input` — live verified

A dedicated live acceptance run forced the ordinary Chat/Work-capable model surface to
emit one native single-select request with two options and then selected the second
option.

The pending source record used a tool message:

```text
author.role = tool
author.name = request_user_input
recipient   = assistant
channel     = commentary
end_turn    = true
```

Its active request metadata exposed:

```text
codex_request_user_input:
  request_id: <request id>
  question_ids: [<question id>]
  status: pending
  is_blocking: true
```

The visible native UI rendered a radio group, free-text alternative and Skip action under
`Waiting for your answer`. For the captured single-select request, choosing one radio
option submitted immediately; there was no separate Submit action.

The answer produced a normal streamed continuation through:

```text
POST /backend-api/f/conversation -> 200
```

with the original request message as the parent and a generated tool message in
`messages[0]`:

```text
parent_message_id = <source request_user_input message id>
messages[0].author.role = tool
messages[0].author.name = request_user_input
messages[0].channel = commentary
messages[0].recipient = all
```

Its text content serialized the answer map and metadata carried the protocol correlation:

```text
codex_request_user_input_response:
  request_id: <same request id>
  answers:
    <question id>:
      answers: [<selected answer>]
```

The captured request did not carry a `reasoning_group_id`; client code still confirms
that it is preserved when present.

A later native conversation reload exposed an important persistence boundary. In this
capture, neither the original `request_user_input` tool record nor the submitted tool
response was returned as a standalone history record. Instead, the completed reasoning
record contained `inline_cot_expandable_content.questions` with the question and selected
answer, followed by the normal final assistant message. Lossless handling therefore
requires observing the live request/response path; late history hydration alone may only
retain a compacted presentation of the interaction.

One source inconsistency was also observed before answering: the top-level
`metadata.codex_request_user_input.is_blocking` and active React request state both said
`true`, while a nested copy under
`content_references[].data.codex_request_user_input` still contained
`is_blocking=false` plus an `expires_at`. Treat the top-level active request metadata
as the current interaction state when these copies disagree. The capture did not contain
a corresponding snooze request, so do not invent an expiry/snooze causal explanation
for this specific divergence.

### Native non-blocking expiry / snooze

For a native question with:

```text
is_blocking = false
expires_at  = <timestamp>
```

the client can automatically cross the expiry boundary and calls:

```text
POST /backend-api/conversation/{conversation_id}/messages/{message_id}/request_user_input/snooze
```

Expected response errors include `404` and `409`. After snoozing, the client locally rewrites the request metadata to blocking semantics so it can remain available for later interaction.

### Detection and routing rules

A Booster/observer implementation should classify the interaction from source data, not from the rendered questionnaire UI:

```text
GenUI ask_user_input
  source: assistant widget/client_defined_widget
  response: new user text turn
  correlation: parent_message_id + message_submission_source=ask_user_input

Native request_user_input
  source: codex_request_user_input metadata / native request widget
  response: tool message named request_user_input
  correlation: request_id + question_ids + source messageId
```

Use `turn_exchange_id` / `working_turn_id` as additional turn attribution, but not as a replacement for the protocol-specific correlation keys above.

Do not forward a GenUI answer as a native tool response, and do not flatten a native `request_user_input` response into an ordinary user message. Doing either loses the server-side continuation contract.

### UI/runtime consequence

`Waiting for your answer` is an interaction state, not a transport failure. Features should represent it separately from `in_progress`, Stop/recovery, safety review and terminal completion.

For native requests, whether the question is blocking and whether it can expire are source metadata. For GenUI questions, the source assistant turn can already be complete while the product is waiting for the user's next turn.

## 7. Automations / Scheduled tasks

### Product surfaces

Automations can be created from ordinary conversation prompts and are then persisted as cloud tasks.

The current client bundle recognizes automation tool operations:

```text
automations.create
automations.update
automations.run_now
automations.list
automations.peek
```

A distinct `delete` tool operation was not present in the inspected operation recognizer. Do not interpret that as proof that no deletion path exists elsewhere in the product; it only defines the inspected tool contract.

### Native backend lists

The Scheduled product fetches task state through:

```text
GET /backend-api/automations?filter=scheduled&limit={N}
GET /backend-api/automations?filter=paused&limit={N}
GET /backend-api/automations?filter=finished&limit={N}
```

The captured `/scheduled` UI build displayed a task-template gallery in its primary panel even while the backend list contained the test automations. Treat the backend task objects as the authoritative task state for automation-aware features, not raw page text.

### Automation object fields

Observed task objects included fields such as:

```text
id
title
schedule                 # iCalendar VEVENT text
display_schedule
is_enabled
conversation_id
prompt
executor
thread_mode
model
reasoning_effort
default_timezone
timing_mode
target_time_utc
notifications_enabled
email_enabled
schedule_components
next_run_times
last_run_time
webhook_triggers
current_user_role
can_delete
```

Do not persist account-global task ids in repository documentation.

### One-time reminder — live verified

A natural-language request created a one-time reminder.

Observed persisted semantics:

```text
timing_mode = exact_schedule
executor    = cloud
thread_mode = existing_chat
is_enabled  = true
schedule    = VEVENT with one DTSTART and no recurring RRULE
```

The task remained associated with the conversation from which it was created.

### Hourly condition watch — live verified

A second natural-language request created an hourly watch that checks a public status page and notifies only if a new active incident appears.

Observed persisted semantics:

```text
timing_mode      = condition_watch
executor         = cloud
thread_mode      = existing_chat
display_schedule = tracking/monitoring presentation
is_enabled       = true
schedule         = VEVENT with RRULE:FREQ=HOURLY
```

The backend populated future `next_run_times`.

### Pause/disable via chat — live verified

A later user prompt asked ChatGPT to disable both test tasks without creating new ones.

ChatGPT completed the update and the subsequent native paused-list response showed both test tasks with:

```text
is_enabled = false
```

Thus the same chat/tool layer can mutate existing automations, not only create them.

### Native Scheduled management UI — live verified

The dedicated `/scheduled` surface exposes its own task composer, a recommended-template gallery and a task filter with:

```text
Active
Paused
Completed
```

Opening a persisted task exposes a native editor with:

```text
state badge
title textarea
prompt/instructions textarea
date control
time control
next-run presentation
Resume/Pause
Additional actions:
  Run now
  Notification settings
  Delete
```

On the disposable test fixture, title and prompt edits were saved through the native editor and remained persisted after closing and reopening the editor. A date edit from 9 October to 10 October also persisted after Save. The calendar disabled dates before the current day and allowed future dates.

The same fixture's persisted conversation history contains a completed explicit `Run now` request and its task result, while the task itself was paused. This establishes that manual execution is a distinct operation from enabling the recurring/one-shot schedule.

A desktop-notification affordance was also rendered:

```text
Enable desktop notifications
Allow
Not now
```

and the task overflow exposed `Notification settings`. The current capture did not mutate those settings or execute Delete; keep those as UI-observed management capabilities rather than transport-verified mutations.

### Scheduling vs notification delivery

Do not infer notification-channel behavior solely from `notifications_enabled` or `email_enabled` in one automation object. Those fields are task metadata and can coexist with product-level notification handling elsewhere.

## 8. Plugin/App catalog and Koba MCP Bridge

### Plugin discovery

Native plugin search uses:

```text
GET /backend-api/ps/plugins/search?q={query}&limit=50
```

The literal search `COBMCP` returned no catalog result; searching `Koba` exposed the actual installed display name `Koba MCP Bridge` along with other Koba apps.

### Plugin management bootstrap

Opening the management surface for an installed MCP app triggered reads including:

```text
GET  /backend-api/ps/plugins/{plugin_id}
GET  /backend-api/aip/connectors/{app_id}?include_actions=true
POST /backend-api/aip/connectors/links/list_accessible
GET  /backend-api/ca/v2/user/connection_status
```

The tested Koba MCP Bridge management page presented:

```text
Permissions
Connected accounts
App information
App management
  - Edit name
  - Edit description
  - Refresh tools
  - Delete app
```

It reported OAuth as both supported and currently used authentication for the connected account.

### Create a custom MCP app — live verified

The native `Add / Добавить` menu exposes three distinct authoring paths:

```text
Create plugin
Upload plugin archive
Create custom MCP server
```

The custom-MCP dialog exposes:

```text
optional PNG icon
  recommended >= 256 x 256
  maximum file size 10 KB
name
optional description
connection:
  server URL
  tunnel
authentication:
  OAuth
  no authentication
  OAuth or no authentication
risk acknowledgement
```

Entering a known MCP URL causes ChatGPT to discover OAuth configuration before creation. In the captured OAuth server, advanced settings exposed:

```text
client registration:
  custom OAuth client
  DCR
  CIMD
default scopes:
  read:user
authorization URL
token URL
registration URL
authorization-server base URL
resource URL
PKCE:
  S256
```

DCR was selected. CIMD was disabled because the server did not advertise it. OIDC remained unavailable because the server did not advertise an OIDC configuration URL.

Creation used:

```text
POST /backend-api/aip/connectors/mcp -> 200
```

Safe request shape:

```json
{
  "name": "<app name>",
  "description": "<optional description>",
  "mcp_url": "<MCP endpoint>",
  "logo_url": "<data:image/png;base64,... or null>",
  "auth_request": {
    "supported_auth": ["<discovered OAuth configuration>"]
  }
}
```

The returned connector is a new `asdk_app_...` object even when it points at the same MCP endpoint as an existing app. A second disposable app was successfully created against the existing Koba MCP endpoint, so app identity is not derived solely from server URL.

For OAuth apps, native installation then uses:

```text
POST /backend-api/aip/connectors/links/oauth
POST /backend-api/aip/connectors/links/oauth/callback
```

The callback returned an active link with the connector action set. Connector metadata exposed `enable_multi_links=true`, and the management UI exposed `Connect another account`, so multiple connected-account links are a separate concept from creating another app object.

### Create-time icon — live verified

A 256 x 256 PNG was supplied through the native icon input before creating a disposable MCP app.

The create request embedded the PNG as:

```text
logo_url = data:image/png;base64,...
```

The connector response normalized it into hosted icon assets:

```text
icon_assets.256_square
icon_assets.256_circle
```

After creation, the current native management surface exposes name, description, tool refresh and app deletion, but no icon-edit control or file input. Therefore:

```text
create-time icon upload      = live verified
post-create icon editing UI  = not exposed in this build
```

Do not infer a private post-create icon mutation endpoint from the create-time `logo_url` field.

### App name and description mutations — live verified

Name editing uses:

```text
PATCH /backend-api/aip/connectors/{app_id}/name -> 200
```

```json
{ "name": "<new name>" }
```

Description editing uses:

```text
PATCH /backend-api/aip/connectors/{app_id}/description -> 200
```

```json
{ "description": "<new description>" }
```

Both mutations returned the updated connector and were reflected in the native settings UI.

### Refresh tools — live verified

An earlier capture on the long-lived Koba MCP Bridge only exposed the post-refresh GET reconciliation. A later disposable-app capture resolved the missing write boundary:

```text
POST /backend-api/aip/connectors/mcp/refresh_actions -> 200
```

with safe request shape:

```json
{ "link_id": "<connected account link>" }
```

ChatGPT then re-read plugin metadata and connector action schema:

```text
GET /backend-api/ps/plugins/{plugin_id}
GET /backend-api/aip/connectors/{app_id}?include_actions=true
```

The action set remained the same six bridge actions in the captured app.

Therefore the verified semantic contract is:

```text
Refresh tools
  = server refresh_actions operation scoped to a connected-account link
  + client reconciliation of current plugin/connector action metadata
```

The older GET-only observation was incomplete evidence, not a different contract.

### Connected-account menu

The native connected-account action menu exposed:

```text
Settings
Reconnect
```

### Account permission settings — live verified

Permissions are stored on the connected-account link, not only on the app object.

The native settings surface exposes:

```text
Always ask for confirmation
  -> ask before reads or changes

Allow read-only tools
  -> reads may run without confirmation; changes still require confirmation

Allow low-risk tools             # default in captured account
  -> low-risk tools can be auto-approved; higher-risk tools may be rejected/require care

Allow all tools                  # elevated risk
  -> use tools without confirmation
```

The actual stored values observed in the radio controls are:

```text
always_ask
ask_before_writes
review_important_actions
full_access
```

Every mode was exercised on the disposable OAuth link. The mutation contract is:

```text
PATCH /backend-api/aip/connectors/links/{link_id} -> 200
```

```json
{ "apps_privacy_control": "<mode>" }
```

A new disposable connection defaulted to `review_important_actions` (`Allow low-risk`). After testing, it was restored to that default.

### Delete app — live verified

The native destructive confirmation states that the app and its connections are permanently deleted and that the action cannot be undone.

Both an unconnected disposable app and a connected OAuth disposable app used the same mutation:

```text
DELETE /backend-api/aip/connectors/{app_id} -> 200
```

After success, the client returned to the plugin settings list. A subsequent plugin metadata read returned `404`.

This is an app-object deletion, not merely disconnecting one connected-account link.

## 9. OAuth reconnect / reauthorization

### User flow

Native `Reconnect` initiated a multi-stage flow:

```text
Connected account actions
  -> Reconnect
  -> ChatGPT connector-risk/permission disclosure dialog
  -> Continue to provider
  -> provider OAuth authorization-code + PKCE flow
  -> ChatGPT OAuth callback
  -> account/link refresh
```

The provider OAuth request asked for the connector's declared user-read scope in the captured flow. Exact OAuth client ids, state, code challenge, authorization code and tokens are intentionally not recorded here.

### ChatGPT reauth initiation

Live verified:

```text
POST /backend-api/aip/connectors/links/oauth/reauth -> 200
```

Safe request shape:

```json
{
  "callback_url": "<ChatGPT callback URL>",
  "link_id": "<existing connector link>",
  "post_auth_url": "<ChatGPT return URL>"
}
```

The response/flow then navigated to the provider OAuth authorize endpoint with normal authorization-code/PKCE parameters.

### OAuth callback

After provider authorization the client submitted:

```text
POST /backend-api/aip/connectors/links/oauth/callback -> 200
```

with the full provider redirect URL. The callback response returned the refreshed connector link.

Live postcondition:

```text
auth_type   = OAUTH
auth_status = ACTIVE
actions     = current connector action set
```

### Post-reauth reconciliation

After callback ChatGPT refreshed connector/account state through reads including:

```text
GET  /backend-api/ca/v2/user/connection_status
GET  /backend-api/aip/connectors/{app_id}?include_actions=true
GET  /backend-api/aip/connectors/{app_id}/link
POST /backend-api/aip/connectors/links/list_accessible
```

This is the correct evidence boundary for a successful reconnect: returning to the settings page alone is not sufficient; the refreshed link should be active and current connector actions should load successfully.

### Existing provider session

In the captured reconnect test no additional username/password entry was required. After the ChatGPT disclosure step, the provider authorization completed using an existing authenticated provider session and returned automatically.

Do not generalize this to every user/session. Reconnect may require interactive provider login or consent when no valid provider session exists.

## 10. Cleanup contract for test workflows

When running product-operation acceptance tests:

1. use an explicitly named temporary project;
2. keep destructive actions scoped to that temporary project/chat;
3. disable test automations after observing them;
4. delete the temporary test chat through the native confirmation flow;
5. delete the temporary project through Project Settings;
6. do not disconnect/remove a real connector merely to test reauthorization when native Reconnect is available;
7. never persist OAuth codes/tokens, account ids, emails or connector-link ids in docs/log excerpts.

The 2026-10-07 acceptance run followed this cleanup boundary: both test automations were disabled, the test chat was deleted, and the test project was deleted. Koba MCP Bridge remained installed and connected after a successful native reconnect/reauth.

## 11. Product-operation coverage and validation checklist

This table is the durable coverage map for the browser-product research. Do not treat a visible control as equivalent to a verified operation. `Live` means the native action/postcondition was exercised; `mixed` means live UI/postcondition is paired with client-code transport evidence; `client-code` means the exact deployed implementation was found but not executed at that boundary.

| Direction | Evidence | Current contract |
| --- | --- | --- |
| Project create/delete | Live | create/delete endpoints and native postconditions verified |
| Project Instructions | Live | explicit Save submits `PATCH /backend-api/projects/{id}`; not autosave |
| First chat in Project | Live | fresh `/f/conversation` allocates server conversation id |
| Chat rename/delete | Live | dedicated rename/delete mutations verified |
| True branch | Mixed | separate branch conversations and parent marker live; `/conversation/new_branch` request shape client-code confirmed |
| User-message edit | Live | same conversation id; creates navigable in-conversation version branch |
| Version navigation | Live | previous/current version UI changes visible branch without changing conversation id |
| Assistant response variant | Live + client-code | custom response variant live; retry menu observed; retry transport `action="variant"` client-code confirmed |
| Model / reasoning effort | Live | outbound `model` and `thinking_effort` matrix verified |
| Automations create/update/manage | Live | create/update/disable plus native title, prompt and schedule edits persisted; Run now previously executed live |
| Native structured user input | Live | request/response correlation and history compaction verified |
| Plugin discovery/management | Live | catalog and management bootstrap verified |
| Custom MCP creation | Live | connector creation, OAuth discovery/DCR and OAuth link activation verified |
| MCP create-time icon | Live | PNG is embedded as create-time `logo_url` and normalized to hosted icon assets |
| MCP post-create icon edit | Negative UI result | no native post-create icon edit/file input exposed in captured management UI |
| MCP permissions | Live | per-link `apps_privacy_control` modes round-tripped and default restored |
| MCP rename/description | Live | dedicated connector name/description PATCH routes verified |
| MCP Refresh tools | Live | `POST /aip/connectors/mcp/refresh_actions` + metadata/action reconciliation verified |
| MCP reconnect / reauth | Live | reauth, provider OAuth callback and ACTIVE link/action reload verified |
| Multiple MCP links / duplicate endpoint | Live metadata/UI | separate app over same endpoint created; `enable_multi_links=true`; another-account affordance exposed |
| MCP delete | Live | disposable connector delete and 404 postcondition verified |
| Work classification | Live + client-code | `tpp|flora` source classifier established |
| Work sub-agents | Live | child thread identity, started/completed lifecycle and native panel verified |
| Conversation-scoped load failure | Live | distinct single-conversation failure/retry state verified |
| Image attachment persistence | Live | historical image survives branch/edit/variant/reload; Estuary asset resolver previously verified |

Remaining evidence boundaries relevant to this product-operation map:

- the exact native `Попробовать еще раз` request has not been intercepted live in the current build, although the affordance is live-observed and its `action="variant"` request builder is client-code confirmed;
- the exact `POST /conversation/new_branch` request was not intercepted during the later live branch acceptance, although separate branch conversations and parent-link postconditions were verified live;
- post-create icon replacement is not exposed by the captured native MCP management UI.

These are evidence-level distinctions, not reasons to repeat already-verified adjacent workflows.

Before claiming a future product-operation integration complete, verify the specific operation at its actual source boundary and preserve the evidence level above.

## 12. Work mode and sub-agents

### Work surface classification

A live browser acceptance run on 2026-10-07 created a fresh conversation from the
native `Work / Работа` composer surface.

The fresh submission carried:

```text
conversation_origin = tpp
model               = gpt-6-astra-wm
local_function_names includes local.continue_in_work
```

Deployed client code independently classifies both `conversation_origin="tpp"` and
`conversation_origin="flora"` as the Work product experience. Treat this source
metadata as the product-surface classifier; do not infer Work from localized labels,
model choice, URL shape or CSS.

Booster product policy for Work conversations is inspection-only in the browser.
Work conversations must be visually distinct from ordinary Chat conversations and
should direct implementation activity to Codex rather than encouraging browser Work.

### Sub-agent lifecycle — live verified

A Work conversation explicitly requested exactly two independent parallel sub-agents.
The native client created both:

```text
/root/multiply
/root/primes
```

Each child received its own stable `agentThreadId`. Parent history represented child
lifecycle with hidden source records:

```text
metadata.codex_sub_agent_activity:
  type = subAgentActivity
  agentPath
  agentThreadId
  kind = started | interacted | completed | interrupted
```

The captured run contained a distinct `started` and `completed` record for each child.
The parent also emitted `codex_collab_agent_tool_call` records, including `tool="wait"`,
while waiting for children. A completed wait call is not itself proof that every child
is complete; child status must remain keyed by its own thread/activity evidence or
explicit per-agent state.

Native presentation exposed a `Subagents / Субагенты` panel with separate Active and
Done groups. After both children completed it showed `Done · 2`.

Opening one child caused:

```text
GET /backend-api/flora/subagent/thread/turns
  ?conversationId=<parent conversation>
  &threadId=<agentThreadId>
```

In the captured attempt this detail request returned HTTP 500 while the child remained
authoritatively `Done` in the parent conversation. Therefore child lifecycle state and
detail/result availability are separate axes.

The parent conversation history retained the child activity records after completion,
so Booster can reconstruct sub-agent lifecycle without depending on the detail endpoint.


### Booster Work UI acceptance

The published browser build was live-checked on a native Work conversation. Booster rendered a red inspection-only Work warning and, after successive short child runs, accumulated three distinct completed sub-agents with active count zero. Native Work UI independently showed the same completed child count.

This validates completed-state correlation and Work-surface warning behavior. A deployed-build snapshot with Booster visibly showing an active child count greater than zero is still a separate acceptance point; do not claim that presentation boundary from completed-state evidence alone.


### Active child presentation fallback

Live acceptance found a short timing gap between native Work rendering and Booster source ingestion: native Work can show a child as started before the corresponding source record has reached Booster RAM. Booster may use the adapter-owned `chatgpt-subagent-activity` renderer signal to supplement the visible active count during that gap. Source records remain authoritative and supersede the fallback once available.

## 13. Browser workflow coverage

The cross-feature checklist, including native file uploads, Library preview/download, chat-only attachments, generated CSV download, scheduled-event capabilities, Work browser and product-help-only features, is maintained in [CHATGPT_BROWSER_WORKFLOWS.md](CHATGPT_BROWSER_WORKFLOWS.md). **Do not** treat a file chip, a model claim about Python, a generated-file card or a documentation statement as the same level of evidence as a submitted attachment, an observed code-execution trace or downloaded bytes.

## 14. Pro Space and plugin/task navigation — browser observed (2026-10-07)

The external remote Playwright acceptance on the Intens Tech / Pro profile confirmed that `/library` navigates to `/space`, rather than the Free account's former Library interface. Saving a synthetic CSV, reopening it after a full reload, selecting it for `Начать чат`, and then actually executing Python in the resulting normal Chat is documented in `CHATGPT_BROWSER_WORKFLOWS.md` and `CHATGPT_CLIENT_RESEARCH.md`.

The Pro `/scheduled` landing surface exposed task suggestions but no new task was created. `/space/sites` prompted for separate Sites terms; those terms were not accepted. `/plugins` has separate Public/Personal tabs, with custom Koba apps listed in Personal; listing an app does not establish a connected authorized provider account. These do not supersede earlier OAuth and task lifecycle evidence.

## 15. GPT-6 current Chat selector (2026-10-07)

The externally authorized Pro ordinary Chat picker selected GPT-6 and displayed a five-position effort slider at High (3/5). The two alternate radios were GPT-5.6 Sol and GPT-5.5. Slider mutation was not reproduced in this attempt, though a separate earlier Pro run confirmed High → Medium → High; model-radio change was blocked. Do not mark model-radio selection validated; the later live GPT-6 acceptance above verifies High and Very High outbound fields. See CHATGPT_BROWSER_WORKFLOWS.md.

## 16. GPT-6 rollout: ordinary Chat vs Work (2026-10-07)

A newly opened external Pro Chat tab had `Чат` selected and `Работа` not selected while `GPT-6` was checked in the model menu; a separate **Work** conversation displayed `GPT-6 Astra`. Per the official 7 October GPT-6 release, Chat receives the new GPT-6 Sol-backed experience while the Work/Codex models are unchanged by that update. The user's specific `GPT-6 Finetuning` chat was not among available remote tabs and was not classified. One High → Medium → High transition was previously verified; all five UI positions have since been exercised and the restored level persisted after reload; High/Very High outbound values are verified, while the other three mappings remain pending. Do not infer them from picker state alone.
