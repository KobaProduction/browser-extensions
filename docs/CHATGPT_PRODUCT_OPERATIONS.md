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
- `docs/CHATGPT_CLIENT_RESEARCH.md` — raw/live reverse-engineering evidence and proof boundaries.
- `docs/ARCHITECTURE.md` — package ownership and stable architectural invariants.

The contracts below describe observed ChatGPT client behavior. They are not an invitation to synthesize private ChatGPT mutations. Prefer observing native user/client actions unless a Booster feature has an explicit documented need to perform one.

## 1. Evidence and authority

For product operations use the same evidence discipline as runtime reverse-engineering:

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

This branch operation has not yet received a dedicated live mutation acceptance test.

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

### Live transport matrix

Each row below was verified by submitting a new short message after selecting that position and reading the outbound `/backend-api/f/conversation` body.

| UI level | Transport `model` | Transport `thinking_effort` |
| --- | --- | --- |
| Instant | `gpt-5-6` | omitted |
| Medium | `gpt-5-6-thinking` | `standard` |
| High | `gpt-5-6-thinking` | `extended` |
| Very High | `gpt-5-6-thinking` | `max` |
| Pro | `gpt-6-pro` | omitted |

### Important consequence

The top `Pro` position is not merely a higher `thinking_effort` value on GPT-5.6. In the captured product build it switched the actual transport model to `gpt-6-pro`.

Likewise, `Instant` used the non-thinking `gpt-5-6` transport model rather than `gpt-5-6-thinking` with a low effort value.

Feature code must therefore consume actual transport/model metadata and must not derive model identity from ordinal UI position alone.

### Model list vs effort control

The visible model menu and the five-position reasoning-power control are related but distinct product concepts. The exact available model list is account/build dependent and should not be hard-coded from one capture.

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

## 11. Validation checklist

Before claiming a product-operation integration complete, verify the specific operation at its actual source boundary.

Project/chat operations:

```text
project create      -> POST /backend-api/projects + project route
first project chat  -> fresh /f/conversation + new server conversation id
chat delete         -> DELETE /conversation/id/{id} success
project delete      -> DELETE /gizmos/{project_id} success
rename              -> POST /conversation/id/{id}/rename success
branch              -> /conversation/new_branch (live acceptance still needed)
```

Model selection:

```text
read outbound model + thinking_effort
never infer solely from UI label
```

Automations:

```text
verify persisted automation object in scheduled/paused list
verify timing_mode and VEVENT schedule
verify is_enabled transition after update
```

Plugin/MCP management:

```text
Refresh tools  -> current action schema re-read
Reconnect      -> OAuth reauth + callback + ACTIVE link + action reload
Permissions    -> treat per-account approval policy as separate from OAuth auth state
```


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
