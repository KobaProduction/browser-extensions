# Conversation Archive and History Loader

This document defines the local archival subsystem for ChatGPT Booster.

The goal is to build a complete local, queryable copy of conversation data that the normal ChatGPT client has already received. Booster must observe and index that data without issuing private history requests itself.

## Principles

1. **Read-only toward ChatGPT.** Archive ingestion observes client traffic; it does not synthesize private API requests.
2. **Local-first.** Conversation content is stored in IndexedDB inside the browser profile.
3. **Lossless first, normalized second.** Preserve full raw records plus normalized fields used for indexes and UI.
4. **Graph, not list.** Conversations and messages can branch.
5. **Idempotent ingestion.** Re-observing the same page/message does not create duplicates.
6. **Incremental completeness.** A conversation can be partially archived and later become complete.
7. **Observable provenance.** Records store when/how they were seen so stale/partial state is distinguishable from confirmed current state.
8. **No chat content telemetry.** OTLP is operational only.

## Storage technology

Use IndexedDB.

Do not use `localStorage` for the archive: payloads can be large, synchronous writes block the page, and there is no useful indexing/transaction model.

Do not use InfluxDB for browser-local history: it is a server/time-series database and would violate the local/private archive design.

A small wrapper may be used, but the persistent schema must remain explicit and versioned.

## Database identity

Database name:

```text
chatgpt-booster-archive
```

Current archive database version:

```text
3
```

Version 1 is treated as a legacy boundary: the current upgrader aborts rather than silently deleting or rewriting an existing v1 archive. Version 3 adds the current preload/asset-era schema while preserving explicit migrations.

## Object stores

### `conversations`

Primary key:

```text
conversationId
```

Suggested normalized record:

```ts
interface ArchivedConversation {
  conversationId: string
  projectId: string | null
  title: string | null
  conversationOrigin: string | null
  conversationTemplateId: string | null
  gizmoId: string | null
  gizmoType: string | null
  defaultModelSlug: string | null
  currentNodeId: string | null
  createdAt: number | null
  updatedAt: number | null

  isArchived: boolean | null
  isReadOnly: boolean | null
  isTemporaryChat: boolean | null
  isStarred: boolean | null
  isStudyMode: boolean | null
  isDoNotRemember: boolean | null

  branchSourceConversationId: string | null
  branchSourceTitle: string | null

  firstSeenAt: number
  lastSeenAt: number
  lastFullReadAt: number | null
  archiveState: 'unknown' | 'partial' | 'complete' | 'stale'

  raw: Record<string, unknown>
}
```

`projectId` is derived from the observed project `gizmo_id` when the conversation is project-backed. It remains nullable for ordinary conversations and must not be inferred from unrelated gizmo types.

Useful indexes:

```text
projectId
updatedAt
archiveState
branchSourceConversationId
lastSeenAt
```

### `messages`

Primary key:

```text
messageKey
```

`messageKey` is a deterministic conversation-scoped key derived from conversation/message identity. Message IDs are not globally unique across conversations: branched conversations can reuse message IDs from their source history, so persistence must not use raw `messageId` as the object-store key.

Suggested record:

```ts
interface ArchivedMessage {
  messageKey: string
  messageId: string
  conversationId: string
  projectId: string | null

  parentId: string | null
  turnExchangeId: string | null
  workingTurnId: string | null
  requestId: string | null

  role: string | null
  authorName: string | null
  recipient: string | null
  channel: string | null
  contentType: string | null
  messageType: string | null

  status: string | null
  endTurn: boolean | null
  weight: number | null
  createTime: number | null
  updateTime: number | null

  modelSlug: string | null
  resolvedModelSlug: string | null

  firstSeenAt: number
  lastSeenAt: number
  payloadHash: string

  raw: Record<string, unknown>
}
```

Useful indexes:

```text
conversationId
projectId
parentId
turnExchangeId
workingTurnId
role
contentType
messageType
createTime
lastSeenAt
[conversationId, createTime]
[conversationId, parentId]
[conversationId, turnExchangeId]
```

Unknown role/content/message types are valid and must still be stored.

### `conversationPages`

A history response is also evidence about coverage.

Primary key:

```text
pageKey
```

Current record also carries read identity so evidence from different rereads cannot be mixed:

