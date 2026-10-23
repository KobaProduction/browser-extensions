# ChatGPT live observation and archive corrections

Owner decision: 2026-10-15. This contract supersedes earlier permission to
derive generation state or records from renderer/DOM fallback. The owner's later
acceptance instruction authorizes isolated synthetic/fake-IndexedDB tests and
UI Lab browser review. Installed-provider protocol, real-data and release
acceptance remain separate gates; synthetic evidence does not establish them.

## RAM gateway and read workspace (owner correction, 2026-10-16)

The first circuit is an exported `ConversationObservationGateway`: verified
owner/epoch-scoped page-session RAM, independent of archive and remote settings.
Native pages, message variants, request, stop, stream-status and terminal events
enter it before canonical projection. Unsupported source shapes remain available
as raw RAM evidence; they do not become canonical messages or automation facts.
Maps index conversations, message UUIDs and their observation sequences. Receipt
order and UUID sorting never establish parent links or prove chronology.

The second circuit consumes admitted source evidence. Enabling/changing capture
or remote routing replays the retained page and stream evidence through current
permissions. Replay does not manufacture another network receipt, update native
lifecycle timing, or rerun commands/triggers. Canonical writes remain idempotent;
remote consumers acknowledge queue admission and deduplicate by owner/epoch,
destination, source body and evidence. Local commits and external delivery use
separate queues. Local storage failure does not remove the first circuit.
Full installation teardown and verified account changes revoke authority and
clear session RAM; disabling archive capture alone does neither. RAM is not
durability across a document reload or a substitute for early hook installation.

Ordinary archive viewing uses `ConversationArchiveWorkspace`, with UUID-keyed
records, parent/child indexes, indexed missing parents and a cached chronological
window index. Live source records are usable immediately with capture off.
Saved canonical originals hydrate into that workspace in read-only transactions
of at most 160 records. Hydration neither increments network receipt counts nor
writes/replays observations; source advances win over older saved projections.
The UI shows loading progress and currently missing parents while chunks arrive.
An explicit saved-revision inspection remains pinned for export/navigation
validation. Existing saved export/backup still requires canonical source proof.

Quick-menu counters have two meanings: **received messages** counts unique native
message IDs retained by the current RAM gateway; **saved messages** counts
committed canonical message IDs for this owner/conversation. Both include
internal source-message records. Database hydration is not a new network receipt;
saved counts may therefore exceed current-session received counts. Neither
counter proves that all remote history has been observed.

## Source and lifecycle

### Durable conversation start (owner correction, 2026-10-21)

The first native composer `next` submission without an existing conversation ID
retains its original user message in the pending request. A correlated native
message response or `stream_handoff` acknowledgement must supply the server conversation ID before admission; local
route IDs, rejected requests and the first message merely observed in an existing
chat do not prove creation. With local capture enabled, the submitted original and
its `native-create` start evidence commit in the same owner-fenced transaction.
Explicit project IDs in that request participate in capture policy.

A native history page with `has_previous_page: false` records its saved
`start_cursor` as `native-page` start evidence. This durable header evidence
survives subsequent latest-window reads with older pages, bounded page eviction,
reload and validated backup/restore. It adds no table, index or schema version.
Existing `page_info` checkpoints and exact terminal-head evidence retain their
independent end semantics. Scrolling itself never supplies a boundary fact.

The first-message anchor identifies the chronological start without rewriting
the original `metadata.parent_id`. Traversal may stop at that exact anchor when
its parent is unknown; it does not invent a null native parent. Manual collection
can reuse that durable start only when every saved graph relationship is intact
and the independently confirmed end matches the current native head and saved
revision. A different head, owner, unresolved gap or remote-only mode cannot reuse
it to skip history. Missing native service parents remain visible
graph gaps; a known first message is not a claim that every branch is complete.
An independently confirmed native history-start cursor also anchors that exact
saved service root when its parent is absent. It never excuses a named missing
parent, another unknown root or an unrelated branch. The first user marker remains
separate from this native service-root boundary.
If both the service prefix and first user record omit their parents, these two
independently proven boundaries remain separate roots; no edge is manufactured
between them. Any additional root still prevents complete-chain confirmation.
Previously, only native page reads supplied a start and the submitted original
was discarded before the new chat had a server ID, requiring another history read.

ChatGPT owns its passive fetch/XHR/SSE/WebSocket adapters. Normal client
requests and protocol responses drive canonical state. DOM adapters discover injection
slots and scrolling containers; they neither fabricate archive records
nor prove canonical request completion. A message/tool segment completion does not
mean the main request ended. Explicit final-message evidence, main-stream
completion, a correlated `[DONE]`, or a correlated status response can end it.
Clean EOF without terminal evidence marks transport interruption, rather than
inventing completion. Generation state and stream health are separate.

Automatic history collection also needs source evidence: rendered first/last
messages and scrolling cannot confirm coverage or request another page. An
already observed read can be committed and checked normally. Further native
history reads require an explicitly supplied `nativeHistory.readOlder` binding;
without it, incomplete collection reports `nativeHistoryUnavailable`. Existing
site-originated network reads still feed capture. Current application composition
supplies no verified native command/history binding, so those commands are
unsupported instead of falling back to clicks, editor input or scrolling.

Outbound submissions carry an installation-local request identity. Stream
messages and terminal packets from an older run may preserve source variants
but cannot reopen or finish a newer run. Source status polling is pinned to
the run active when the native request began. Unknown source patch envelopes
are not guessed from visible text. The decoder applies only explicit patch
paths to an observed source baseline and retains the original patch evidence.
Current decoder/client compatibility still needs installed-browser acceptance.

