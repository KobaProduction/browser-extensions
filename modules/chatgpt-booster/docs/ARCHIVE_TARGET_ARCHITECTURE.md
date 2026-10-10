# Archive target architecture and delivery contract

Status: **active architecture / migration implementation pending**. The DEV build
currently writes source-native messages into isolated v4 IndexedDB. This is
not yet the stable canonical archive described below. User-approved decision
2026-10-09 supersedes the former no-migration, clean-cutover policy. Data in
v3 and v4 must remain intact until a separately verified conversion is committed.

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

- **Provider-independent archive.** Booster owns the primary canonical message,
  ordered content-element and branch/relationship schema. ChatGPT responses
  enter only through versioned adapters; no UI or ordinary saved export should
  require the current native ChatGPT schema to read already archived data.
- **Lossless source provenance.** Preserve original source-native records and
  their versioned signatures as immutable companion evidence, separate from
  canonical entities and presentation indexes. Raw JSON is not the sole or
  primary saved representation.
- **Preserve and migrate legacy data.** Existing v3 and v4 archives remain
  readable and untouched during a controlled migration into the canonical
  model. Never silently assign unknown owners, infer pagination/parent proof,
  overwrite conflicting records or drop unrecognized elements. Only committed
  and verified migrated data becomes authoritative.
- **No private ChatGPT history requests.** Collect by observing the native client
  while it loads its own pages. Live UI remains memory-first through
  `ConversationStateStore`; IndexedDB must never block live decorators, timers,
  activity or normal ChatGPT behavior.
- **No destructive cutover.** Keep existing source databases intact and offer
  read-only legacy access while preparing migration. During the actual archive
  migration, block archive writes, archive export and canonical Reader access
  until the committed schema is verified; native ChatGPT remains operational.
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
- Stable Booster Message fields are the canonical, versioned domain identity,
  including role, selected author, timestamps with source units/provenance,
  optional verified parent/branch relations, lifecycle and message category.
- Original ChatGPT message objects remain immutable **SourceSnapshots**.
  Never inject Booster fields, strip unknown values, rewrite original timestamps
  or reserialize a projection as the original source.
- A Message owns ordered **ContentElements** (text, rich-text spans, reasoning,
  tool call/result, code, attachments, media, internal/unknown source markers).
  Each element carries a stable local ID, parent/container, sibling position,
  semantic kind and source/reference provenance. These are canonical *structural*
  positions, not transient DOM coordinates, CSS selectors or pixel positions.
  Source-defined order is retained where observed; unverifiable relations stay
  explicit unknowns, not manufactured topology.
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

## Canonical archive, schema evolution and migration (decision 2026-10-09)

This section **supersedes** all former "no v3 migration", clean-reset and
"native raw is the primary model" statements in earlier archive documents.
It is a new delivery requirement; previous 42/44 acceptance describes only
the historical v4 source implementation, not this canonical-migration project.

### Stable ownership and content layout

- **Canonical model v1:** Project, Conversation, Message and typed Metadata
  remain the four main domain aggregates. Message content consists of
  versioned child ContentElements indexed by account, conversation, message
  and stable sibling position. Element fields include `elementId`,
  `parentElementId`, `order`, `kind`, `visibility`, typed body/reference
  and `provenance`. An ordered tree supports visible text segments, formatting
  spans, reasoning, code, tool calls/results, image/file references and
  intentionally opaque unsupported elements. Use bounded indexes, not a
  monolithic denormalized transcript or duplicated project titles.
- **Source provenance:** an immutable SourceSnapshot stores the original
  native parsed object, source signature, observed-at/read ID, fingerprint and
  link to the canonical Message revision. An unsupported native variant may
  be quarantined without changing the last usable canonical projection.
  A legacy v3 source record is never represented as a *new* confirmed server
  read. Raw source and opaque metadata may be preserved even when the canonical
  renderer cannot interpret an element.
- **Relations/proof:** parent/branch links, source page continuity, selected
  head, element order and record completeness have independent evidence states.
  Importing v3 `archiveState=complete` is not by itself proof of native
  selected-path completeness under the current v4 verifier. A canonical
  conversation remains browsable even if complete export lacks proof.
