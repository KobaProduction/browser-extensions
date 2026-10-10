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
does not replace live VK browser acceptance or prove extension data isolation.

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
The source workspace migrator and native VK provider have NOT been rewritten to use
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

## VK Booster 3: native archive and independent exporter

The previous VK v2 file-backed exporter and its old controls were **removed**
on explicit product-owner instruction: VK has no existing user archive contract.
The new module is owned by `modules/vk-booster/src/{api,model,infrastructure,ui}`.
It is separate from ChatGPT v3/v4 persistence and does not transfer records
between standalone and aggregate applications.

- `api/vk-source.ts`: VK-specific authenticated history pages and on-demand
  attachment resolution. No tokens, cookies or expiring CDN URLs are retained
  in the normalized database or backups.
- `model/service.ts`: complete history scan to the provider-reported end,
  idempotent message IDs and commit-before-progress. Partial pages cannot
  mark a conversation complete. Completed chats do not repeat capture unless
  an explicit rescan is authorized in a future feature.
- `infrastructure/indexeddb.ts`: independent stores for conversations, messages
  and download receipts. Database name includes product + DEV/PROD channel.
  Backup is read from a consistent readonly transaction, and restore validates
  the scope before replacing rows in a single transaction.
- `model/export.ts`: inclusive date-range export, selectable text and file types,
  `chat.json`, `manifest.json`, and flat `attachments/`; SHA-256 receipts
  allow audits for renamed, modified and missing assets.
- `ui/ArchivePanel.vue`: independent chat viewer, complete capture, export and
  archive backup/restore. A module view inside the shared shell—not a second UI.
- `apps/dev-archive-lab`: synthetic offline Vue application with memory storage
  and source-neutral paging fixtures from `packages/archive`.

This is source architecture and synthetic-fixture verification only until
a separately reported authenticated VK API and six-way Chrome acceptance.

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
VK/ChatGPT archive engine. The VK native archive remains an independent
implementation pending its separate compatibility acceptance. Source and
runtime verification levels are recorded in
[CHATGPT_BOOSTER_MIGRATION.md](CHATGPT_BOOSTER_MIGRATION.md).

## Archive page reconciliation shared by both products

The source-neutral `packages/archive` exposes actual dual-consumer page folding
(including VK complete history capture and ChatGPT strict source snapshot
comparison), record identity, composite keys, SHA-256, and GZIP output.
Provider-specific auth, native DTO validation, storage/checkpoint transactions
and media resolution remain behind their owning module boundaries. Neither
ChatGPT v3/v4 IDB schemas are not rewritten by the VK native archive.

## Browser profile / extension-ID source preservation

The native ChatGPT source-transfer adapter in
`modules/chatgpt-booster/packages/features/src/archive-source-transfer.ts`
reads and restores historical v3/v4 structured-clone source tables
without rebinding legacy owners. Shared archive infrastructure provides
streaming GZIP and checksums; browser IndexedDB schemas stay provider-owned.
A verified canonical backup is an independent, explicit artifact. Neither
transfer silently migrates binary assets, changes extension identity or
claims that all server history is complete.

## Historical source reconciliation (pre-VK 3)

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
[ARCHIVE_DECOMPOSITION.md](ARCHIVE_DECOMPOSITION.md) for precise boundaries.

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
