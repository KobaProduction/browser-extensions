# Archive target architecture and delivery contract

Status: **target design / not yet implemented**. The currently deployed IndexedDB v3,
History Loader, and export v1 remain the implemented baseline until a **clean
new database rollout** and runtime acceptance explicitly prove otherwise.

This document defines durable design constraints. **One GitHub Issue
[#54 — ARCHIVE & EXPORT](https://github.com/KobaProduction/chatgpt-booster/issues/54)
is the sole live work plan**: its six phase sections hold all implementation and
acceptance checklists, dependencies, owners by role, progress evidence and closure
criteria. Do not create separate Issues per phase or duplicate task checklists
in Markdown. See [Agent execution and issue workflow](#agent-execution-and-issue-workflow).

References: [Architecture](ARCHITECTURE.md), [Conversation Archive](CONVERSATION_ARCHIVE.md),
[Runtime contracts](CHATGPT_RUNTIME_CONTRACTS.md),
[Product operations](CHATGPT_PRODUCT_OPERATIONS.md), and
[Client research](CHATGPT_CLIENT_RESEARCH.md). Observed ChatGPT contracts, not
speculative examples, define which inputs can actually be supported.

## Goal and non-goals

Build a browser-local, account-isolated, lossless ChatGPT archive that permits
fast conversation/branch previews and bounded navigation without loading every
message; integrates safe capture, collection and configurable export; and stops
archive-dependent processing **before writing** when a ChatGPT API signature is
incompatible with its explicitly supported contract.

- **No loss of original ChatGPT message structure.** The source message is the
  primary record; display/search/export projections are derived and rebuildable.
- **No legacy migrations.** The new database starts empty: v3 archives and v1
  exported files are not converted, imported or supported by the new schema.
  Unknown account identities, incompatible API signatures, pagination gaps and
  unverified branch parents must never be converted into authoritative values.
- **No private ChatGPT history requests.** Collect by observing the native client
  while it loads its own pages. Live UI remains memory-first through
  `ConversationStateStore`; IndexedDB must never block live decorators, timers,
  activity or normal ChatGPT behavior.
- **No immediate feature replacement.** Keep the interim branch inspector and
  existing archive/export functional while safely introducing new contracts.
- **No binary asset completeness claim** until independently verified against
  actual file types, signed URLs, expiration, size, quota and runtime behavior.

## Domain and account boundary

Exactly four primary **ChatGPT information entities** are required. They do not
mandate exactly four IndexedDB object stores: physical indexes, storage state,
transient jobs and Booster-specific preferences may use separate implementation
stores without becoming competing domain entities.

### Project

- Stable project ID and explicit owning account ID; current native project name,
  observed project configuration and provenance.
- Conversations reference `projectId`; do not store copied project titles in
  each message or mutate a conversation's **own** title when its project is renamed.
- On an observed project rename, update Project once and invalidate dependent
  read models. Never infer an account or project ID from a matching title.

### Conversation

- Conversation ID, owning account ID, optional project ID, native title, creation
  and update state, current/selected message node and observed branch provenance.
- Small, directly accessible **materialized summary**: first and last *known*
  message IDs; first and last *verified* IDs for a particular selected lineage
  where proven; source-page continuity state, revision, counts and freshness.
- Keep *known* chronological endpoints separate from *verified version/path*
  boundaries and source pagination proof. `currentNodeId` is not by itself proof
  of a complete branch. The summary is a fast read model and carries a reference
  to the evidence from which it was derived.
- Project relationship must agree with owning account, if both are known.
  Standalone chats have no project. A chat may have multiple versions/paths without
  turning each edit into a new conversation ID.

### Message

- Scoped to one conversation by stable `(conversationId, messageId)` identity;
  cross-conversation branches can reuse raw message IDs.
- **Immutable original ChatGPT message object** (entire source envelope and
  nested structure, unchanged field names, presence, types and values). Never
  inject Booster fields into this object, strip unknown fields, rewrite
  timestamps, rearrange content or save a sanitized copy as the original.
- Normalized fields (parent IDs, role, channel, indexes, render text, tool and
  reasoning summaries, source provenance, observed timestamps) are separate,
  explicitly versioned **projections**, not replacement source messages.
- Content-type variants and streamed/DOM-derived fallback data are distinct
  source classes. Do not present a synthetic DOM fallback as an authentic
  server message. If byte-for-byte transport identity is required, it needs a
  separately evidenced capture of the original response bytes; parsing and
  re-serializing JSON alone is not byte-identical.

### Metadata

- Typed metadata attached to Project, Conversation or Message by stable owner
  reference: source/observation evidence, pagination proof, updates, linkage,
  attachment descriptors and optional audit trails.
- Not a generic bucket that duplicates Project/Conversation/Message core fields.
  Metadata needed to prove a fast Conversation summary remain queryable and
  traceable; retained evidence must not be silently thrown away.
- Asset identities, MIME, sizes and source references may live here; actual file
  bytes are separate optional storage artifacts, not a fifth ChatGPT domain entity.

### Account ownership and Booster-specific data

Account is a **mandatory isolation/namespace boundary** even if it does not need
its own feature-rich domain object store. Project and Conversation carry a
verified owner; Message ownership resolves through Conversation; Metadata
ownership resolves through its owner. Persist no guessed account IDs. On unknown
or changing account identity, fail closed for writes into an established owner
namespace until attribution is resolved. Never merge records across accounts
because conversation/message IDs or project titles happen to match.

Booster capture policies, inherited export preferences (global -> project ->
explicit conversation override), UI state, export jobs and temporary workspace
state are Booster-specific and may use their own tables. They refer to domain
identities rather than embedding or duplicating original ChatGPT records.

## ChatGPT API compatibility: strict, versioned, fail-closed

This is a release-blocking invariant, not a best-effort parser heuristic.

1. Maintain an explicit **contract registry** for independently observed native
   inputs: conversation initial/history pages; message envelope/content variants;
   assistant reasoning and tool events; supported stream/update envelopes.
   Version each contract separately from IndexedDB schema and export schema.
2. Each validator enforces required/optional keys, key types, nested shapes,
   allowed discriminants and source identity. Unexpected structural keys or
   changed types in a constrained payload are **incompatible**, unless a
   specifically documented extension field is allowed by that exact version.
   Do not silently use permissive object passthrough or filter bad records.
3. Validate the **whole observed batch/page** and its relationship to the
   verified conversation/account **before any durable write**. One incompatible
   record invalidates the batch. No partially accepted page, successful
   coverage flag, updated counts, derived raw data or subsequent export on
   that incompatible source.
4. Transition the affected archive ingestion/reconciliation/export capability
   to `incompatible_source_contract`, raise a visible actionable diagnostic
   with source kind, signature/version and safe structural diff (no private
   content/credentials in telemetry). Preserve existing IndexedDB unmodified.
   Native ChatGPT and independent Booster features must continue working.
5. Introduce a new adapter version only after examining observed native samples,
   confirming only currently supported native schema fixtures and focused tests.
   Record the selected native/adapter signature and evidence provenance.
6. Account for legitimate nullable/optional variants **only** by explicitly
   registered signatures. Do not reject a known legitimate form by applying a
   single invented universal shape; do not accept a new form by silently
   coercing it to the old one.

The selected native adapter is explicit and immutable for one page runtime.
`archive-source-contract.ts` owns the allowlisted version registry and existing
nullable structural paths. History pages and stream records dispatch to that
same selection. Unknown adapter versions or payload signatures never trigger a
fallback search. Page Metadata records the validating adapter version separately
from its untouched native envelope. Export diagnostics expose only the selected
version/capability, not private source data. A different release adapter requires
an intentional code registration and final acceptance of observed fixtures.

**Atomicity:** validate -> normalize to a separate projection -> commit source
message(s), associated summary and evidence in one IndexedDB transaction ->
notify readers. On validation or commit failure, no successful capture result
is exposed. A new internal database version must never rewrite the immutable
source payloads or reset the database because a ChatGPT API signature changed.

## Incremental ingestion and materialized reads

The current implementation repeatedly loads every message and historical page
for a conversation and rebuilds the whole thread while ingesting each new page.
This must be replaced by revision-aware incremental updates:

- Deduplicate by source-scoped message identity and original payload fingerprint;
  write only genuinely new/changed source snapshots with explicit provenance.
  A server-side message mutation must not erase the previously observed source
  evidence without a deliberate, audited version policy.
- Update affected Conversation summary, counts and coverage/evidence state in
  the same transaction, or leave prior summary as pending/unverified until an
  atomic repair can succeed. No halfway-changed first/last pointers.
- Publish typed domain invalidations (`MessageObserved`, `ConversationChanged`,
  `ProjectRenamed`, `CoverageRevalidated`, `ContractIncompatible`) *after*
  successful commits; existing UI may subscribe without scanning entire stores.
- Query with IndexedDB indexes and bounded cursors: conversation headers,
  first/last known message lookup, specific IDs, selected-path neighboring
  windows, direction-sensitive pagination and lightweight previews. Do not
  materialize the full thread to show a conversation list or its endpoints.
- Distinguish verified source page continuity from verified message parent
  lineage, capture-category omissions, current-live head match and attachment
  completeness. All dimensions affect truthful export status independently.

For large histories the UI starts at the known/latest window; jumps to a
**verified** first or last node use stable indexes/checkpoints and load only
adjacent windows as needed, with visible skeleton/loading state. An arbitrary
chronological minimum is not proof of the selected branch root. Earlier/middle
windows load progressively rather than mounting millions of nodes.

A saved Export preview location carries the verified owner, conversation ID,
message ID and source revision. Opening it must read that saved namespace,
not substitute current-chat RAM. A direct message lookup and its chronological
neighbors share one readonly snapshot; a missing message or changed revision
returns an explicit error. A record without source time can be inspected alone,
never placed among invented chronological neighbors. The bounded Reader retains
independent older/newer cursors, cancels superseded reads, and keeps its position
when covered/minimized. Returning to Export restores the existing wizard rather
than starting another export or changing the native selected conversation.

## Integrated ingestion and consistency map

This describes the local v4 source implementation, not an accepted deployment.
Issue #54 remains the status/acceptance owner. Native schemas and transport
contracts are owned by `archive-source-contract.ts` and the observed-client
research; no additional endpoint is called to perform synchronization.

| Entry / owner | Live path | Durable boundary and invalidation |
| --- | --- | --- |
| Initial and older native history — `observer` | Native read ID, start time and selected-account epoch are captured at request creation; `ConversationStateStore.ingestPage` validates and merges into RAM first. | Capture snapshots the permitted categories, account/context generation and optional manual run before queueing. `ArchiveV4Store.ingest` validates/fingerprints before opening one readwrite transaction over Project, Conversation, Message and Metadata. |
| Preload/policy replay — `observer` and `ArchiveV4CaptureModule` | The exact cached native page is replayed, without changing its observation time, read ID or source envelope. | New explicit policy may authorize a new capture of existing evidence; it does not make that evidence a fresh server response. Identical stored content is a no-op for source revision and user-visible notifications. |
| Stream and composer submission — `ConversationStateStore` | Stream lifecycle and current records stay RAM-first. The bounded native submission selection map is keyed by exact user-message ID and account epoch. | No partial stream or DOM fallback becomes a native persisted Message. Submission facts enter Message-owned Metadata only alongside a matching validated native history message and captured permission. |
| Native catalog — `observer`, RAM catalog subscribers | Request-time account epoch and request-start ordering reject responses crossing an account switch, including A→B→A. All changed RAM headers are notified. | Only already archived, capture-enabled conversations are updated. A catalog cannot create an archive or borrow another manual run. Project/title changes never rewrite Message raw, establish parent links or claim pagination completeness. |
| Native project title — `chatgpt` adapter / Capture | DOM-facing title lookup remains behind the existing adapter. | Project-only update uses the same account deletion-generation ticket and revoked-signal checks. A repeated title advances its observation fence without a rename event; a project rename does not rename conversations. |
| Reader, Preview and Prepare — query services | Ordinary current-chat viewing is RAM-first; context-only callers use `header()` rather than copying/sorting a transcript. Explicit saved inspection stays saved-source. | Bounded windows, previews and selected path checks compare conversation instance ID, revision and head. The per-instance identity changes after deletion/recreation, preventing a new revision 1 from validating an old result. |
| Explicit account cleanup — Capture / Store | Revoke pending capture and manual consent first. | One account-scoped transaction deletes saved entities via indexed key-only cursors (not getAllKeys arrays) and retains a Metadata write-generation tombstone; nested message/conversation/project metadata is deleted atomically. Old tickets from any tab cannot repopulate deleted state. Another account and the v3 namespace are untouched. |

### Write ordering and source identity

`archive-v4-write.ts` contains source identity and cancellation primitives.
Canonical JSON is a derived representation: sorted object keys, original array
order, no coercion, no accessors/cycles or non-JSON values. A SHA-256 fingerprint
is computed before the readwrite transaction. The untouched parsed native raw
object is still the stored Message source, and a changed accepted object retains
its predecessor in Message-owned Metadata. The same transaction also stores a lightweight `message-revision-evidence`
row; selective export reads these compact facts instead of duplicating previous
raw message bodies. For earlier local v4 recordings containing only the
source-native snapshot, the revision reader falls back on demand, without
migrating or rewriting the saved source. A non-contiguous revision chain is
rejected instead of presented as verified. Older snapshots with no fingerprint
are compared canonically on demand; there is no v3 migration or bulk rewrite.

Within the transaction, only affected primary keys, counters and edge pointers
are read or updated. Identical observations can advance provenance fences but
not the raw revision. A page with skipped stale conflicting records carries an
explicit incomplete-capture marker. Native continuation pages with conflicting
known request-start times cannot close a source-page gap, even if their read
IDs are reused; older evidence with genuinely absent timestamps stays nullable.
The most recent native read ID is tracked
even when its initial page has not arrived; a prior completed read cannot
revalidate it. Equal-start conflicting reads remain unverified until a later
unambiguous read. Chronology tie-breaking uses IDB-compatible string ordering,
not locale collation. Unknown timestamp changes do not invent new edges.

Capture's permission scope is immutable for queued work. Master/capture-policy
changes, native navigation, account epochs and teardown revoke the signal;
manual work also carries the exact run's signal. Per-conversation cancellation
controllers are reference-counted across pending page/catalog writes, so
concurrent writes remain revocable together without retaining a controller for
every historical conversation seen in a sidebar. Concurrent explicit account
cleanup commands join one transaction and keep the no-capture barrier until
settlement (including failure). A source-contract rejection
aborts that conversation's outstanding scopes, without interrupting native
ChatGPT. AbortSignal is connected to the pending transaction itself, not only
to its eventual result. Already committed writes are not claimed to have been
rolled back after a later cancellation. Failed or cancelled pending pages
cannot be converted into successful collection completion.

A durable account generation is stored as implementation-owned Metadata, not a
fifth ChatGPT entity. Tickets record the generation and local acquisition time
before queueing. They are checked again under the actual write lock, including
the case where initial DB opening was delayed until after cleanup. Conflicting
same-millisecond acquisition is refused conservatively. New capture after the
cleanup boundary requires a new ticket; old work never inherits it.

Changes are published only after transaction completion. Same-origin
BroadcastChannel messages contain only typed IDs/revisions and are invalidation
hints, never source records, permission or proof of completeness. Receivers do
not rebroadcast them. Correctness still relies on transactional generation and
snapshot checks when notifications are delayed or unavailable. The channel is
owned by active subscribers and closed when the last subscriber leaves.

### Source-level baseline comparison and pending acceptance

The old v3 `archive-store.ts` ordinary `ingest` reads all `conversationPages`
and messages through `getAll` before preparing its write; older preload and
record helpers also read entire message sets. The active v4 composition in
`page-runtime.ts` does not construct that store or use the legacy
`ConversationStateStore.hydrate(...listMessages)` path. Native RAM observation
has no awaited database operation. The retained legacy hydration helper now
rejects results from an obsolete account epoch or replaced RAM state.

Source-native parent tracing is a pure module (`archive-v4-path.ts`), reused by
materialized inspection and ID-only export, and re-exported by the Store to
preserve the existing public contract. This prevents IndexedDB transaction
mechanics and path-proof rules from drifting into competing implementations.

The v4 normal ingestion path performs page-bounded source work and keyed reads;
project/catalog updates only read their affected headers. Header/preview/point
navigation never uses whole-message `getAll`. Explicit account deletion traverses owner-indexed key cursors without materializing all keys, while explicit export may traverse its selected native lineage; neither is a normal per-message synchronization path. History Loader caches RAM-derived coverage and visible endpoints by account and conversation revision so ordinary scroll pulses avoid rebuilding the full thread.
Source hashing adds per-page CPU work and bounded page copies; no claim is made
that this has measured lower browser heap or latency. The earlier coverage CPU
sample is not a measurement of these new paths. Exact transaction atomicity,
blocked/open lifecycle, cancellation races, fingerprint fidelity and actual
resource usage remain part of the final acceptance stage, not a completed test.

## Export design boundaries

- Export is one **explicitly selected and verified path/version** (subject to
  deferred [branch work](https://github.com/KobaProduction/chatgpt-booster/issues/53));
  refuse a false *complete* label when its ancestry is ambiguous.
- Open export -> asynchronously hydrate local summary -> inspect source coverage
  and selected path -> choose options -> optional collapsed first/last preview
  (skeleton during bounded reads; expand opens Archive and returns to Export) ->
  name output -> Prepare with progress/cancel -> Download.
- Native history collection is accessible **only inside the Export surface**;
  it scrolls the actual ChatGPT tab behind the modal. Close/minimize, tab hide,
  chat navigation or user takeover pauses it safely. Explicit resumption
  revalidates conversation, account, path, capture policy and continuity.
  Consent and lifecycle have one environment-neutral session owner. A run is
  bound to a verified account, conversation and selected path; delayed work
  carries its original run identity and cannot acquire a successor's consent.
  Permission is memory-only: reload, page teardown or hidden-tab cancellation
  cannot silently restore native scrolling from an old storage ticket.
  The Export entry remains available for an active, not-yet-captured native
conversation. This is the only way to explicitly initiate a first history
collection when automatic capture has not stored a copy. The initial wizard
shows the saved-copy-missing blocker and permits only native, consented
collection; no unsaved conversation is directly exportable as verified.

Native collection completion and persistence completion are separate: stop
  scrolling first, settle the run's queued captures, then publish completion.
  This is not a substitute for Export's independent selected-path validation.
- Three content profiles: **Основные сообщения** (user/final assistant),
  **Выборочное содержание** (granular reasoning/tool/state/edit/attachments),
  **Техническая копия** (lossless source-native JSON only). Metadata/source
  originality is never sacrificed in technical copy to save space.
- Compact projections may store baseline model/effort and only *confirmed*
  change events. Do not infer a human model switch from a resolved-model change,
  and do not infer a text edit only from `updateTime > createTime`.
- Requested model/effort evidence is captured only from the already documented
  native `POST /backend-api/f/conversation` composer submission (`action=next`,
  `turn_attribution.turn_trigger=composer`, explicit conversation and user-message
  IDs). No `prepare`, UI ordinal or model-label inference. These small source
  facts are scoped to the observed account in RAM, then stored as Message-owned
  Metadata only with a matching accepted native user message. No credentials or
  request body are stored. Conflicting submissions for one ID are marked unknown.
  Selective export emits the first observed baseline, later actual submitted
  parameter changes and explicit observation gaps. It never turns an absent
  effort field into an inferred setting or attributes an unobserved picker action.
- Compact JSON declares `unix_seconds_utc` for all derived timestamp fields.
  Native `create_time` is converted from seconds; local provenance observation
  times are converted from milliseconds explicitly, never guessed by magnitude.
  Unknown/nonrepresentable values remain null. Previous-version observation
  time is not represented as the time or authorship of an edit. Technical JSON
  and explicitly opted-in opaque native content preserve original precision
  and source units rather than rewriting the source to fit the projection.
- Presentation options (`json compact`, `json readable`, `md`, optional `txt`)
  are independent of container/compression (`none`, `zip`, `tar.gz`, etc.).
  Optional large-file export staging may use OPFS, subject to browser execution
  context/quota/cancellation/cleanup verification. Binary assets remain
  experimental until independently accepted.

## Clean database reset and acceptance rules

- **Deliberate clean cutover.** Instead of supporting IndexedDB v3 migrations,
  initialize a new isolated database/namespace with the accepted schema. Old
  local v3 archive data will not be carried over and must be re-collected from
  normal ChatGPT UI if needed. Communicate this loss of local-only history
  before switching. Prefer a new namespace over overwriting existing v3 in
  place; subsequent explicit cleanup of an obsolete namespace is separate.
- Do **not** clear any browser profile as part of documentation work. A later
  controlled reset applies only to the targeted Booster archive database, not
  ChatGPT site data, browser cookies, unrelated IndexedDB stores or other
  accounts/profiles. Reject unsupported new schema versions safely without
  silently deleting contents. A mismatching **ChatGPT source API signature**
  always stops archive writes; it never triggers any reset or re-creation.
- Do not implement compatibility bridges for old archive v3, export v1 or their
  historical cases. Test only the new contract's essential invariants: accepted
  source messages remain exact, rejected batches perform no writes, account
  isolation holds, fresh initialization is stable and current data/query/export
  paths work. Avoid redundant legacy, migration and exhaustive matrix suites.
- Validate real archive *shapes* using safe aggregate observations without
  committing real content, identifiers or private URLs to Git, logs or issues.
  Use focused redacted fixtures for supported signatures, partial history and
  new-schema recovery rather than exhaustive speculative test families.
- Separate validation levels: source audit, unit/schema tests, build/CI,
  browser runtime, live Free/Pro acceptance. CI green or synthetic fixtures do
  not by themselves authorize production claims or issue closure.
- Persist no private identifiers, personal messages, credentials or signed
  asset URLs in repository documentation or issue bodies.

## Agent execution and single-Issue workflow

- **Authority:** this document defines target architecture; runtime/client
  research defines observed evidence; repository code and `dev` define current
  implementation. **Only [Issue #54](https://github.com/KobaProduction/chatgpt-booster/issues/54)
  tracks work for archive storage, strict API contracts and export.** It contains
  six phases (0–5), their dependencies, checklists, role ownership, blocking
  findings and product acceptance. Former phase Issues #55–#60 are closed
  historical records, **not** active task lists.
- **Enter:** read repository `AGENTS.md`, this document, current git state and
  the entire Issue #54. Identify the first unmet, unblocked phase/checklist item
  **inside #54**. Never treat design prose as deployed capability.
- **Execute:** Implementer owns the selected implementation slice and updates
  the matching checkboxes **in #54 only** when supported by proof. Independent
  Reviewer verifies the exact diff/CI/contracts. Tester/product owner performs
  required live Free/Pro visual and runtime acceptance. No named assignee is
  invented where one is not actually appointed.
- **Handoff:** comment on #54 with current phase/checkpoints, actor role,
  branch/head/PR, changes, source/build/browser/live validation, open blockers,
  dependencies and the next decision. Keep sensitive ChatGPT records, IDs,
  credentials and signed URLs out of public issues and CI logs.
- **Closure:** Issue #54 stays open until every mandatory phase and its
  independent/product acceptance is completed. Synthetic Chromium passing
  cannot substitute for live Free/Pro acceptance; do not check acceptance
  boxes without its actual evidence.
- **PR hygiene:** one coherent PR per meaningful implementation slice, not per
  checkbox and not a separate Issue per PR. Use repository writer/reviewer
  authority and stop on architecture/API-signature contradictions.
- **Deferred boundary:** existing [issue #53](https://github.com/KobaProduction/chatgpt-booster/issues/53)
  continues to track the previously requested unfinished branch visualization.
  The master export work may only claim a verified selected path; it must not
  silently solve missing parent links by invention.