The owner's 2026-10-15 correction also prohibits DOM-derived automation facts,
request timing and native-command clicks. All ChatGPT business reactions,
including request/response/approval/change/completion signals, originate only
from observed fetch/XHR/SSE/WebSocket evidence or an explicitly bound and
decorated method of the native ChatGPT application. Extension-local events
may carry that evidence; they are not independent proof of a native action.
Uncorrelated DOM, renderer state, URL polling and arbitrary internal events
cannot manufacture a business fact. DOM observation is limited to locating,
mounting, updating and cleaning up presentation. Request timers and activity
renderers display the same source-confirmed state.

The 2026-10-16 owner clarification also makes presentation admission source-driven:
only a verified owner-scoped message/call record can create its metadata or tool
control. DOM mutations may re-place or remove those existing source-backed
controls as native workspaces are hidden, shown or remounted; a DOM-only message
does not receive a placeholder control. Select the visible workspace rather
than the first connected `main`. Tool inspectors use explicit source message/
turn membership and parent links, never native labels, order or time proximity
to invent call/result pairs. A missing native creation time stays unknown;
observation time is not presented as message send time.

Individual call models and result links are keyed by exact source message IDs.
Native ID slots take precedence. The owner's later 2026-10-16 correction removes
the separate turn call menu and reuses legacy native-row placement: an exact,
unique `reasoning_title` within the verified source turn may locate its UI row.
This is presentation lookup only; fuzzy similarity, ordering, icons and adjacent
times cannot establish source identity or call/result links. Ambiguous titles
receive no control. Source creation dates and intervals between preceding source
summaries use the existing metadata control next to that row. Call
details open by click in the shared registry Dialog, with muted theme tokens,
visible source ID, arguments and result, keyboard dismissal and focus return.

The existing single configurable presentation ticker updates all counters.
Canonical accepted source changes carry last-change, current-action and summary
timestamps; identical packets, old runs and history/catalog rereads do not reset
them. The lower loader shows total generation time, current action time, the
last update and its age, time since the latest summary and the preceding summary
interval. Terminal evidence removes the active loader. Historical answer dates
and total durations belong to their own turn, never the current turn's terminal
time. An already active history run may join live events only by an exact source
user/turn identity before adopting that stream's request ID.

After reload, the existing latest canonical window (at most 160 originals)
may restore owner-fenced presentation. A displayed source message ID may load
its bounded saved window, without requesting remote history. Exact unique
`content.thoughts[].summary` or `metadata.reasoning_title` text locates the native
row; a summary retains its own source ID/date. An inspector requires an explicit
source parent/call relationship; incomplete or ambiguous links never borrow a
neighboring action. Hydration does not block native RAM updates,
open historic v3/v4 databases, write new archive records or infer an active
request from saved data. Live source advances take precedence over hydration.

The same owner instruction enables local automatic capture by default for
unconfigured chats and projects. Explicit conversation/project overrides and
saved off preferences remain available; the current installation's default
can be changed explicitly without rewriting them. Verified saved projects are
selectable even without a settings override. UI status distinguishes the
project policy from a chat override and uses persisted effective settings.
This changes no physical archive schema, owner gate, external-upload consent
or DEV/PROD namespace.

Project names are observed only from a successful native GET of the exact
`/backend-api/gizmos/g-p-*` project endpoint: its ID must equal `gizmo.id`, and
`gizmo.display.name` must be a string. Names remain in owner-scoped RAM even
when capture is off; persistence follows the master/project/default policy and
the existing projects table. The catalog retains at most 200 projects, limits
IDs to 256 and names to 4096 characters, and rejects stale/other-owner reads.
No instructions, files or other gizmo payload are copied into that catalog.

Injected archive controls may use DOM to locate a presentation slot, but their
conversation/project target and labels come from verified owner-scoped native
or saved source context. A route, document title or matching sidebar text cannot
establish identity. An unbound or ambiguous row receives no interactive archive
control; settings actions recheck their owner/epoch/target before writing.

The registered message-source adapter `chatgpt-history-2026-10-v4` extends the
published v1-v3 signatures, which remain immutable and explicitly selectable;
source-adapter versions are independent of physical Dexie schema 1 and the
historical database generations. On 2026-10-15, seven structural shapes from
an own synthetic native stream showed assistant recap/final metadata
`streaming_parent_id:string` and `streaming_parent_revision:number`. The
public native client `Prc` schema corroborates the exact accepted forms:
`streaming_parent_id` is a nonempty string or null, and
`streaming_parent_revision` is a nonnegative integer (never null). v4 adds
these forms and the separately observed boolean `has_versions` history flag;
the latter was incorrectly added to frozen v3 during the local audit and now
belongs only to v4. Every other field in the seven shapes already matched v3.
Unknown metadata, empty IDs, incompatible values and unsupported structures
still stop capture. Streaming placement is retained verbatim as metadata and
never substituted for `metadata.parent_id` ancestry. Generated tests exercise
both page and stream validation and the real source-gate → current state →
consented fixed capture → message-trigger sound path. Their v3 comparison
retains the two existing user/system originals and rejects the new assistant
shape, while v4 additionally stores the assistant and emits its sound action.
No private message bodies, identities or credentials are retained as fixtures.

The registered source adapter `chatgpt-history-2026-10-v5` leaves v1-v4
unchanged. A genuine native Work history page observed on 2026-10-16 contained
365 records and was rejected at `metadata.notification_trigger_checkpoint`,
preventing all its source dates and tool records from entering current state.
Only structural field/type evidence was retained. The observed checkpoint is
an object with exactly four required keys: `notification_id:string`,
`source:string`, `source_id:null`, and `triggered_at:string`. v5 accepts this
specific structure for page and stream messages, without guessing a non-null
`source_id`, timestamp format or additional keys. Every other observed metadata
field/type already matched v4, including nullable reasoning titles. Missing,
extra or incompatible nested fields and unrelated unknown metadata still stop
capture. Generated regression tests compare whole-page v4 rejection with v5
acceptance and verify unchanged original timestamps, tool records and raw data.
Physical archive schema 1 and historical databases are unaffected.

