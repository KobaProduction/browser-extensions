# Current architecture and host permission model

> This page describes **current/transitional implementation**. The
> approved **target** architecture is [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md)
> (DDD + FSD + Ports & Adapters; reusable archive/widgets and app shells).
> This is not a claim that the target is already implemented.

The platform separates **capability-gated feature logic** from **delivery targets**. ChatGPT Booster is the reference implementation for a shared Shadow DOM control center, modular feature lifecycle, settings and two entry points (Tampermonkey + MV3); this repository uses the same architectural concepts but exposes a separate, reusable platform API.

```text
                   @kobaproduction/browser-core
                      (registry, lifecycle)
                                  |
              +-------------------+------------------+
              |                                      |
      browser-ui + adapters                     feature modules
       (Shadow DOM, state)                  vk-booster | future proxy
              |                                      |
     +--------+------------+--------------+---------+
     |                     |                        |
 Tampermonkey         MV3 content/UI            MV3 background
 host-scoped          isolated world             privileged APIs
     |                     |                        |
  VK page            VK page DOM            future proxy.settings
```

- **Core** is browser-API-agnostic, importable by other apps, and never knows VK/ChatGPT selectors.
- **UI** is mounted inside a Shadow DOM to prevent host CSS interference. Shared labels, colors, actions and module status live here. Apps do not fork UI entry points.
- **Adapters** implement settings and privileged API access. A capability is only provided when the target really has it; being a Chromium extension does not imply that `proxy` is granted.
- **Modules** own site-specific selectors, storage semantics, media/export logic, and immutable `module.json` manifests.
- **Userscript/MV3** are packaging adapters; adding a new feature must not copy its business logic. Module registry controls loading and feature lifecycle.

## Static quality boundary

VK runtime, provider integration, media mapping, offline HTML and regression
fixtures are now TypeScript with explicit source/archive/checkpoint contracts.
Strict compiler checks cover the VK fixtures separately; Biome is enforced
for the first-party workspace. The imported ChatGPT workspace keeps its own
quality gate until its compatibility migration is complete. Type safety
does not replace live VK browser acceptance or solve v2 multi-file atomicity.

## ChatGPT Booster compatibility decomposition

The non-distributed ChatGPT refactor baseline remains under `integrations/chatgpt-booster`; the actual experimental module is `modules/chatgpt-booster`
with an independent build and rollback path. Its Archive Browser delegates
conversation list presentation to `packages/widgets/ArchiveConversationList`,
neutral transcript layout to `ArchiveTranscript` with ChatGPT record slots,
docked-window positioning to portable widget geometry, and export progress to
`ArchiveProgressBar`, which VK Archive Manager also consumes. The reusable
useArchiveFocusTracker owns scroll focus/highlight selection;
ChatGPT archive-window-session.ts owns account/revision-pinned reader state.
The ChatGPT-specific export format/level/evidence form is a separate
`ArchiveExportOptions.vue` feature view; source-specific options are not
projected into VK. V4 archive entity/metadata types, physical database
validation, indexed window reads, and account-scoped read/revision queries
have separate owners. Revocable catalog/project writes and account cleanup
are delegated into dedicated ChatGPT IndexedDB write adapters. Write tickets, source-proof and transaction orchestration remain
ChatGPT-owned. The native ingest pipeline is decomposed into
archive-v4-source-records (strict input normalization/dedup),
archive-v4-conversation-head (latest-read provenance precedence),
archive-v4-message-write (stale/dedup/revision snapshots and chronology), and
archive-v4-submission-write (selection evidence/conflict policy).
These write policies run synchronously inside the SAME caller-owned IDB
transaction; none can independently commit, bypass write-ticket checks or
emit success before commit. This is **source decomposition only**,
not canonical migration, data move or ChatGPT browser acceptance.

## Reusable storage and migration building blocks

