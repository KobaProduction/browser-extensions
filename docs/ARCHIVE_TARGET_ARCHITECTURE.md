# Archive target architecture and delivery contract

Status: **target design / not yet implemented**. The currently deployed IndexedDB v3,
History Loader, and export v1 remain the implemented baseline until a **clean
new database rollout** and runtime acceptance explicitly prove otherwise.

This document defines durable design constraints. **GitHub Issues are the live plan**:
they contain stage checklists, ownership, dependencies, progress evidence and closure
criteria. Do not add parallel task checklists or a purported implementation-status table
here. See [Agent execution and issue workflow](#agent-execution-and-issue-workflow).

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
- Three content profiles: **Основные сообщения** (user/final assistant),
  **Выборочное содержание** (granular reasoning/tool/state/edit/attachments),
  **Техническая копия** (lossless source-native JSON only). Metadata/source
  originality is never sacrificed in technical copy to save space.
- Compact projections may store baseline model/effort and only *confirmed*
  change events. Do not infer a human model switch from a resolved-model change,
  and do not infer a text edit only from `updateTime > createTime`.
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

## Agent execution and issue workflow

- **Source of truth:** this document is the target architecture; runtime
  contracts and client research are implementation evidence; existing code and
  published `dev` are current state; **GitHub Issues are the only active task
  plan**. Existing [branch-visualization issue #53](https://github.com/KobaProduction/chatgpt-booster/issues/53)
  remains deferred, separate from export and storage work.
- **Enter:** read repository `AGENTS.md`, this document, current branch/diff,
  then the relevant issue and linked dependencies. Identify the next *unmet*
  acceptance criterion from its checklist. Do not treat unreviewed proposal text
  as deployed behavior.
- **Own one stage:** Implementer checks source state, sets issue progress with
  a concise evidence comment, implements only its stage on a working branch,
  and updates its checkboxes when their actual criteria are proved. Reviewer
  independently inspects exact diff/CI/contract gates; product owner/Tester
  checks live behaviors. Never mark acceptance based only on planned code.
- **Handoff:** each issue comment records owner role, current base/head/PR,
  changes, validation level, failures/blockers, dependency state and next
  decision. Use GitHub links to commits/checks instead of copying sensitive
  data or fragile machine paths. Roles are not automatically assigned to a
  specific human or agent account.
- **Finish:** close an issue only after **every** required acceptance checkbox,
  blocker review and independent review are satisfied. A stage whose tests pass
  but live acceptance fails remains open. The parent roadmap issue closes only
  when all mandatory stages are accepted; deferred optional work remains linked.
- **PR hygiene:** prefer one coherent PR per stage (not per checklist item),
  with the writer/reviewer identity split from `AGENTS.md`. Where a stage is
  blocked by a contract contradiction, stop at that boundary and resolve it
  before implementation.