The registered source adapter `chatgpt-history-2026-10-v6` keeps immutable
v1-v5 registrations retained. A subsequent genuine native history read of
20 turns contained 742 records. Comparing all observed metadata field/type
pairs with v5 found only `user_signal_metadata:object` unsupported; the existing
debug, reasoning-title-transition and search-query forms already matched.
v6 admits this named opaque object container and preserves it verbatim, using
the same outer-object policy as existing opaque native metadata. It neither
interprets feedback forms, ratings or options nor creates a business fact from
them. Null, arrays, scalar values and unrelated unknown metadata remain
unsupported. Generated tests retain a synthetic deep object unchanged and
confirm legacy v1-v5 rejection; no actual feedback values are fixtures.

The default source adapter is `chatgpt-history-2026-10-v7`; v1-v6 remain
immutable. A genuine native test-chat history read on 2026-10-16 contained
11 message records and one `metadata.exclusive_key:string`. v6 rejected the
whole page at that named field while the RAM gateway retained all 11 originals.
Every other observed metadata name/type already matched v6, including
`rebase_developer_message:boolean`. v7 adds only the string form of
`exclusive_key`; null, scalar alternatives, arrays, objects and unrelated
unknown fields still reject. Generated page/stream fixtures compare all legacy
versions without retaining actual field values, message bodies or identities.
Physical archive schema 1 is unchanged.

## Automation and remote mirror

The reusable engine and WS transport live outside the provider. The ChatGPT
adapter supplies API request start/end, source message/conflict/limit facts
and an explicit native-method command port. Rules and
remote delivery default off independently. Automation/remote-caused facts carry
their command/run origin to prevent the same rule from feeding itself.

Send, stop, continue and new-chat require an available, explicitly bound native
application method or a validated provider API adapter. Native methods retain
their receiver, return/error behavior and reversible ownership. A method call
alone does not confirm its effect: the adapter awaits correlated network or
native-method evidence, with owner/run/abort fences. No DOM click, synthetic
input, renderer inspection or fabricated private protocol is a fallback.
Before invoking a method, the adapter requires a synchronous side-effect-free
native target preflight, rechecks it after `beforeAction`, and pins the expected
conversation/project in the invocation. A binding must address that target and
recheck it after any internal asynchronous wait before performing the effect;
a mismatched receipt cannot retroactively make a wrong-target action safe.
Missing bindings report unsupported; protocol compatibility and installed
native-method discovery must be independently established.
Remote trigger changes acknowledge only after settings persistence.

Only a verified owner can start the scoped remote session. Owner changes abort
pending commands and detach the previous session. In local-and-remote mode local
canonical commits precede `subscribeCommitted` mirror delivery. Remote-only mode
instead routes future stream/history observations through `subscribeRemoteSource`
before repository access and performs no automatic canonical writes, head writes
or page-evidence writes. Existing archive rows remain available and are never
removed by this switch. Explicit remote-only enablement replaces automatic local
capture enablement while preserving the chosen record-category retention.

`archive.source-observed` contains a remote-only source and its canonical v1
projection; `archive.page-observed` retains original page metadata, with messages
sent separately. `archive.source-committed` identifies a locally committed source.
All original source/event evidence uses the portable clone codec. Missing remote
consumers or rejected queue receipts fail remote-only collection, without a local
saved/feed/commit signal. Queue acceptance does not claim server persistence.
The shared WS service fragments complete logical events, persists its durable
local-and-remote outbox and owns ACK/retry/dead-letter handling. Remote-only uses
the explicitly volatile queue; reconnect preserves it but explicit stop/disposal
may lose pending data. The provider neither truncates nor independently fragments
a message. Delivery errors cannot roll back an already committed local archive.
Credentials stay in the target secret adapter, outside settings/backup.
Browser controls, protocol compatibility and installed service acceptance remain
unverified until the owner's deferred acceptance gates resume.

## Non-destructive observations

The canonical projection remains model v1, physical Dexie version 1 and the
same five tables/indexes. Source snapshots additionally retain distinct
observation versions and their original stream-event evidence. A newer local
observation time alone cannot make an older server snapshot authoritative.

Only monotonic enrichment promotes the preferred message. Shortened content,
older source times, lost metadata, changed explicit relationship/identity and
conflicting text remain separately inspectable variants. No old preferred
content disappears. This corrects both the former blanket rejection of any
changed message and the unsafe reload-overwrite behavior. No historical
native v3/v4 database is opened, migrated or deleted.

Capture checks the same 64 MiB portable serialized-row budget used by application
recovery before publishing any canonical row, including snapshots/variants,
conversation headers and native page evidence. An oversized observation is
explicitly unsupported and the transaction preserves every previous original;
there is no version pruning or silent success. Full-prefix versions still have
materialization costs, bounded by that admission rule. Shared application
backup fragments larger rows without changing the fixed database schema.

Conversation-to-project association can change only through a fresh, matching
initial native read with an explicit project field, verified owner and current
read/policy authorization. The header retains a validated association history;
message originals and observation versions keep their original project context.
Stale replay and absent/unknown project fields cannot move a saved conversation.
Both staged and array recovery validate this provenance and its project links.

## Integrity, branches and Reader

Manual collection pins an already observed, owner-verified native read rather
than demanding an initial request newer than the Collect click. The former
comparison could save every message yet keep scrolling until timeout because
older-page continuations retain that initial request's start time. The known
boolean `metadata.has_versions` signature is accepted without rewriting raw
messages; rejecting it previously locked version-aware history before capture.