The packages/storage module now includes bounded IndexedDB scanning via
readIndexedPage/scanIndexedPages for non-unique indexes and
readStorePage/scanStorePages for ordinary primary-key object stores.
For indexed scans, the index key identifies an owner scope while the primary
key identifies the exact resume position even when the index is non-unique.
Pages are read in separate completed readonly transactions; the caller
acknowledges each batch before the resumable cursor advances.
The imported ChatGPT v4 reader uses bounded pages for account-scoped project
and conversation listings. The v3 compatibility reader uses bounded
object-store pages for projects and conversations, replacing their unbounded
getAll requests. Legacy v3 listMessages still reads one coherent readonly
transaction because its result may be used for a saved-chat transcript;
breaking it into separate transactions without source-revision fencing could
mix message revisions. Returned lists still materialize complete, sorted
arrays; batching bounds individual transactions, not aggregate memory.
History revision proof still uses a single readonly transaction because a
multi-transaction scan would weaken its evidence consistency contract.

A separate readPinnedSnapshot/verifyPinnedResult primitive now checks
provider-supplied durable source stamps around async page reads. ChatGPT v4
saved thread windows use the before/after form; saved message-target windows
reuse their own initial transaction-stamped result and reread the header after
that transaction. Their adapter compares conversation revision, recreation
instanceId, selected head and project; request-token and verified-account
guards are also checked before results are returned. A mismatched stamp fails
closed with sourceChanged rather than combining windows across revisions.
This is NOT a cross-transaction snapshot without the provider guarantee
that its stamp changes for every relevant mutation. Legacy v3 message
transcripts therefore remain on their existing single-transaction read path.

The generic migration boundary is now implemented as runStagedMigration
and indexedMigrationDriver in packages/storage. It coordinates a source
fingerprint, exclusive cross-tab lock, explicitly verified restorable backup,
bounded source pages, transform/stage batches, durable journal/checkpoint,
independent staging validation, and atomic active-generation activation.
An IndexedDB staging transaction writes each generated record and its
checkpoint together; generation-scoped records and store allowlists are
mandatory. Failures retain the last acknowledged cursor and cannot replace
the previous active manifest; recovery resumes the same generation.
A subsequent migration plan may rotate a READY journal only when that
journal matches the current active manifest. Any unfinished or incompatible
journal remains a blocker; plans are independent identifiers supplied by
each product rather than a forced v1/v2/v3/v4 conversion ladder.

This is a reusable library contract, not an installed/archive-initializing
migration service. The application adapter must define actual IndexedDB
journal/manifest/staging schemas, source owner evidence, stage-key isolation,
source fingerprints, backup and restore procedures, migration plan/version
and acceptance proof. The library refuses to run without a cross-tab lock.
The source workspace migrator and VK v2 output have NOT been rewritten to use
it; no v3/v4 data have been migrated by this change.

The original ChatGPT Booster source workspace has an in-progress canonical
migration on its own branch. Its source-specific v3/v4 decoding, canonical
ContentElements, account binding, generation activation and migration journal
are not imported as a reusable implementation. Inspection showed its
current draft still scans all conversation headers with getAll; this is a
separate migration-integration change after the active agent has stabilized
the contract. The current uncommitted legacy binding logic
also conflates unknown ownership and explicit account mismatches; activation
requires independently verified account isolation before integration. Generic cursor mechanics are available for reuse, not a claim
of completed migrations or crash-safe cross-tab database upgrades.

## VK Booster migration

The VK archive engine is wrapped as a `Feature` and used by both Tampermonkey and MV3. The duplicate Tampermonkey menu was removed. Its internal VK API/authentication, VK attachment mapping/downloading and offline HTML renderer are separate modules. Linear page selection and an acknowledgement-gated page-scan application service for exact-N/incremental/backfill use `@kobaproduction/browser-archive` with VK-supplied source and commit ports. Its bounded binary response reader also verifies media MIME, length and SHA-256, while VK-specific media URL selection/fallback remains in its provider adapter. Generic directory writes use `@kobaproduction/browser-adapters`. VK-owned checkpoint format, on-disk serialization, media iteration and the public v2 file format remain unchanged. The VK commit adapter stages its next records/checkpoint and publishes them in memory only after both file writes are acknowledged (the browser File System Access API does not provide a multi-file ACID transaction); a complete shared multi-source ArchiveController/Repository/Output has **not** been extracted or adopted by ChatGPT Booster. Selecting an invalid or unreadable archive folder fails closed and restores the previously active folder/data instead of redirecting later writes. Regression checks cover existing semantics, but Chrome/Tampermonkey/MV3 live acceptance is still outstanding.