```ts
interface ArchivedConversationPage {
  pageKey: string
  conversationId: string
  readId?: string
  readStartedAt?: number
  isInitial?: boolean
  requestedBefore?: string | null
  startCursor: string | null
  endCursor: string | null
  hasPreviousPage: boolean | null
  hasNextPage: boolean | null
  messageIds: string[]
  observedAt: number
  sourceUrl: string
  captureReasoning?: boolean | null
  captureTools?: boolean | null
  captureInternal?: boolean | null
  omittedRecordCount?: number | null
}
```

Useful indexes:

```text
conversationId
observedAt
hasPreviousPage
```

### `conversationCoverage`

One small materialized state record per conversation makes UI decisions cheap.

Primary key:

```text
conversationId
```

Suggested record:

```ts
interface ConversationCoverage {
  evidenceVersion?: number
  readId?: string | null
  readStartedAt?: number | null
  verifiedAt?: number | null
  historyPageCount?: number
  visibleMessageCount?: number
  internalRecordCount?: number
  conversationId: string
  oldestKnownMessageId: string | null
  newestKnownMessageId: string | null
  oldestKnownVisibleMessageId?: string | null
  newestKnownVisibleMessageId?: string | null
  oldestKnownCursor: string | null
  newestKnownCursor: string | null
  hasOlderServerHistory: boolean | null
  hasNewerServerHistory: boolean | null
  knownMessageCount: number
  knownBranchConversationIds: string[]
  lastObservedAt: number
  lastFullReadAt: number | null
  completeAtLastRead: boolean
}
```

`completeAtLastRead=true` is evidence, not a permanent guarantee. The chat can later change, so the UI must always offer a forced reread.

### `assets`

This store holds client-visible file/image references and the latest verified resolver state for archive packaging.

Primary key:

```text
assetId
```

Only client-visible stable asset identifiers already observed in message metadata are accepted into this store.

Current normalized fields:

```text
assetId
fileName
mimeType
sizeBytes
width
height
kind
downloadUrl
resolverObservedAt
firstSeenAt
lastSeenAt
```

The stable identity is `assetId`, not the signed URL. A verified resolver may populate `downloadUrl`, but signed URLs expire and are refreshed only when the normal ChatGPT client exposes a matching resolver/content URL. Export must never invent or persist a foreign URL as an asset resolution.

### `projects`

The current client identifies projects with `g-p-...` IDs and carries that value as conversation `gizmo_id`.

The store should use the normalized `projectId` name while preserving raw ChatGPT project/gizmo payloads. Initial fields should include:

```text
projectId
title
slug
firstSeenAt
lastSeenAt
raw
```

Project list/detail classifiers should be added only for response shapes that have been observed; conversation ingestion can already associate a conversation with a project from its history envelope.

### `preloadPages`

The current implementation keeps a bounded current-chat preload cache even when automatic archival is disabled. This lets manual collection promote history that the normal ChatGPT client already fetched before the user explicitly started collection.

Current key/index contract:

```text
primary key: pageKey
indexes: conversationId, expiresAt
```

Preload data is not persistent consent. It is promoted into the archive only when current policy or an explicit manual ticket permits it, and stale reads must not contaminate a newer read.

### `ingestEvents` (optional, bounded)

A small bounded diagnostic store can record archive pipeline events without message content:

```text
conversation-page-observed
messages-inserted
messages-updated
page-duplicate
history-loader-started
history-loader-progress
history-loader-complete
history-loader-error
```

It should have a retention/maximum-count policy so it cannot grow indefinitely.

## Upsert semantics

A strict "insert if missing, otherwise ignore" rule is not sufficient because a message can be observed before it reaches its final state.

Use semantic upsert:

1. Normalize the message.
2. Compute a deterministic hash of the full raw payload.
3. Look up by `(conversationId, messageId)`. If that scoped record does not exist: insert it.
4. If it exists and `payloadHash` is unchanged: update only `lastSeenAt` if needed.
5. If it exists and the payload changed: replace normalized/raw payload and hash, preserving `firstSeenAt`.

This handles streaming/finalization, edit/regenerate metadata changes, and future client behavior without creating duplicates.

## Graph representation

### Message graph

Edges are currently derived primarily from:

```text
message.metadata.parent_id -> message.id
```

The graph renderer should not require every parent to exist locally. Partial archives can legitimately contain dangling parent IDs until older pages are loaded.

### Conversation branch graph