Native page progress now has a bounded initial/frontier checkpoint, independent
of the 96 retained raw replay pages. Each successfully saved page advances the
persisted checkpoint only after its selected records commit. Manual completion
requires exact native-read and local-run acknowledgement, queue drain, current
owner/source gates and no known persisted ancestry gaps. More than 96 pages can
therefore stream into Dexie without losing initial-read proof. The checkpoint
keeps at most 96 pending facts and 96 exact recent cursors; full message-graph
validation remains separate. It does not introduce a table, index or schema
version change. Recovery validates optional checkpoint metadata; legacy absence
continues to use the existing page-evidence adapter.

If raw pages were already evicted before manual collection, the retained tail
cannot stand in for their originals. Collect reports `freshReadRequired`; the
owner explicitly reopens the native conversation and repeats collection.
Existing saved rows remain intact. Collection does not invent an authenticated
private fetch, automatically reload the page or retrieve unseen alternate
branches. An observed fork contains distinct saved source IDs sharing a parent;
multiple source snapshots of one ID are observation versions, not extra forks.
The current observer consumes documented paginated `messages[]` and observed
`metadata.parent_id`, not the client's private in-memory `mapping` tree. Whole
native branch discovery and installed-protocol parity remain separate evidence.

Known cross-conversation origin is projected from saved
`branching_from_conversation_*` originals when the selected conversation is
opened. Conflicting source parents remain unknown; an unloaded parent is never
fetched implicitly. The catalog uses only a bounded cache of already resolved
origins, so listing chats does not scan every conversation's original payloads.

Integrity inspects every saved projection, independently of the current
bounded Reader window. It distinguishes explicit roots, missing parents,
unknown parent evidence, cycles, known branch siblings and an absent head.
An end is verified only by linked newest-page evidence or an explicitly
observed terminal head. Merely storing a message named by `current_node`
does not prove the end. Unknown evidence must not become a green complete
status. The Reader can jump directly to saved problem records and select
an observed saved branch path; it never changes the native ChatGPT branch.

Reader cursor identity is a stable message ID, while display order uses
source timestamps. Random UUID lexical ordering is not chronology. Schema 1
has no timestamp index: the current implementation scans lightweight order
facts once per verified revision and caches a bounded number of lightweight
plans. Window and boundary queries share that plan. Source fences include both
the revision and conversation incarnation: new conversations and restored rows
receive an optional UUID in the existing schema-1 payload. Delete/recreate or a
peer restore cannot reuse a same-revision cached plan; legacy rows without the
UUID remain readable. It materializes only the chosen bounded message window. Large-archive
performance remains a separate acceptance question.

The Reader now shares a vertical point timeline with other providers. It reads
all saved lightweight relationship/preview metadata but renders at most 160
timeline rows and links at once. A selected point centers its timeline window
and opens a bounded source-message window, including a point outside the current
Reader page. Parent links come from saved source relationships; temporal
neighbors are never made into a fabricated chain. Saved branch selection and
source-version inspection do not change the native ChatGPT conversation.

Start, middle and latest jumps use source chronology rather than UUID ordering.
Export range endpoints resolve against all saved messages and highlight the
chosen set in both the transcript and timeline. They survive page navigation.
Adjacent reads retain at most 320 source records with stable cursors and reading
anchors. Already retained but hidden turns are revealed before another DB page
is fetched. This corrects the previous page replacement and scroll-order bug
that could skip unseen turns. Live commits refresh around the visible historical
anchor unless the reader is following the latest edge. Loading, coverage checks
and version reads have registry Skeleton states rather than briefly empty panels.

Shared graph integrity supplies explicit first/last anchors, independent start
and end proof, unknown ancestry, missing-parent/cycle/disconnected issues and
branches. Ordinary exports consume the same check, retain its evidence and mark
deliberate subsets as partial. Export pins the conversation revision before its
initial graph/count reads and rejects a change during inspection, serialization
or packaging instead of attaching a newer header to an older graph.

Every relevant repository transaction increments the conversation revision.
Before/after revision and owner fences protect windows, ordinary exports and
recovery scans. Shared scoped archive commit invalidation updates lists,
records and version inspectors automatically. Cross-tab invalidation carries
no account, conversation or message data. A selected older source variant
remains selected when new variants arrive.

## Settings, sounds, exports and recovery

ChatGPT contributes categories to the common settings catalog: capture/archive,
UI modules, sounds, local network counters and language. It does not own a
second application sidebar, installation metadata block or telemetry consent.
Shared design-system components own controls and responsive disclosure.
The provider consumes the installed shadcn-vue registry rather than a local
copy of primitives or manual CSS control skins. The archive navigation list
and settings catalog are shared. Native metadata uses the shared popover and
tool details use the shared registry Dialog inside their style boundary with an explicit portal
layer. This corrects the former independently positioned metadata popup and
invisible menus behind the shell. DOM remains a placement adapter only.

Provider settings restoration changes its safe presentation synchronously
before persistence and emits no Shell-open event. A late settings write may
update the saved category but cannot bring a previous screen back after the
user navigates elsewhere. Archive/settings/capture views are reusable safe
presentation state; collect/export commands are consumed once before handling
and are not restored or replayed on remount. Pending export-context reads are
fenced by presentation revision, adapter and owner.

The transport observer and lifecycle sounds are enabled by default for absent
preferences, following the owner's 2026-10-15 directive. Sending a user message,
assistant completion and confirmed context exhaustion each enable their sound
channel on a fresh installation. Existing explicit saved opt-outs survive
normalization and unrelated settings writes, including older settings schemas.
Body diagnostics, telemetry, long-running reminders, the trigger manager and
remote execution retain their separate defaults and consent.
A distinct repeated ending signal requires explicit `conversation_too_large`
evidence, including when it arrives after normal completion. Each channel has
enablement and tone selection. Trigger rules additionally support a validated
local `play-sound` action with the existing `soft`, `chime` or `pulse` tones;
custom audio URLs and executable payloads are unsupported. The shared sound
switch mutes both lifecycle and rule actions. Sound/master disable, owner change
and module stop close owned playback immediately; failed initialization permits
retry. Session sound deduplication is scoped to the installation and owner.