## VK in-app archive preview

VK Booster 2.3.0 mounts a read-only VK ArchivePreview beneath the existing
shared ArchiveManager. It uses the provider-neutral ArchiveTranscript layout
with VK-specific text, sender, timestamp and attachment-count slots. The
view requests only the latest 80 records initially, expands in 80-record
increments up to 240, and searches existing in-memory archived text through
a bounded VK projection API. It does not load remote history, media or
IndexedDB and does not alter the v2 folder/file format. For the entire
archive and saved media, index.html remains authoritative.

A dedicated single-view installation opens directly to its VK section in
the shared Control Center; multiple-view shells continue to show the module
index by default. Neither path mounts a second launcher or dialog.

VK Booster 2.3.1 adds a route-aware, fail-closed archive owner check for
supported numeric VK /im/convo/{peer} pathnames. Opening another conversation
does not mutate the pinned folder/account: the UI reports a blocked state,
and the engine checks the current peer before authorization, history reads,
checkpoint page commits, media iteration and export completion. Switching
to a new peer is only possible by successfully selecting that peer's archive
folder; failed folder validation restores the prior folder, data and peer.
While a folder selection is pending, its transient handle and any previously
loaded messages are hidden from the public status snapshot, and concurrent
exports/folder selections are rejected. SPA changes are checked at action
boundaries even when VK does not emit browser navigation events; the mounted
VK view refreshes context while open without patching history APIs.

VK Booster 2.3.2 reserves the folder-selection operation before opening the
native directory picker or requesting permission. While the picker is pending,
the shared Archive Manager shows the selection state instead of an export state,
disables export/resume/stop and hides the previously bound folder and preview.
If VK navigates to another conversation during the picker, selection fails
before the new folder is opened for archive writes; cancellation restores the
original folder and state. An existing archive preview is also hidden when the
current conversation no longer matches the selected folder. The on-disk v2
metadata, messages, media and HTML formats are unchanged.

VK Booster 2.3.3 reserves an export before its first asynchronous authorization
request. Another export or folder selection cannot overlap with pending VK
authentication. On authorization failure or a conversation change, the reserved
operation is released before creating a checkpoint, preserving the selected
archive and its on-disk data. A stop requested during authorization is not
cleared by a later auth response. The VK v2 archive format remains unchanged.

VK Booster 2.3.4 applies the same active-conversation and folder-selection
fence to direct archived-message/preview API reads and standalone offline-HTML
regeneration. Public readers return independent snapshots, so mutations to
returned records cannot alter in-memory data later saved by checkpoints.
This is a compatible read/write boundary hardening, not an archive migration.

VK Booster 2.3.5 checks the bound conversation after asynchronous media fetch,
decode and before binary/archive metadata writes. Navigation mid-download stops
the run without advancing the saved media cursor, allowing safe retry from the
original chat. Loading a v2 folder also rejects records with an explicit
peer_id different from the folder peer; records lacking peer_id remain
compatible with earlier v2 exports.

VK Booster 2.3.6 fixes the browser distribution build: emitted Vue bundles
compile `process.env.NODE_ENV` to a literal before the code runs without Node.
Built userscript and Chromium content outputs are now checked for unresolved
Node environment globals, preventing a silent build-pass/runtime-crash
regression. Version and v2 archive layout remain backward compatible.

VK Booster 2.3.7 makes the shared draggable launcher operable via
keyboard or assistive technology. Pointer-up remains responsible for
distinguishing a tap from a drag; a synthetic/keyboard click toggles the panel
only when its click detail is zero, avoiding double activation after a
mouse/touch pointer-up. The launcher exposes its dialog expansion state.

VK Booster 2.3.8 replaces the obsolete launcher letter B with the actual
shared ChatGPT Booster Layers3 icon. The same shared shell shows a close icon
when expanded; drag, pointer, keyboard, focus and modal behavior remain intact.
No separate product launcher or second modal is added.

## Proxy roadmap

