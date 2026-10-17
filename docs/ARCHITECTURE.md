# Current architecture and host permission model

## Normal/private window startup correction (2026-10-17)

The validated installation-scope gate now accepts DEV and PROD in either window
mode. Userscript builders no longer emit an incognito-only execution directive;
ChatGPT background commands and existing-tab bootstrap no longer reject normal
DEV tabs. MV3 split incognito mode, channel identities and storage ownership are
preserved. Browser installation and live collection remain separate checks.

## VK incremental collection and source revisions (2026-10-17)

VK capture anchors native history requests, deduplicates overlaps and atomically
retains changed observations with prior source values in the existing snapshot
row. A provider-owned complete-scan marker allows reuse of a verified saved tail
after an unchanged message older than 24 hours; partial first scans cannot create
that shortcut. The indexed covered range, owner/peer, native count/head and archive
notifications guard it. Restore discards this capture optimization proof. Exports
preserve source revisions; the physical Dexie v1 schema and historical stores stay
unchanged. See the [VK contract](vk-booster/ARCHIVE.md) for validation boundaries.

## ChatGPT RAM gateway and archive workspace (2026-10-16)

`ConversationStateStore` composes the exported `ConversationObservationGateway`
before source projection. `FixedChatGptCapture` consumes admitted gateway entries
and replays them when routing policy changes; local writes and acknowledged
external delivery have separate queues. `ConversationArchiveWorkspace` retains
UUID-keyed preferred records and relationship indexes, presents live RAM first,
then hydrates canonical originals in read-only chunks of at most 160 rows.
The Reader displays hydration/missing-parent progress; received/saved menu
counters measure different circuits. Explicit saved-revision inspection and
canonical exports retain their proof guards. Source details and boundaries:
[ChatGPT live contract](chatgpt-booster/LIVE_ARCHIVE_CONTRACT.md).

## Responsive UI and local explorer checkpoint

The shared Shell renders full-screen panels at 620px and below; larger viewports
retain floating geometry. Embedded module settings use desktop cards and compact
tablet rows. UI Acceptance Lab starts with a direction map and mounts real
components only inside a selected task; product and aggregate host selection
are independent. The [UI acceptance contract](shared/UI_ACCEPTANCE.md) owns
behavior and browser gates. This does not establish installed-product acceptance.

The compact side toolkit now shares one dock/close bar with its launcher, following
the retained ChatGPT dock interaction. The provider supplies context visibility
and context-change notifications for quick actions; VK exposes conversation tools
only for a current conversation. The lab restores presentation when replacing
its synthetic host adapters, without transferring provider records or operations.
Local source/build and synthetic browser evidence is recorded in
[REFACTOR_PROGRESS.md](REFACTOR_PROGRESS.md). Installed-product acceptance remains
separate.

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
`packages/widgets/archive-reading-scroll` owns user-driven adjacent loading and
visible-record anchoring for both products; `ArchiveReaderNavigation` owns their
first/latest actions. `packages/archive/reader-window` owns the shared page and
retention policy and identity-based adjacent-record merge. ChatGPT's
archive-reader-window adapter retains account/revision guards and thread
projection; VK's readWindowFixed supplies owner/peer/revision-stamped stored
records. Database/source reads remain provider-owned. This replaces the former
manual VK page action without loading an unbounded transcript into the DOM.
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
view reads bounded 80-message pages, starting from the latest saved records,
and can page back through the entire locally archived conversation (including
filtered search matches) using an offset-based VK projection API. It does not
load remote history, media or
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
[CHATGPT_BOOSTER_MIGRATION.md](chatgpt-booster/MIGRATION.md).

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

## Shared source-storage refactor (2026-10-10)

The platform exposes `packages/storage` IndexedDB request, completed
transaction and bounded page primitives. ChatGPT now consumes them; VK
continues to use the shared archive page/media use cases and File System
Access adapters rather than introducing an unnecessary IndexedDB store. The ChatGPT canonical source reader also uses source-neutral indexed timestamp **range** continuation
on the `(indexKey, primaryKey)` pair to avoid skipping records sharing a
timestamp. ChatGPT's v4 types, identity rules and read-only queries now live
in separate provider-owned files, while its v4 physical schema, write ticket,
ownership proof and native/canonical transaction policy remain source-owned.
The VK export progress is now a thin adapter over the same `ArchiveProgress`
primitive that renders ChatGPT archive/export progress, with each provider
still owning its phase/total state. See
[ARCHIVE_DECOMPOSITION.md](chatgpt-booster/ARCHIVE_DECOMPOSITION.md) for precise boundaries.