Ordinary export uses the existing format/options wizard and a separate Prepare
then Download action. JSON, Markdown and text reuse the shared source-neutral
serializer through a provider record/selection adapter;
ZIP/GZIP reuse the shared packaging adapters. Selection may include all saved
records, explicit messages or a saved branch. Integrity and unavailable binary
attachments are disclosed. A deliberate subset is not described as a complete
remote conversation. Physical IndexedDB backup remains a separate shared
settings/session/database recovery workflow; it includes owner-scoped provider
preferences and every current canonical table, with pure preflight validation.
Retired native archives and credentials remain excluded.

The full-size application backup path uses an immutable, sealed temporary
reader with indexed relation lookups. ChatGPT validates rows, owner keys,
codec round-trip, projections, versions/events, element relations and terminal
head evidence without an archive-wide raw-row map. Repeated validation retains
the first active source stamp; rollback uses a fresh reader view and a fresh
preflight. The older array API remains a bounded compatibility path and is
not a fallback for full-size application recovery.

Primary activation remains one owner-scoped transaction in the unchanged five
schema-1 tables. Deletion uses batches of 256 primary keys; staging reads are
kept outside the active Dexie context and awaited through `Dexie.waitFor`.
Writes use batches bounded by 256 rows, an encoded buffer target of 2 MiB
characters and a decoded allocation estimate of 4 MiB, allowing one larger
supported row. There is no total archive-row or archive-byte memory limit in
this provider path. Each row has an explicit estimated codec-expansion budget
of 64 MiB and depth 150; oversized sparse arrays and unsupported internal
reference graphs fail before activation. This estimate is a resource guard,
not a measured peak browser-memory promise.

Backup DTO construction independently clones preferred raw/events and each
version's raw/events, removing aliases introduced between observation fields
without changing active data or native values inside a source. Export reads
bounded key pages and one owned payload at a time. Revision scans hash bounded
groups of 128 header facts. Source/owner checks fence capture, preflight and
activation; peer invalidation is checked per exported row and immediately
before primary commit. Post-commit proof failure is handed to shared staged
rollback and explicit recovery, not claimed to undo itself atomically.
Large installed-browser transaction lifetime, quota/abort and real-data
round-trip acceptance remain outstanding. Isolated fake-IndexedDB round-trip
tests are a separate, narrower source gate.

`chatgpt-source-context.v1` is an optional computed export/transport sidecar for
already observed request, turn, model, author, content and terminal facts. Missing
facts stay null; unknown source fields stay in the original snapshot and source
versions. This adds useful normalized context without changing primary model v1,
physical DB version 1, record keys, legacy databases or stored projections.

Full ordinary JSON exports keep an already lossless JSON source in its familiar
shape. A source containing native clone values instead sets
`originalRecordEncoding: "archive-clone-v1"`; its `originalRecord` is the shared
portable codec value. Source-version collections use the corresponding
`coverage.sourceVersionsEncoding[messageId]` marker when needed. This preserves
Blob, Map, typed bytes, undefined and other supported values rather than letting
JSON serialization erase them. Original fields remain present only once per
export record. Unsupported reference graphs fail explicitly. Readable full
exports label an encoded original with its encoding alongside the value.

The focused synthetic Reader tests cover 321 source-chronology messages, bounded
first/middle/latest reads, ranges crossing pages, full lightweight timeline,
independent boundary/gap checks, variants/branches, subset completeness and an
initial-export mutation race and native-source codec round-trip. Shared timeline tests cover fork links, unknown
ancestry and first/middle/last access for 100,000 metadata points with 160 rendered
rows. These tests do not measure installed-browser memory or protocol parity.

The shared application telemetry controller is the only active consent and
delivery channel. ChatGPT emits approved technical notification/error classes,
with provider scope, without text, titles, IDs, URLs or raw exceptions. The old
provider OTLP configuration is retained only as historical settings data.

The 2026-10-15 live source correction adds explicit, versioned native application
bindings. The caller supplies source-inspected cached exports and the actual
application scope from a genuine invocation. An existing conversation is pinned
by both native and server identities. The native message constructor and submit
use case retain native request construction and integrity behavior; receipt
requires the exact constructed message ID, verified owner and observed request.
Stop is supported only for the binding's own acknowledged send, with an exact
native stream ID / observed request ID pair. The same prompt reused by a native
retry cannot authorize stopping that retry. Unsupported commands remain explicit.
Configured method capabilities survive runtime reactivation; late registrations
are revoked on stop and must be supplied again. No site-global discovery or
production debug registry is introduced.
Stopping observation also revokes verified ownership and clears transient
conversation/catalog state. Reactivation requires fresh source proof, including
when capture started early before the full module runtime took ownership.

Native account inputs may bypass fetch in the host application. An explicit
native-account source therefore calls the genuine account-refresh use case,
validates its normalized membership/default/order and checks native account/user
identity before and after await. Observer-owned source registration is private,
reversible and fenced by activation/replacement lifetime. A successful observed
conversation-catalog request with the same selected account is still required
before publishing ownership. Cross-world compositions without that explicit
capability remain unsupported; direct state assignment is not owner proof.

SSE delta encoding v1 inherits omitted path, operation and channel globally,
while retaining a separate source baseline per channel. Control events bypass
that inheritance. Native source-derived relative patch, append and truncate
semantics are decoded before anti-corruption mapping; malformed/prototype paths
fail closed, and a poisoned channel needs an explicit full-root rebase. Once an
authoritative terminal packet has been decoded, cancellation of the native
reader cannot replace completion with an interrupted result. Generated synthetic
protocol regressions and live browser acceptance remain distinct evidence.