Observed branch metadata can point from one conversation to another:

```text
branching_from_conversation_id
branching_from_conversation_title
branching_from_conversation_owner
```

The archive should derive a conversation-level edge:

```text
source conversation -> branch conversation
```

The read-only Archive Browser renders a project-local forest of trunk, branch and nested-branch conversations. Search retains matching conversations and their available ancestors. Missing source conversations remain visible as orphan roots, and malformed/cyclic provenance is shown at most once per conversation rather than hiding records. Branch provenance remains unmodified in IndexedDB.

The archive reader opens at the latest saved turn, preserving chronological record identity. It mounts a bounded tail window (initially 40 turns) and progressively extends the visible history by 40 older turns as the user scrolls toward the earlier edge, preserving the viewport anchor. The title, reasoning toggle, ordering, export, search and coverage controls remain separate from the scrolling message pane. A reverse-order control makes the newest exchange the first item. Reasoning is collapsed by default.

**Evidence boundary:** currently this is progressive **UI rendering**, not paginated IndexedDB reads; the shared archive read model still loads and groups the stored conversation before the viewport is displayed. It must not be represented as incremental storage/history capture. Future storage-level pagination needs to preserve turn correlation, raw record identity and coverage proofs.

## Turn grouping

For display/search, derive a turn group using this precedence:

1. `turn_exchange_id` when present;
2. `working_turn_id` when present;
3. parent-chain/time adjacency fallback only for legacy/unknown records.

A turn group can contain multiple records:

```text
user message
model editable context
reasoning/thoughts
one or more tool calls/results
reasoning recap
final assistant message
```

Do not collapse these records destructively in persistent storage. Group only in the view model.

## Ingestion source

The authoritative ingestion path is the MAIN-world transport observer because it sees traffic already initiated by ChatGPT.

Archive payloads must use a dedicated local-only channel separate from telemetry diagnostics.

Example conceptual flow:

```text
ChatGPT fetch/XHR
    -> MAIN observer clones successful relevant response
    -> route/shape classifier
    -> window.postMessage(archive payload)
    -> isolated content script
    -> IndexedDB transaction
    -> archive state notification
```

### Relevant traffic classifier

Initially ingest only responses positively identified as conversation/history data, for example a successful response whose URL/shape matches the observed conversation history route and whose parsed body contains:

```text
conversation_id
messages[]
page_info
```

Do not persist unrelated ChatGPT analytics, ads, billing, account bootstrap, heartbeats, or generic WebSocket traffic.

Add separate classifiers for textdocs/assets/project APIs only after their shapes are documented.

## Payload handling

The current generic transport observer truncates/redacts body previews. That is correct for telemetry but insufficient for a lossless local archive.

Therefore archive capture needs a separate path:

- only for explicitly classified conversation/history responses;
- no telemetry export;
- full parsed response sent only across the local MAIN -> isolated-world bridge;
- maximum sanity limits to prevent pathological memory use;
- parsing/storage errors isolated from ChatGPT's response path;
- original response object/body semantics must remain unchanged.

For fetch, use `response.clone()` after the original request resolves. Archive parsing must never consume the original stream.

## History Loader

The History Loader exists only to make the normal ChatGPT client request older history in the same way the UI normally would.

It must not call private endpoints itself.

### Trigger discovery

Do not hard-code an assumed scroll threshold. Detect and reuse the actual conversation scroll container and observe evidence of loading:

- scroll position approaching the top;
- DOM insertion of older turns;
- appearance/disappearance of loading indicators if available;
- archive ingestion of a new page/cursor;
- network lifecycle for the observed conversation-history route.

The observed older-page request is:

```text
/backend-api/conversations/{conversation_id}/messages?before={start_cursor}&include_has_versions=true&num_turns=10
```

The loader still must not call this endpoint itself. It uses a newly ingested continuation page as the strongest success signal.

### State machine

```text
idle
  -> preparing
  -> scrolling
  -> waiting_for_load
  -> page_ingested
  -> delay
  -> scrolling

waiting_for_load -> transient_error -> backoff -> scrolling
waiting_for_load -> no_progress -> recovery_scroll -> scrolling
page_ingested -> complete (when coverage says no older server history)
any state -> cancelled
any state -> fatal_error
```

### Human-like scrolling

Use small smooth movements on the real scroll container, not global keyboard automation.

Suggested initial ranges, configurable and not security-sensitive:

```text
step: 35-65% of visible container height upward
inter-step delay: 350-850 ms
post-load delay: 500-1400 ms
transient error backoff: exponential, capped
recovery scroll: small downward movement followed by retry
```

Randomness exists to avoid abrupt mechanical UI behavior, not to bypass platform controls.

### Progress condition

A loader iteration counts as progress when one or more of these changes:

```text
oldest archived message
oldest page cursor
known message count
conversation DOM oldest turn
```

The best signal is a newly ingested server page/cursor.

### Completion

A full read completes when archive evidence shows that the earliest loaded page has no previous page, or an equivalent observed server field explicitly states no older history.

Do not infer completeness merely because scrolling reached `scrollTop=0`; virtualized UI/loading failures can make that misleading.

### Error recovery

For a transient load/network error:

1. stop upward movement;
2. wait with bounded backoff;
3. optionally scroll slightly down to leave/re-enter the trigger zone;
4. retry;
5. stop after a configurable consecutive-error limit and expose the failure in UI.

Never enter an infinite retry loop.

## Reread semantics

Even a previously complete archive can become stale due to:

- edits;
- regenerations;
- branch creation;
- message metadata changes;
- later attachments/textdocs;
- client schema changes.

Therefore every conversation exposes a `Reread` action.

A reread:

- reloads the currently visible conversation through normal UI behavior;
- allows observed records to semantic-upsert;
- walks to oldest history again if requested;
- updates `lastFullReadAt` and coverage state only when completeness is reconfirmed.

## UI contract

### Launcher

Replace the temporary `B` text launcher with a proper Booster icon.

Clicking the in-page launcher opens a **conversation quick panel**, not the full settings screen.

### Conversation quick panel

When a conversation is open, show at least:

```text
conversation title
conversation ID (copyable)
project name/ID when known
archive state
known message count
branch count/branch origin when known
last seen / last full read
```

Primary actions:

```text
Read older history / Read to start
Reread conversation
Open archive
Open full settings (gear)
Stop current loader
```

Suggested archive-state presentation:

```text
Not archived
Partially archived
Complete at <time>
Possibly stale
Reading… <progress>
Error / Retry
```

If coverage is partial, the primary action should visually emphasize continuing the read.

### Full settings

The existing Control Center remains the full settings surface and should open from:

- extension toolbar action/popup;
- userscript menu entry;
- gear button in the quick panel.

It should not remain the default panel opened by the in-page launcher.

### Archive view

The first archive UI can be simple: message/turn list with filters and raw diagnostics.

The Archive Browser now displays the conversation branch forest inside each project, in addition to read-only turn grouping, search, reasoning/tool records and coverage. The underlying message-level parent graph visualization remains a separate possible extension; it is not implied by the conversation-level branch forest.

## Telemetry boundary

The archive and History Loader must never send raw conversation data to the configured telemetry collector.

Operational telemetry may report only aggregate events, for example:

```text
archive.page_ingested message_count=25
archive.history_complete page_count=7
archive.loader_error class=network
```

Do not include conversation IDs or titles unless the user explicitly opts into an advanced diagnostic mode in the future.

## Implementation phases

### Phase 1 — evidence and core archive

- document observed contracts;
- maintain regression coverage for the observed older-page continuation contract;
- maintain regression coverage for the observed project contract;
- implement IndexedDB schema/migrations;
- implement conversation-response classifier;
- implement lossless local ingest path;
- expose archive coverage diagnostics.

### Phase 2 — History Loader

- robustly identify conversation scroll container;
- implement loader state machine;
- drive normal scrolling only;
- wait for archive-page ingest as success signal;
- implement cancellation/backoff/recovery.

### Phase 3 — Quick panel

- replace `B` launcher icon;
- show chat/project/archive status;
- add Read to start / Reread / Stop / Settings actions.

### Phase 4 — Archive reader and graph

- searchable turn/message list;
- reasoning/tool grouping;
- attachment/textdoc references;
- branch graph visualization;
- coverage visualization.

## Acceptance criteria for the first complete archive slice