## Canonical archive reading and migration responsibilities (2.0.4)

`ArchiveCanonicalMigrator` is now the staging, locking, generation activation,
reconciliation and rollback coordinator only. `ArchiveCanonicalReader`
provides generation-pinned saved Reader windows and previews;
`archive-canonical-export` handles partial recovery export;
`ArchiveCanonicalAudit` reports read-only coverage and ownership evidence.
All use explicit data/active-generation ports. Original migrator methods and
ChatGPT v3/v4 physical storage schemas remain unchanged. These services are
ChatGPT-owned; the provider-neutral paging/transaction/renderer primitives
are shared under `packages/`.

## Revised VK first-release checkpoint (2026-10-11; source branch)

The earlier VK 2.3.x/v2 historical notes above describe previous source
iterations, not the newly accepted release contract. The VK development
branch now produces folder-style Archive **schema 1** and freezes VK source
semver at **1.0.0** for pre-first-PROD development, retaining the existing
history capture, File System Access sink, media receipts, Control Center and
offline HTML viewer. A historical schema-2 or state/pages folder is rejected
without writes; no migration path or deployed downgrade is claimed.
Shared Dexie telemetry and OTLP (PR #32) remain in a separate, unmerged
source branch. They are neither VK's canonical IndexedDB archive nor a
working runtime collector until provider opt-in/transport wiring is accepted.

The source-version freeze in that historical checkpoint was superseded on
2026-10-17: VK now advances major/minor/patch independently of PROD approval
and is at 1.1.0. This does not change archive schema 1 or migrate historic data.

## New Dexie runtime adapters (source checkpoint 2026-10-11)

ChatGPT's single Control Center composes a fixed canonical v1 capture
subscriber, bounded Dexie read and explicit source-preserving export. The
existing v4 archive path remains mounted for historical continuity; a
single-writer runtime cutover is not yet accepted. VK now provides a separate
explicit `captureFixed/readFixed/exportFixed` action through its authenticated
peer-scoped API in the same panel; the former v2 folder engine is retained
and not migrated. Both products enforce product/channel/target and owner
identity; their own schemas do not follow the ChatGPT/VK API response format.
OTLP delivery remains deferred and opt-in under Issue #30.

## Dexie archive-only runtime switch (2026-10-11)

ChatGPT Booster source composition no longer instantiates ArchiveV4Store,
ArchiveV4CaptureModule, ArchiveV4Reader or the v4 UI adapter. Its only
application archive writer/Reader is FixedChatGptCapture backed by the
owner-scoped Dexie v1 repository. History-loader session progress uses this
capture service, with no active v4 commit or warmup. Old v4 source code and
physical browser databases remain intact solely for the explicit read-only
backup utility alongside the stable 0.8.92 v3 exporter. Future provider
source changes are normalized to fixed v1 data; no automatic migration.
VK is now integrated with its own Dexie v1 data store; OTLP network remains deferred.


## Installation lifecycle & clean canonical storage (source checkpoint 2026-10-11)

Shared FeatureRuntime serializes per-installation start/stop and user
enable/disable transitions; all provider mounts/listeners/hooks must be
cleaned up while retaining the shared shell as a reactivation surface.
Scoped FeatureSettings uses product/channel keys, and the MAIN-world
observer is activated by its matching isolated content runtime only.
The Chromium popup and userscript Control Center provide live toggles.
The fixed ChatGPT archive stays Dexie schema v1; legacy native readers
and migration controls are not present in the active product. Physical old
databases remain untouched for a separately handled owner-run recovery.
The installed-browser DEV+PROD coexistence gate is still open.

## VK merged-main reconciliation checkpoint (2026-10-11)

After PR #36, VK's current working-branch user interface routes capture,
bounded saved Reader and source-preserving gzip export to the fixed Dexie v1
repository. Its old folder writer is no longer exposed via the user interface
and accepts only the synthetic test-mode gate. Original media downloads and
legacy offline HTML are retained in historic/test code, not a proven Dexie
export capability. The integration checkpoint had VK 1.0.0, ChatGPT 2.0.13
and all-in-one 0.5.14; current manifests remain the version authority.
Settings persistence is separate from canonical archive persistence.

## Portable TAR / TAR.GZ (source implementation; browser acceptance pending)

`packages/storage` owns streaming POSIX ustar with a single GZIP stream,
bounded plain JSONL chunks, exact IndexedDB schema and integrity manifest.
The shared backup UI is a presentation adapter; providers own their Dexie
record/graph validation and atomic scoped replacement. The former 128 MiB
decompressed restore/rollback buffer describes the earlier implementation.
Current source stages sealed input and rollback in a separate known scoped
temporary Dexie registry, with immutable indexed readers and a durable journal.
It does not change primary schemas or activate migration generations.

Large user-selected output streams to a temporary File System Access sink and
publishes only after final provider validation. Compressed Blob fallback remains
128 MiB. Sectioned backup manifest v2 supports checksummed sequential fragments
for large rows while retaining v1 input compatibility. Wire chunks/manifest stay
bounded to 4 MiB, one reassembled serialized row to 64 MiB, and TAR entries to
8 MiB. Persistent staging requires enough quota for input and
rollback, and long provider transactions still need browser acceptance. A scoped
origin Web Lock prevents concurrent local operations, but cannot make GM state
on different origins or different storage backends crash-atomic. Interrupted
rollback remains available for explicit recovery/discard after reload; no startup
restore or orphan deletion runs. UI Lab injects a bounded memory-only stage.
See [the current backup contract](shared/BACKUP_AND_RESTORE.md); source readiness
does not establish large-data, installed-browser or release acceptance.

## ChatGPT UI decomposition checkpoint (Extension 15)

The shared `@kobaproduction/browser-ui` package owns reusable
`ModalSurface`, `FloatingInfoPopover` and `JsonViewer` Vue primitives. ChatGPT
consumers import them via the public API rather than retaining identical
copies. The former ChatGPT-specific quick action row and separate fixed-Dexie
summary card have been superseded by reusable Shell quick actions and scoped
metrics. `ChatGptPanel` owns provider archive operations and verification. This source refactor is not installed-browser acceptance.

## Edge launcher and reusable conversation collection (Extension 15)

`packages/shell` owns a side-snapped launcher, compact quick menu and
responsive full settings panel. Active origin matching prevents all-in-one
from showing an unrelated product's quick menu. Each Feature may override
launcher behavior and supply actions and counters without editing the Shell.
The ordinary ChatGPT and VK panels reuse `ConversationCollectionAction` from
`packages/widgets` and the provider-neutral collection lifecycle/controller
from `packages/archive`. Their actual ChatGPT History Loader and VK Dexie
record-fetch implementations remain behind their respective adapters.
No installed-browser visual or data acceptance is implied by source tests.
# Configurable framework source checkpoint (2026-10-14)

The common core now accepts contributed settings categories, independently
enabled module lifecycles and backup sections. Shell owns one responsive catalog,
edge toolkit, application identity/version and independent display preferences.
Shared UI owns schema-driven site injection and catalog primitives. Shared
telemetry owns consent, scoped journals, delivery queue and local history; MV3
uses an extension worker, Tampermonkey uses its scoped GM store. Archive commit
invalidation carries no private data and providers revalidate their own reads.

These are local source changes. The owner now permits local synthetic checks,
isolated browser validation and a loopback WebSocket fixture. The change has not
been published. The full requested
scope and remaining limits are in [REFACTOR_PROGRESS.md](REFACTOR_PROGRESS.md).

## Ordinary export correction checkpoint (2026-10-14)

ChatGPT and VK reuse shared chunked JSON/Markdown/text formatting, range and
integrity contracts, source codecs and Blob-backed ZIP packaging. Provider
authorization, completeness evidence, source revisions and branch/version policy
remain at their boundaries. The correction removes a whole-output string from
built-in ChatGPT formatting, preserves source versions for prototype-name IDs,
and rechecks owner/cancellation after the last awaited source check. Graph audit
retains lightweight relationship facts. Selected source/variant data and the
output Blob still scale with size; no constant-memory or universally faster
export is claimed. The [ordinary export contract](shared/CONVERSATION_EXPORT.md)
owns exact behavior, focused evidence and remaining data/browser acceptance.

## Shared versioned message authority (2026-10-14)

`packages/archive/src/message-model.ts` owns the single `ArchiveMessageV1`
contract for both providers. New ChatGPT/VK schema-1 snapshots store the additive
`normalized` envelope, with provider/owner/conversation/message identity,
author/time/content/context, explicit relationship/evidence state and a source
reference. Provider projection/index rows remain compatibility caches; native
originals remain separate lossless companions. The same validated stored DTO
feeds local reading, ordinary export and normalized remote publication. Legacy
rows adapt in memory without rewriting or changing tables/indexes. Strict
source/identity/version checks reject inconsistent envelopes; unknown source
content remains opaque. Per-message terminal evidence cannot establish an
entire conversation's completeness. See the
[message and export contract](shared/CONVERSATION_EXPORT.md).