A native `stream_handoff` packet acknowledges the conversation ID for the exact
observed submit request. It can persist that request's first original and start
marker before socket delivery. Only the safe identity fact is forwarded; resume
tokens/options are not archived. HTTP `[DONE]` after handoff closes that transport
segment, not the assistant turn; completion still needs native terminal evidence.
Socket messages inherit fetch-run identity only when their native
`metadata.request_id` matches the identity observed on that conversation's SSE
response. Conversation ID alone never correlates a retry. This bounded transient
map is cleared on owner/runtime reset and does not persist transport credentials.

Source adapter v8 additionally accepts the observed `user_editable_context`
content with required string `user_profile` and `user_instructions`, plus the
observed boolean `metadata.is_user_system_message`. Unknown
fields/types still fail closed, and v1-v7 signatures remain unchanged. Such
context remains private original archive data and is never a diagnostic fixture.

Source adapter v9 adds the observed asynchronous-response metadata:
`initial_text`, `finished_text`, `summarization_headline`, `async_source` are
strings; `permissions` is an array; `targeted_feedback` is an opaque object;
`preamble_version`, `poll_freshness_max_mins`, `poll_interval_ms` and
`poll_on_websocket_inactivity_ms` are numbers; `poll_suppress_reconnect_banner`
and `pro_skipped` are booleans. These exact outer types were observed in the
owner's long-running chat on 2026-10-21. Unknown fields and other types still
fail closed. Adapters v1-v8 and Dexie schema 1 remain unchanged. Regression
fixtures contain generated summaries only, never the owner's source text.

### Immediate submit and commit notifications

For an existing conversation, an exact native composer `next` request carries
its original user message into the owner-scoped observation gateway immediately.
Enabled local capture commits it without waiting for an assistant packet. The
native parent reference is retained as request evidence; the original message is
not rewritten. This is proof of submission, not server acceptance or completion,
and does not create a conversation-start marker. A new conversation still needs
the server-assigned conversation ID before its first original is persisted.

Received counters react to a newly observed message ID; saved counters react only
after durable commit. Repeated packets and streamed revisions do not increment
unique-message counters again. Reader, timeline and overlay subscribers schedule
their first refresh on the next microtask, with no debounce delay. Async reads
remain serialized and changes during a read request one subsequent refresh.
An initial/pagination read defers refresh until it releases the Reader, avoiding
both concurrent reads and a busy microtask retry loop. Owner and revision guards
continue to fence every result. No message text or identity is broadcast between
tabs; the shared feed transmits commit invalidation only.


### Native conversation-length rejection

The native composer can reject a request with HTTP 413 and JSON
`detail.code = conversation_length_exceeds_limit`, with a string
`detail.message`. Fetch and XHR normalize this exact response to
`conversation_too_large`, a non-retryable terminal cause used by the existing
conversation-end alert. A generic HTTP 413, translated page text, or an unknown
error shape is not evidence of conversation exhaustion. Failed submission does
not revoke previously committed originals or replace the stored chronology.

Local authenticated DEV acceptance on 2026-10-22: the native HTTP 413 rejection
emitted the 12-note ending signal in a running AudioContext. Reload followed
signal observation. All 666 pre-check records remained, with 668 afterward;
zero original hashes, source chronology hashes or projection hashes changed
or disappeared. The rejected submission original was retained. Private source
and hash checkpoints remain outside the repository. This does not establish
production acceptance or physical speaker audibility.


### Failed recovered streams

A successful native `stream_status` response containing `FAILURE` is terminal
failure evidence, separate from generic network interruption and from assistant
completion. An exact current request ID may close that request. After reload,
a fresh uncorrelated failure may close only an active history-recovered run
without a local request ID; stale polls and polls spanning a new submit cannot
close that submit. A repeated page retaining `async_status: 3` for the same run
does not override this terminal evidence. A new user request starts a new run.
No translated DOM warning, elapsed-time threshold or generic HTTP 404 proves
failure. Stored originals and chronology remain independent of this lifecycle.

Native delivery failure is a separate client-side terminal event. In the
source-inspected client, cached `WB3F.m` commits `p0Ph.G = error` and `p0Ph.p`
metadata with `errorCode = recovery_unconfirmed` when delivery recovery expires,
even while server polls still say `IS_STREAMING`. The actual captured AppScope's
`watch` API subscribes to those exact tokens. Native callers can use another
scope object sharing the same store, so decorating one scope's `set` misses
their writes; the store subscription observes them. Existing native error state
is also reconciled after binding and native page ingestion. Account,
epoch, exact native/error head and current local request correlation fence the
event. It stops the local request as `native_delivery_failure`, without claiming
server completion, changing originals or altering the archive graph. Replayed
active history cannot restart that failed run; a genuine new submit remains live.
DOM text, elapsed time and the voice/send button are not lifecycle authority.

Authenticated local DEV acceptance: the client naturally reached its recovery
timeout and exposed `error/recovery_unconfirmed` for the current head, while
server polls had continued to report streaming. Attaching the compiled native
watch binding to that real error immediately changed local lifecycle to failed
and removed both active timer surfaces. No native status, error or timeout was
fabricated. The real metadata popover was opened over that same warning and
rendered above it; its displayed elapsed duration remained frozen. This was a
live binding update, not a fresh-install or PROD acceptance claim.


### Older-history retrieval metadata (2026-10-23)

Source adapter v10 accepts the observed numeric `retrieval_turn_number`,
`retrieval_file_index`, `retrieval_visible_content_line_count` and object
`citation_metadata`, plus string `command`/`status` fields on native tool records.
It also accepts observed `tether_browsing_display` content with string result and
summary, and null assets/tether_id. V1-v9 remain strict.
In the owner-authorized DEV chat, an older page containing these fields caused
v9 to latch a conversation-wide structural rejection, leaving later pages in
RAM without canonical commits. All fourteen retained native pages, including the explicit oldest page, pass v10;
regressions use generated records only. This changes source compatibility,
not Dexie schema 1, chronology, ownership or historical archive storage.