1. Opening a conversation automatically archives every conversation-history response the normal ChatGPT client receives.
2. No private history request is initiated by Booster.
3. Repeated pages/messages are idempotent.
4. Changed records semantic-upsert without duplicating IDs.
5. Raw message payloads are preserved losslessly in IndexedDB.
6. Reasoning/tool/system/user/assistant records remain separately queryable.
7. Parent and branch relationships are persisted.
8. Coverage explicitly distinguishes partial vs complete.
9. A user can start/cancel a Read to start operation.
10. Loader success is driven by observed history-page ingestion, not arbitrary timeouts alone.
11. Full reread is always available.
12. Chat content never reaches OTLP telemetry.

### Read-only message-node rail (first visual iteration, 2026-10-08)

Archive Browser overlays a compact message-node rail on the saved exchange stream: round
nodes for user messages, square nodes for assistant replies. A node's lane is derived
from explicit `parentId` edges, with sibling variants shown as separate lanes and
numbered variant markers. Tool/reasoning/system details stay under the corresponding
exchange and do not create new graph nodes. Unknown parents and malformed cycles never
create inferred edges or remove messages; lanes are deliberately capped for narrow UI.

This is a **visual prototype**, not a complete DAG editor. It does not switch native
ChatGPT versions, identify a canonical active path, prove missing ancestors, or claim
complete historical branch coverage. The conversation-level project forest remains
independent. Full graph navigation, loading indicator, and oldest-endpoint jump are
tracked separately in #38 and #39.

### Fixed chronology navigator and saved-title metadata (2026-10-08 redesign)

The former inline message-node decorations have been replaced by a fixed side
timeline. This rail is independent of the exchange cards: it keeps earliest/latest
saved endpoints visible, samples ordinary message checkpoints on long threads,
retains explicitly observed sibling forks, and enlarges the neighbourhood around
the reader's current position. Hover/focus previews present the saved message text
and source timestamp when available. Clicking a checkpoint mounts a bounded
window centred on it, without mounting the entire intervening history. Scrolling
can shift that window; the loader indicates preparation of additional UI records.

The reader opens at the latest or earliest *saved* message according to the
persisted Control Center preference. This is a UI positioning preference, not
proof that the full ChatGPT conversation has been captured. The compact status
icon reports whether the start was verified through linked source pagination;
unknown evidence must not be restated as a confirmed missing beginning. Branch
links are drawn only from observed `parentId` values; incomplete ancestor
metadata is not silently guessed.

The existing native-client conversation catalog is also observed for title
changes. Observed names update **existing** saved conversation metadata in one
IndexedDB transaction and refresh the sidebar; they never cause an unselected
conversation to be archived. The browser fixture additionally contains a separate
synthetic Free-shaped conversation with two internal edited-message fork points.
That is synthetic acceptance evidence, not live Free-account acceptance.

The current `getThread` still materializes the local saved thread before applying
the view window; this iteration does **not** establish paginated IndexedDB reads
or guarantee bounded peak memory for enormous archives. The separate
source-pagination/history-coverage and full message-DAG reconstruction tasks
remain tracked in #38 and #39.

### Free-profile local branch fixture and checkpoint connectors (2026-10-08)

The server-managed Chromium is authenticated to a ChatGPT Free account, but the
repeatable browser acceptance suite uses the isolated synthetic fixture origin,
not private Free conversation history. The fixture contains two edited-message
fork points within **one conversation**, with original and alternative descendants.

The navigation rail now renders read-only graph connector paths between selected
checkpoints only when the entire parent-message chain was observed. It traverses
observed intermediary internal records as needed; a missing parent, a cycle, or
an unknown intervening message terminates the drawn edge instead of inventing
continuity. The compact central rail remains a visual location cue, not an
assertion that missing history was captured. The archive remains read-only.

The browser fixture asserts that sibling fork checkpoints and verified graph
connector paths are rendered; the source tests cover both fork retention and
unknown-parent gaps. Live Free page integration with an installed Booster
userscript and live ChatGPT editing/version-switching is a separate validation
level from this isolated fixture.

### Read-only sibling variant navigation (2026-10-08)

The archive reader exposes observed user-message sibling forks as small groups of
clickable saved variants. Selecting one focuses the corresponding checkpoint and
opens its bounded local reading window; this does not mutate ChatGPT's active
conversation path or claim a globally verified active branch. Groups require at
least two distinct user message IDs sharing an explicit parent ID; duplicate
records and messages lacking parent evidence are not treated as forks. The
archive retains all variants without deleting older descendants. Local Free-shaped
fixture covers two forks and alternate variant selection in managed Chromium.