- **Stable reader/export:** Archive Browser, search, bounded pagination and
  ordinary saved export depend on canonical entities and ContentElements, not
  on a ChatGPT response or whichever source adapter was installed most
  recently. Technical export can separately include immutable SourceSnapshots.
  Unsupported **new ingestion** stops at its own adapter boundary without
  hiding or invalidating already verified saved data.

### Independent version axes

Track **four independent versions**, never one overloaded "archive version":

1. `storageSchemaVersion` — physical IndexedDB stores/indexes/transaction
   shape, upgraded using an explicit registered ordered migration.
2. `canonicalModelVersion` — stable domain and ContentElement semantics;
   stored per-record/projection and as a database manifest.
3. `sourceAdapterVersion` — external ChatGPT native input signature. A new
   adapter maps accepted inputs into the *same* canonical model where possible.
4. `migrationPlanVersion` — versioned, idempotent conversion/verification
   recipe with `from`/`to`, implementation identity and acceptance evidence.
   Export serialization has its own pre-existing format/version contract.

The **existing** `chatgpt-booster-archive-v4` namespace is retained and
evolved rather than introducing yet another empty archive on each update.
IndexedDB version changes only define structural upgrades. Content backfills
and older-archive imports run as journaled application migrations; they are
not attempted as one huge `onupgradeneeded` transaction.

### Migration coordinator and user experience

- On startup, read the database manifest first. Compare physical schema,
  canonical model, supported migrator path and target version. If a migration
  is required, acquire a cross-tab exclusive migration lease/fence, revoke
  pending archive writes/collection, and display an *archive-scoped blocking
  screen*: **"Адаптация архива. Подождите…"** with current phase and measured
  progress where available. This does **not** block native ChatGPT or unrelated
  Booster features. Prevent stale tabs from writing an older schema.
- State machine: `checking → backup_verified → staging → transforming →
  validating → activating → ready`, with explicit `waiting_for_owner`,
  `paused`, `failed_recoverable` and `unsupported_version` states.
  Percentage requires a grounded count of source records/bytes; unknown work
  shows an indeterminate indicator. No success screen until target is
  independently readable and the activation marker is durable.
- Before mutation, create/check a restorable backup/snapshot. Stage conversions
  into a separate generation/namespace or partition without overwriting
  committed records. A durable journal/checkpoint covers target version,
  source version/fingerprint, scanned/converted/rejected counts, owner scope
  and activation fence. Small batches are atomic and retryable; crashes,
  quota exhaustion, tab closure and multi-tab contention resume/rollback
  without reapplying already committed rows.
- Validate identities, counts, source hashes, canonical element order,
  parent references, account isolation and indexes. Atomically activate
  the fully validated generation. After activation, old source archives and
  backups remain untouched until a **separate**, user-authorized retention/
  cleanup decision. Never call `indexedDB.deleteDatabase` as migration.
- If migration is unsupported, corrupted, incomplete or missing permissions,
  **do not** show an empty archive as if all data were lost. Show an actionable
  recoverable status (retry, verified backup, legacy read-only access,
  account-binding step). Do not fall through to an empty new archive.
- Manual one-time **v3 → canonical** recovery is a separately reviewed,
  opt-in import using verified native owner evidence. The observed v3
  conversation `raw.owner` is present only for some chats; a missing owner
  requires explicit user binding to the verified account or quarantine.
  Existing v4 source messages must also be included/deduplicated by scoped
  identity and fingerprint. Preserve conflicts and unknown parent/page
  linkage as unverified; do not forge records or claim complete export.
  Source v3/v4 databases stay unchanged throughout this import.
- Future **canonical schema** upgrades use the registered migration scripts
  automatically where the supported chain and resource preflight succeed.
  A native ChatGPT source adapter update ordinarily **does not** require a
  database migration: it changes only input decoding and proof metadata.

### Canonical recovery correction checkpoint (2026-10-10, feature branch)

Implementation work in `feature/archive-canonical-migrations` now includes:

- The saved Reader rehydrates bounded message windows from matching immutable
  `SourceSnapshots` rather than synthetic native-shaped projections, preserving
  model/tool/reasoning metadata and truthful raw record inspection. A missing or
  mismatched snapshot is an explicit read error, never an invented source.
- Canonical windows include null-timestamp records using a bounded-memory
  cursor fallback; focused navigation avoids whole-conversation `getAll()`.
  Null-timestamp windows can still require O(n) indexed cursor traversal.