Initial native responses may represent only a tail (`has_previous_page: true`).
A stored tail is not a full archive. The History Loader requires a verified `nativeHistory.readOlder` capability.
The native full-history binding described below now supplies it for the exact
source-inspected client runtime; unsupported client revisions fail closed.
Missing parent IDs in the received server page remain unresolved evidence;
no adjacent-message links are fabricated to produce a complete status.


Authenticated local DEV acceptance on 2026-10-23: ordinary native scrolling
exposed 5,529 unique messages across fourteen retained pages and the explicit
oldest-page boundary. After validating and replaying those same owner-scoped
original observations with v10, the repository contained 5,574 records (including
45 earlier retained records absent from the current server pages), up from 668.
The formerly rejected pages contributed 1,276 records. All 716 pre-investigation
rows across the scoped archive retained their original and projection SHA-256
hashes; no row disappeared. Native payloads themselves reference 1,130 parent IDs
absent from all received pages, so this is not proof of a complete source graph.
Private snapshots and response bodies remain outside Git. At that intermediate checkpoint, automatic collection
and full remote-graph recovery were still unaccepted; the later acceptance below supersedes it.


### Full native collection and graph authority (2026-10-23)

Source adapter v11 additionally accepts observed `paragen_variants_info` objects
and string `paragen_variant_choice` metadata from an older conversation page.
The variants object is retained as opaque source evidence; it does not create
graph edges or prove completeness. V1-v10 remain unchanged. In the second old
chat, v10 rejected a 2,612-record page on this field and latched out the later
1,226-record oldest page, while 1,765 earlier records remained durable. Synthetic
regressions cover both accepted outer types and incorrect types. This source
correction changes no storage schema. HTTP 429 is handled during acceptance by
waiting one minute and clicking the native retry button once, without alternate
endpoints or forced requests.

Second-chat local DEV acceptance: ordinary upward scrolling received all four
pages (5,603 unique records), including the explicit oldest boundary. After
validating the retained same-owner/epoch observations with the compiled v11
gate and replaying them through capture without network delivery, all 5,603
records were durable and the start was verified. An ordinary harmless message
in a separate new chat received a response and saved 13 native records. Returning
through the native sidebar retained the old chat's count and start proof.
This was a local gate replacement/replay check, not fresh-install acceptance.
The full collection remains unaccepted for this chat: the server repeatedly
reported `IS_STREAMING` while its UI showed a delivery timeout, so the existing
active-run guard blocked collection. No terminal state was fabricated from DOM
text or elapsed time. The Reader correctly still reports 1,222 unresolved parent
references; a full native mapping has not been received for this conversation.

The full-history binding `chatgpt-native-history-2026-10-23-v1` inspects the
already-loaded React Router manifest and the cached runtime export from the
source-inspected runtime asset. It uses cached `hwXH.a`, `OWtl.a`, `OiCI.a`,
`Cslg.i` and the actual `zd8w.useRef` result produced by the native AppScope
hook. The reversible probe delegates the exact original hook call/return and
removes itself after capturing that real scope. No React fiber traversal,
arbitrary globals/module search, synthetic scope, composer clicks or private
HTTP request construction are permitted. A native router revalidation may
rerun native hooks when capture has not occurred. Stop revokes the binding and
restores the owned probe. Owner/epoch, native account/user and cancellation
are checked before and after the native read. Unrecognized runtime assets or
missing cached capabilities report unsupported rather than trying other code.

`hwXH.a(scope, conversationId, {forceFull:true, signal})` is the genuine native
read use case. Its native code owns account/project headers, request integrity,
backoff and `/backend-api/conversation/{id}` delivery. Only the subsequently
observed successful native response can establish collection progress. The
observer validates the returned `mapping` node identities, reciprocal edges,
cycles and head before deriving a page envelope; message originals remain
unchanged. The graph header and structural nodes accompany the derived page.
The source gate separately validates that graph and exact message membership.

Native `mapping[node].parent` is graph authority. On this client, a message's
`metadata.parent_id` can differ from that parent and does not reconstruct the
full current graph. A fixed-schema-1 conversation payload can carry a native
graph checkpoint, committed only after every referenced message is durable.
The explicit current graph drives integrity, branch paths and timeline edges;
original canonical records and source variants are retained unchanged.

A full current graph is a scoped claim, not proof about every historical
observation ever captured. Old records absent from the latest full native
response are retained. Integrity exposes `scope: current-native-graph` and
`retainedOutsideGraph`; the UI says "Current history saved" and discloses those
extra records in details. It never calls their old relationships verified.
Missing current graph messages prevent a complete graph checkpoint. Capture
completion waits for durable writes, a fresh read/run acknowledgement, stable
owner/revision and graph validation. Existing saved graph proof is reusable
only under the existing source/head fences. No schema migration or PROD data
acceptance follows from this implementation.

The same binding drains the actual native `FGJH.c` pagination cursor with cached
`jfiJ.b(scope, id, flushSync)` and the native `v7qY.flushSync` before taking the
full graph. Native pages may expose historical/variant originals absent from
the full mapping, so a mapping response alone must not replace pagination.
Only actual native state advances permit the next page; repeated cursors,
errors, cancellation and owner changes prevent completion. The binding never
sets native cursor state or constructs page requests. A saved graph cannot
short-circuit collection when the current native head differs from its head.

Manual collection is a history-read operation, independent of generation state.
The owner requires it to remain available during active or server-stuck streams;
the former `in_progress`/`stop_requested` preflight ban is removed. Collection
neither stops nor completes the native generation. Owner, epoch, permission,
source-validation and post-read live-head fences still protect every write and
completion claim. A newer live head can invalidate an earlier graph checkpoint.
Source compatibility is checked at every loader continuation. A latched source
rejection stops the run immediately instead of causing repeated native reads.
Full-graph support is an inherited profile capability: v11 retains v10's graph
support while adding metadata fields; it must not reject a graph solely because
the profile object differs from v10.