The future Proxy Switcher must be implemented as an **extension-only background service** with explicit `proxy` permissions, not as page injection. Configure per-host routing through Chrome's `proxy.settings` PAC support when permission is granted; maintain a typed profile store with `HTTP`, `HTTPS`, `SOCKS4`, `SOCKS5` and bypass lists. Credentials require a separate safe storage/authentication model. Userscript builds expose an unsupported status rather than simulating the feature. User-Agent switching likewise needs MV3 request rules or API support and user-granted permissions, not DOM navigator spoofing alone. Ad blocking should eventually be isolated behind `declarativeNetRequest` plus its own permissions and rule bundles.

This capability model prevents all-in-one packaging from automatically acquiring every dangerous browser permission. Each future feature declares the permissions it needs, and target manifests should request them only when included and explicitly enabled by the user.

## Optional shared telemetry

The headless core exposes TelemetryBus and a single TelemetrySink interface,
which ChatGPT Booster or other apps can implement with its existing OTLP
transport. Telemetry is **off by default** and requires explicit opt-in.
Events are restricted to validated module IDs, lifecycle event names and
durations; URLs, chat text, files, cookies, tokens and proxy credentials are
never included. A sink error cannot stop any module. No external endpoint
or always-on tracking is built into this repository.

## Booster-derived shared UI (ongoing refactor)

Shared UI exposes Booster shadcn-vue primitives. The `browser-widgets` package
owns a provider-neutral Archive Manager form/progress/actions; VK's feature view
only adapts `VKExport` to it. A separate shell owns Shadow DOM, draggable
launcher, centered modal and section navigation. VK export is rendered inside
one Control Center, not a second modal.
This implementation still needs browser acceptance and independent review.

## ChatGPT Booster migration checkpoint (2026-10-10)

The monorepo now includes an unreleased ChatGPT Booster module that reuses the
platform FeatureRuntime and one Shadow DOM Control Center. The original native
history/IndexedDB and product-facing Vue components are staged under the
ChatGPT module; apps compose browser-specific transport and permissions. One
portable gzip output implementation lives in `packages/archive`.

This is a source-preserving adapter-first migration, not a completed common
VK/ChatGPT archive engine. The VK v2 exporter remains an independent, unchanged
implementation pending its separate compatibility acceptance. Source and
runtime verification levels are recorded in
[CHATGPT_BOOSTER_MIGRATION.md](CHATGPT_BOOSTER_MIGRATION.md).

## Archive page reconciliation shared by both products

The source-neutral `packages/archive` exposes actual dual-consumer page folding
(including VK exact-N/incremental/backfill and ChatGPT strict source snapshot
comparison), record identity, composite keys, SHA-256, and GZIP output.
Provider-specific auth, native DTO validation, storage/checkpoint transactions
and media resolution remain behind their owning module boundaries. Neither
VK v2 folder files nor ChatGPT v3/v4 IDB schema is rewritten by this stage.

## Browser profile / extension-ID source preservation

The native ChatGPT source-transfer adapter in
`modules/chatgpt-booster/packages/features/src/archive-source-transfer.ts`
reads and restores historical v3/v4 structured-clone source tables
without rebinding legacy owners. Shared archive infrastructure provides
streaming GZIP and checksums; browser IndexedDB schemas stay provider-owned.
A verified canonical backup is an independent, explicit artifact. Neither
transfer silently migrates binary assets, changes extension identity or
claims that all server history is complete.

## Reconciliation with advanced VK Booster 2.3.7

The advanced VK 2.3.7 TypeScript engine, ArchiveManager/Transcript widgets,
acknowledgement-gated folder output, bounded media verification and protected
SPA navigation have priority over the earlier monorepo VK 2.2.0 inline engine.
The shared `selectArchivePage` compatibility API now delegates record identity,
exact-N and duplicate selection to `foldArchivePage`, which is also consumed
by the ChatGPT v4 native ingest adapter. VK alone owns its File System Access
folder schema and checkpoint acknowledgement; ChatGPT alone owns account-
verified canonical IndexedDB generations. The secondary
`integrations/chatgpt-booster` tree is a non-distributed refactor/reference
snapshot; only `modules/chatgpt-booster` is an executable product entry.