- Read-only inventory compares the distinct union of v3 and account-scoped v4
  conversation IDs to canonical records, with per-chat source counts and owner
  status. Counts are **not** message-ID/fingerprint equivalence or completeness
  proof. A separate all-history reconciliation rescans older v3/v4 records;
  ambiguous owners require specific selected conversation IDs before import.
- Interrupted staging retains access to its previously activated generation;
  all-history reconciliation under an exclusive cross-tab lock can restore the
  prior manifest without activating incomplete staging. Starting a second
  full migration over an already active generation is rejected.
- Canonical partial JSON recovery `booster-recovery-unverified-v2` serializes
  source snapshots in bounded batches, grouping identical fingerprints rather
  than duplicating the same native body and a canonical text projection.
  Existing strict verified-path export remains separate; this recovery format
  does not assert that unknown native pages, selected branches or binary
  attachments have been captured. Older recovery-v1 documents are not silently
  reinterpreted.
- The v1 `custom` JSON profile no longer embeds full `originalRecord` for
  tool/reasoning records; raw remains present in the explicit `full` profile.
  Full ZIP no longer repeats those same originals in `records.raw.json`.
- Ordinary export UI exposes saved partial export directly, while verbose
  source verification and advanced preferences are behind disclosures.

**Current validation is limited:** an isolated synthetic Chromium IndexedDB
scenario exercised v3/v4 source retention, two old missing-owner chats, all-time
recovery, untimed messages, metadata/preview/export and interrupted-manifest
rollback. This does **not** prove backup/restore fidelity, per-message hash
parity of the user's full historical corpus, all branching/content variants,
large-file performance in the user's profile, or product acceptance. Old v3/v4
source stores and previous generations remain untouched. Do not merge or
publish this migration as an accepted DEV default until independent review and
user-profile-safe verification of the remaining gates.

### Acceptance boundaries

Track this new scope **inside Issue #54**, not in historical phase issues.
Require independently verified backup+restore, v3/v4 count reconciliation,
owner ambiguity/quarantine, idempotent resume, rollback/failure and
cross-tab fencing, canonical element order/fidelity and independent
reader/export of saved data during an incompatible *new* ChatGPT signature.
Verify actual UX blocking/unblocking for a supported migration. These checks
are new requirements; do not silently count the old 42/44 as their acceptance.

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
4. Stop **new ingestion and any export claiming verification of that rejected
   source** with `incompatible_source_contract`. Show a safe source-signature
   diagnostic (no private content/credentials in telemetry), preserve saved
   canonical data and keep independent **already saved** reading/eligible
   export operational. Native ChatGPT remains unaffected. Do not confuse an
   adapter mismatch with a canonical database migration requirement.
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
is exposed. A new internal database version must never rewrite immutable
source snapshots or reset the database because a ChatGPT API signature changed.
Canonical records evolve only through an explicit verified versioned migration.

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
raw message bodies. For earlier local v4 recordings containing only source-native snapshots,
the transition backfill must produce canonical records in a staged generation,
retaining the original source objects unchanged. Until that stage is verified,
legacy read-only access remains available. A non-contiguous revision chain is
rejected instead of presented as verified; older snapshots without a
fingerprint are compared canonically on demand, never guessed.

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

## Preservation and acceptance rules

- **No archive reset.** Do not delete, silently orphan or truncate v3, existing
  v4, ChatGPT site data, cookies, unrelated accounts or browser profiles.
  A new release that needs migration must show the migration state and preserve
  read-only access to the old archive until a verified conversion is active.
- v3 and v4 preservation is a release-blocking requirement; schema upgrades
  must validate and retain old data rather than causing an empty Reader.
  Source compatibility failure is never grounds for storage reset.
- Focus tests on model conversion fidelity, typed content-element order,
  migration idempotency, owner isolation, staged atomicity and failure/
  recovery. Do not add broad speculative UI suites; perform targeted live
  browser acceptance on a safe copy before enabling automatic upgrades.
- Validate real archive *shapes* using safe aggregate observations without
  committing actual messages, IDs, credentials, private URLs or signed asset
  links to Git, logs or issues. Distinguish source/static/build/isolated
  browser/live account acceptance.

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