Second-chat recovery acceptance later on 2026-10-23: collection started through
the normal UI while native status remained `IS_STREAMING`. The native reader
returned the full mapping (3,453 messages). A v11 profile capability regression
initially rejected it; after the correction the retained owner/epoch-scoped
responses were validated and replayed without additional network requests.
The completed repository contains 5,605 records, verified start/latest boundaries
and zero issues in the current native graph; 2,152 historical observations outside
that graph remain retained. Comparing all 11,302 pre-recovery records across the
scoped repository found zero missing records, zero missing original source values
and zero changed canonical projections. This is local DEV acceptance; publication
and PROD acceptance are separate. Private source/checksums remain outside Git.
Reloading with the final built DEV userscript retained the verified current
history and zero issues. Clicking the real collection action in the compact
details completed with 5,605 known records and zero new pages, reusing the
verified durable graph. Native lifecycle remained `in_progress`; collection
did not manufacture a terminal signal or require generation to stop.

A fresh full graph owns its server head even when a retained rejected submission
has a later source timestamp. A live head received after the read began still
prevents that rollback. Receipt time is separate from source chronology.
This corrects the false missing-parent reports caused by treating a rejected
submission as the current server mapping head. Source originals remain intact.

A source-confirmed `conversation_too_large` cause additionally commits an
owner-scoped `exhaustionEvidence` payload after its rejected user original.
Its request identity, optional user-message identity, last durable head and receipt time are recorded once. A native retry can omit the user ID; exact source-confirmed exhaustion still persists, with that ID left null. Later pages,
retries and reloads cannot replace this evidence. This is independent of the
native graph's current head, normal assistant completion and immutable start
proof. The Reader exposes the retained terminal mark in archive details.

For non-OK native composer responses, fetch observation finishes reading its
response clone before handing the untouched error response back to the native
caller. Otherwise native error cleanup can abort that clone and turn a coded
413 into a generic rejection. Successful SSE delivery retains its original
streaming behavior. A synthetic cancellation regression covers this ordering.

Authenticated local DEV acceptance later on 2026-10-23: the ordinary collection
command traversed every available native pagination cursor to the explicit
oldest boundary (5,529 unique paginated messages), then observed and committed
the full native graph (3,600 messages / 3,601 structural nodes). The collection
session reached complete. After four non-executing limit-check submissions,
5,638 originals remained in this conversation, including 2,038 observations
outside the current graph. The current graph has verified start/end, verified
chain and zero gaps; outside-graph relationships are not falsely certified.
All 716 pre-investigation originals and projections across the scoped archive
retained their SHA-256 values, with zero missing records.

A real native HTTP 413 established the permanent exhaustion marker. Reload
preserved that exact marker, start proof and record count. A later ordinary
submit, without a diagnostic fetch wrapper or a native retry, was immediately
classified as conversation_too_large in the final build. It saved its original
and left the first exhaustion marker and start proof unchanged. This verifies
local authenticated DEV behavior, not a published release, PROD acceptance or
physical sound audibility. Private source/hash checkpoints remain outside Git.


## Precommit review corrections (2026-10-23)

The provider's `archive-native-graph.ts` now owns checkpoint selection and
relationship resolution for both repository and RAM Reader. Selection compares
native read start first, then receipt time. A delayed page cannot clear a newer
live head. Mapping membership owns its explicit edges; an outside message can
extend those edges only with an explicit parent and a later native stream or
submission receipt than the selected read start. Older outside observations stay
retained and unconfirmed, rather than acquiring graph membership by timestamp.
Persisted original/version receipts survive Reader hydration; no source metadata
or canonical projection is rewritten to repair relationships.

An empty full graph requires `current_node: null`. Missing, dangling or non-null
empty heads fail decoding, source admission and backup validation. Both array
and staged recovery use `decodeFixedBackupRow` and the same conversation relation
validator for graph originals, start anchors, exhaustion roles and terminal heads.
Schema 1 and historical databases remain unchanged.

Native client capabilities, bounded AppScope probing, native pagination/full
reads and delivery-error subscription have separate lifetime owners. The probe
expires after 60 seconds, releases on capture, collection timeout/abort or stop,
and ignores already queued callbacks after disposal. A later explicit collection
can install a fresh probe. Reader collection state/actions live in the provider's
`use-archive-collection.ts`; shared integrity widgets remain presentation-only.

Targeted synthetic regressions cover delayed reads, saved-checkpoint extension,
empty heads, both backup round trips/corruption refusal and probe lifecycle. This
iteration does not claim a fresh installed-product/browser acceptance or PROD
publication for the refactored build.


## Bounded decoration hydration correction (2026-10-23)

CPU profiling of the installed DEV source in a real long ChatGPT conversation
identified repeated IndexedDB result handling and visibility checks as major
costs. Decoration placement previously launched up to sixteen overlapping saved
windows at once. It now hydrates one bounded window, then rechecks missing source
IDs before reading another. The canonical source reader bulk-loads a bounded
window and reads its conversation header once, avoiding a full native-graph
structured clone for every individual message. Owner, epoch, source identity,
source-project mapping and revision fences remain in place. No native history is
removed or fabricated to improve performance. The local CPU profiles contain
private runtime evidence and are retained outside Git.


Live comparison of the same 160-row saved window in the same browser/owner/DEV
archive measured 6,952 ms before and 243 ms after the bounded source-reader
change. This is one local window-read comparison, not a whole-application
speed guarantee. CPU profiles remain outside Git. The native client later
returned HTTP 429 for conversation loading; follow-up uses a one-minute wait
and its ordinary retry control rather than bypassing the limit.
