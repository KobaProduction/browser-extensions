# Target architecture for Koba Browser Extensions

## Window-independent startup correction (2026-10-17)

The owner withdraws incognito-only DEV startup. Supported normal and private
windows share the same startup/collection eligibility, with product/channel/
installation isolation still mandatory. Userscript metadata and MV3 provider,
worker and existing-tab gates must agree. The [environment contract](shared/ENVIRONMENTS_AND_STORAGE.md)
owns the corrected policy; this target does not establish installed-browser acceptance.

## VK incremental capture correction (2026-10-17)

The owner requests full-history capture that adds missing messages, rechecks recent
messages and can stop at an unchanged saved message older than a day only when a
prior complete native scan covers the retained tail. Changed observations must
preserve earlier source values rather than abort all collection or destroy originals.
Source evidence belongs to VK capture/repository, with network paging and explicit
owner/peer guards; UI only reports actual reads, revisions and reused saved coverage.
The [VK contract](vk-booster/ARCHIVE.md) owns the exact policy. This source direction
does not establish installed Tampermonkey or real VK acceptance.

## ChatGPT two-circuit observation and workspace correction (2026-10-16)

The first circuit retains owner-scoped native observations in RAM independently
of persistence policy. The second distributes retained evidence through current
local/remote permissions and supports idempotent policy replay. Ordinary archive
viewing reads that RAM workspace first, then hydrates canonical DB originals in
bounded chunks, with visible loading and relationship gaps. UUID/parent indexes
provide direct identity lookup; source IDs never imply chronology. This replaces
the prior saved-only ordinary Reader direction; explicit saved-revision and
export/backup guards remain. Exact semantics and counters belong to the
[ChatGPT live contract](chatgpt-booster/LIVE_ARCHIVE_CONTRACT.md).

## ChatGPT reaction boundary correction (2026-10-15)

ChatGPT business reactions use observed fetch/XHR/SSE/WebSocket evidence or
explicitly bound and decorated native application methods only. DOM selectors,
mutations, button state, renderer text, URL polling and arbitrary internal events
cannot determine request timing, action confirmation, messages or automation.
DOM remains a presentation placement/update adapter. Native commands have no
DOM-click or synthetic-input fallback. Missing verified native methods report
unsupported. This supersedes earlier optional DOM timing/trigger allowances;
the owning [live contract](chatgpt-booster/LIVE_ARCHIVE_CONTRACT.md) defines the
source and confirmation boundary.

## Latest framework and data-preservation direction (2026-10-14)

The owner requests a configurable shared framework rather than product shells
which assume one conversation-saving feature. Reusable catalog/navigation,
launcher/dock, injection lifecycle, module activation, telemetry, recovery and
archive UI belong to `packages/`; providers own site/API/auth, canonical schema,
source codecs, completeness evidence and capabilities. FSD is applied within
actual responsibilities, without empty architectural layers.

ChatGPT lifecycle derives from intercepted API/SSE/WebSocket evidence. DOM
observation may locate rendering targets, but must not manufacture request or
answer state. New observations must not truncate a richer saved response;
contradictory versions remain inspectable. Archive changes are commit events,
and graph completeness/branches are visible with navigation to missing evidence.
Selectable exports and independently restorable settings/session/data sections
are required. Sound behavior is an optional ChatGPT module, not a VK dependency.

This target supersedes older operator-only backup UI restrictions. Source and
remaining gates are tracked in [REFACTOR_PROGRESS.md](REFACTOR_PROGRESS.md).

## Current clean-storage and live-toggle direction (2026-10-11)

Fixed canonical ChatGPT v4-era source model persists in **Dexie schema v1**.
There is one active new-database Reader, Writer and exporter. No old v3/v4
native IndexedDB migration/import/Reader or physical erase in this product.
Historical recovery is an external owner-run process.

The platform owns installation/channel/target activation and reversible
hooks: DEV and PROD may run side by side, with separate settings, database
and observer events. Each can be switched entirely off/on without page
reload while retaining its small Control Center/popup. Host-specific MAIN
transport interception remains at the provider boundary, but the
activation/stop/cleanup contract belongs to the common feature runtime.
This is the newest accepted target and supersedes older staged-migration
plans in this document.


## New fixed-schema source persistence directive (2026-10-11)

The owner has superseded automated v3/v4/canonical archive migration work. The agreed target is **immutable source snapshots + our own fixed canonical message/content schema + explicit upstream adapters**. Dexie is the first-choice application persistence adapter for new ChatGPT and VK records. Old standalone ChatGPT `0.8.92` records are recovered by one-time, read-only original-schema extraction; no automatic v3→v4 conversion is required. Historic v2 compatibility/migration paragraphs below document prior decisions and currently live code, not the desired future VK engine. The active VK 2.3.10 file-backed engine may only be retired after the new pipeline has passed acceptance; do not assert that replacement has already shipped. Common scoped OTLP transport follows completed Dexie runtime integration.


**Status: accepted target, not yet fully implemented.**
**Current runtime map:** [ARCHITECTURE.md](ARCHITECTURE.md).
This document owns the intended module and package boundaries. Source code
owns the implemented behavior; the presence of a target contract in this
document must never be represented as a working feature.

## Decision: DDD, FSD and Ports & Adapters together

Use three separate models for three separate concerns:

1. Domain-Driven Design / Clean Architecture defines domain contexts, business
   invariants, source-neutral application use cases, ports and external drivers.
2. Feature-Sliced Design defines ownership and dependency direction for UI,
   entities, user actions, widgets and application composition.
3. Ports & Adapters makes behavior reusable between Tampermonkey, Chromium MV3
   and a future supported target without copying domain/application logic.

There are **two independent axes**: reusable *packages across products* and
responsibility *layers within a package/product*. A package need not contain
all six FSD layers; a domain engine should not have fake pages or widgets.

### Invariants

- One behavior, one natural owner. Share only real product-neutral contracts,
  independently testable privileges or existing reusable use cases.
- Dependencies point inward and down. Domain imports no Vue, browser SDKs,
  IndexedDB implementation, VK or ChatGPT external APIs.
- Reuse may include complete use cases, widgets and application shells,
  not merely controls and styles.
- VK/ChatGPT API, auth, selectors and media mappings stay at provider edges.
- There is one Control Center. Modules contribute sections; no nested popup
  or second launcher inside an already open shell.
- Browser permissions are actual capabilities, never assumed by target name.
- No private content, cookies, tokens or media in telemetry.
- For the owner's revised 2026-10-11 first-release plan, write only VK
  Archive schema 1 while preserving metadata, originals and resume behavior.
  Existing historical schema-2 folders must be rejected without writes and
  retained independently. Any future migration requires review and backups.
- Create a package or slice only when it has responsibility and a needed
  public contract; avoid generating directories just to fill a diagram.

## Logical target monorepo map

This is a **proposed ownership map**, not an already implemented tree:

    browser-extensions/
      packages/
        platform/
          kernel/                module lifecycle, DI and registry
          capabilities/          permissions and capability contracts
          events/                generic event/subscription mechanisms
          telemetry/             sanitized events and pluggable transport
        ui/
          primitives/            shadcn-vue primitives and semantic tokens
          layouts/               generic dialogs, tabs, navigation and grids
          shells/                Control Center and movable launcher
        browser/
          adapters/              Tampermonkey/MV3 target interfaces
          storage/               generic IndexedDB/FS Access adapters
        archive/
          domain/                archive, record, media, checkpoint concepts
          application/           sync, dedup, resume and export use cases
          ports/                 source, repository, media and output contracts
          infrastructure/        IndexedDB, folder, ZIP and downloader drivers
        features/
          archive-conversation/  reusable archive/sync user action and state
          export-to-zip/         reusable packaging action
        widgets/
          archive-manager/       compositional, reusable archive UI
          module-settings/       shared settings block if reuse warrants it

      integrations/
        vk/                      VK API, authorization and data mapping
        chatgpt/                 only if a future cross-repo move is agreed

      apps/
        vk-booster/              VK composition, local slices and configuration
        chatgpt-booster/         potential future product; not moved yet
        browser-tools/           all-in-one composition

      targets/
        tampermonkey/            GM bridge and userscript metadata
        chromium-mv3/           background, content, popup and permissions

      scripts/                   change-impact builds and per-module releases
      docs/                      architectural and public contract authorities

**Actual layout today:** packages/core, packages/archive (linear selector,
acknowledgement-gated scan loop, and bounded media reader),
packages/ui, packages/widgets (Archive Manager presentation), packages/shell,
packages/adapters (including folder output), packages/storage (generic IndexedDB),
modules/*, apps/userscript and apps/extension; the imported ChatGPT compatibility
app and its source v3/v4 archive are under modules/chatgpt-booster/; the non-distributed integrations/chatgpt-booster/ tree is a development baseline only. A presentation-only Archive
Manager widget is implemented; a multi-source archive controller/repository/output,
validated ChatGPT adapter and source-independent archival domain are still targets.
Existing code and tests continue to govern behavior until reviewed migration.

### Package responsibilities

| Owner | Owns | Does not own |
| --- | --- | --- |
| platform | Registry, DI, lifecycle, neutral events/capabilities | Provider selectors, concrete browser API |
| ui | Theme, shadcn, generic navigation, one shell | VK authentication or archive algorithms |
| browser | Target drivers and generic storage implementation | VK/ChatGPT business rules |
| archive/domain | Normalized records, checkpoints and invariants | IndexedDB driver, Vue, HTTP |
| archive/application and ports | Pagination-independent sync, dedup, resume, output contracts | Provider API or ZIP library |
| archive/infrastructure | Physical storage, downloads, ZIP and integrity implementation | Feature layout and user forms |
| features | Actions, validation, pending/progress/error state | Whole product layout or entity ownership |
| widgets | Compose features, entities and primitives | Independent engine/persistence implementation |
| integrations | Provider authentication, DTO translation and source rules | Shared engine or design tokens |
| apps | Product composition root, module bindings/config | Copies of generic features/widgets |
| targets | Package, manifest, permissions, runtime bridges | Product domain logic |

A new reusable package needs a narrow public entry, version, contract and tests.
External consumers import only exported entry points, not internal src/model or
src/ui. Optional type-only secondary entries are deliberate and documented.
Splitting by technical file type alone is not justification for a package.

## FSD inside products and reusable presentation packages

Allowed import dependency direction:

    app  ->  pages  ->  widgets  ->  features  ->  entities  ->  shared

- app: DI, startup, providers and feature registry.
- pages: thin route/URL-specific view where actual routes exist.
- widgets: composition of lower-level reusable pieces.
- features: user actions and use-case UI state.
- entities: stable domain data and neutral representations.
- shared: domain-agnostic primitives and technical infrastructure.

Create only the required slice segments: ui, model, api, lib, config.
Do not cross-import same-layer sibling slices or import upward. Use public
APIs instead of deep imports into implementation internals.

DDD packages are organized by domain/application/ports/infrastructure instead
of mechanical FSD duplication. FSD is used where user interactions and views
have those responsibilities.

Example: an Archive Manager widget composes archive-conversation actions,
archive entities and UI primitives. It does not implement provider pagination,
IndexedDB transactions, SHA-256, attachment mapping or checkpoints. A VK-only
action remains within VK Booster until it has a genuine reusable contract.

## Shared archive engine contract

One archive controller can serve VK and ChatGPT through independently
implemented, source-specific provider adapters. Provider DTOs are converted
into normalized archive records by an anti-corruption layer.

**Illustrative target public API, not an existing export:**

    interface ArchiveSource {
      readonly sourceId: string
      readPage(cursor: string | null, limit: number): Promise<{
        records: ConversationRecord[]
        nextCursor: string | null
      }>
      resolveMedia(record: ConversationRecord): Promise<MediaReference[]>
    }

    interface ArchiveRepository {
      readCheckpoint(id: string): Promise<ArchiveCheckpoint | null>
      upsertRecords(id: string, records: ConversationRecord[]): Promise<void>
      commitCheckpoint(id: string, value: ArchiveCheckpoint): Promise<void>
    }

    interface ArchiveController {
      start(options: ArchiveOptions): Promise<void>
      pause(): Promise<void>
      resume(): Promise<void>
      subscribe(listener: (p: ArchiveProgress) => void): () => void
    }

    interface ArchiveOutput {
      export(id: string, format: "folder" | "zip"): Promise<void>
    }

Domain owns records and invariants; application owns exact-N semantics,
incremental/backfill/deduplication, checkpoints, retries and progress.
Integrations own VK/ChatGPT auth, source paging and expiring media links.
Storage/output adapters own physical bytes, checksums, folder and ZIP formats.
Widgets merely display and control these use cases.

### Data, storage and media

- IndexedDB can store normalized messages, metadata, indexes and checkpoints.
  It is not a mandatory unlimited cache of original binary attachments.
- File System Access is an optional sink for original media after explicit
  user folder permission; permission is never assumed.
- ZIP is an on-demand output adapter, preferably streaming/bounded when
  supported. Do not accumulate unbounded media duplicates in memory.
- Missing binary attachments can be fetched lazily with documented state
  and retry; provider URLs may require refreshing via a source adapter.
- VK archive v1 metadata.json, messages.json, index.html, media/, filenames
  and resume semantics are the first-release contract. Historical schema-2
  outputs are not migrated automatically; do not delete or overwrite them.
- A write is successful only after the storage adapter acknowledges it.

The interfaces above do not mean IndexedDB migration, ChatGPT export or
ZIP streaming are implemented today.

## Shared Application Shell and UI

Responsive presentation follows [the UI acceptance contract](shared/UI_ACCEPTANCE.md):
phone panels (620px and below) use a full-screen surface without desktop window
controls; tablet and desktop retain a floating workspace and adapt their density.

An Application Shell is a reusable composition service, **not** the FSD app
folder of a single Booster product. Each app registers modules, assigns
capabilities, supplies integration ports and contributes section views.

Use **actual ChatGPT Booster behavior and shadcn-vue components**:
Vue 3, Tailwind semantic tokens, Shadow DOM isolation, draggable/remembered
edge launcher, centered floating modal, sidebar/section navigation,
keyboard/focus support and shared settings surfaces. No custom lookalike
theme, extra blue styling, duplicate launcher or nested settings window.

Widgets are portable through props or DI ports: shared Archive Manager must
work with both VK and ChatGPT sources without importing either provider.
Product texts and provider schemas stay with their own feature/entity slice.

Reader boundary navigation, visible-record anchoring and user-driven edge
loading have one shared UI owner. Adjacent-window deduplication and retention
policy belong to the neutral archive application layer. Both providers consume
these public contracts, supplying source reads and owner/revision fences; do not
copy the ChatGPT scrolling implementation into a separate VK widget.

UI packages own presentation; archive/application/storage packages own the
behavior. Do not merge them into one giant mixed UI kit.

## Browser targets and privacy

- Tampermonkey has GM bridges and site access; it cannot change
  browser-wide proxy routing or User-Agent.
- MV3 uses isolated UI and privileged background APIs with explicit
  permissions. MAIN-world bridges require a documented need and restricted
  message passing.
- Proxy Switcher requires real privileged background routing with validated
  HTTP/HTTPS/SOCKS4/SOCKS5 support and protected credentials. UA switching
  and blocking likewise require appropriate browser capabilities.
- No hypothetical target capability counts as shipped.
- Telemetry is disabled by default; only sanitized technical module events
  may be emitted. No conversations, tokens, files, URLs with secrets,
  cookies or proxy credentials. Errors in telemetry never stop the module.

## Independent builds and versions

Packages, Booster apps and all-in-one may version independently. The build
impact graph rebuilds only affected consumers. A VK-only provider change
does not rebuild unrelated products; a shared archive/widget change rebuilds
dependents.

VK Booster's current source version is **1.1.0** with Archive schema 1.
The owner's 2026-10-17 decision removes the earlier pre-PROD version freeze:
major versions represent fundamental changes, minor versions add functionality,
and patch versions contain fixes. DEV counters remain independent and numeric
(`dev-vk-booster v1.1.N`); product version changes do not change database schema
or grant PROD publication. The old VK 2.3.x development
and stable tags remain archived as recovery evidence. A first PROD cutover
must address the fact that v1.1.0 is a semver downgrade from a historical
2.3.8 stable tag and may not update an already installed extension.
Docs-only changes never bump versions or publish bundles.

Module-scoped tags and stable independent Tampermonkey update channels remain
the release mechanism. Static checks/builds do not prove browser acceptance.

## DEV/PROD release-channel ownership

A successful reviewed source push advances only the affected DEV prerelease
packages; PROD publishing is explicitly approved after live acceptance.
Installed variants are identified by product and channel. Separate identities
must include userscript updates, extension IDs, root DOM owners, browser
storage, IndexedDB v3/v4, observer events and VK file-system output.
Existing production archives must be readable without silently merging
DEV or aggregate data into them. See [release channels](DEV_PROD_CHANNELS.md).

## Migration and acceptance gates

This document records direction; it is **not** approval for one speculative
rewrite or for deleting known-good data.

1. Inventory existing implementations, uncommitted work, archive compatibility
   and rollback identifiers; preserve the known-good state.
2. Define the smallest shared public contracts and capability boundaries,
   with tests, before changing consumers.
3. Reuse the real ChatGPT Booster shell/UI. Remove duplicated VK panels only
   after user-visible behavior is validated.
4. Isolate the VK provider and authorization from neutral archive application,
   domain and storage/output adapters.
5. Extract proven reusable archive actions and widgets. Keep source-specific
   code local where it has no genuine second consumer.
6. Test Tampermonkey and MV3, permissions, archive compatibility, recovery,
   responsive/light/dark UI and keyboard behavior.
7. Obtain independent architecture/code review before merge or release.

Archive regression gates include N=3000, incremental/backfill deduplication,
pause/resume, original filenames, voice/media integrity, offline HTML and
reopening an existing schema-1 archive, and fail-closed rejection of historical
schema-2 folders. Browser testing is a separate runtime gate.

**Forbidden shortcuts:** domain code in shared UI, widget-owned database or
archive engine, nested settings windows, separate target-specific copies of
business logic, sibling FSD deep imports, overbroad public APIs, speculative
empty scaffolding, unapproved telemetry and fake privileged capabilities.

## Authorized ChatGPT product relocation checkpoint (2026-10-10)

The user authorized consolidating ChatGPT Booster source into this monorepo.
`modules/chatgpt-booster` is a transitional provider-owned import; common
shell/feature lifecycle and gzip are extracted immediately. The eventual
shared archive application/storage and widgets need separate verified ports
and do **not** justify destructive rewriting of historical VK archives or existing
ChatGPT v3/v4 archives. Migration parity and real-browser validation remain
release blockers. See `CHATGPT_BOOSTER_MIGRATION.md`.

## Code relocation acceptance vs installed-product cutover (2026-10-10)

The user explicitly authorized **completing and integrating the monorepo code
relocation before browser acceptance**. A successful source/type/unit/build
pipeline and independent code/architecture review are required to integrate
this migration into the shared-refactor branch; manual testing of the newly
installed extension is intentionally deferred to the post-relocation phase.
This does **not** authorize a released update, destroying the previous
extension's IndexedDB profile, deleting the standalone ChatGPT Booster
repository, or claiming that installed-user data has been migrated.
The source integration originally kept ChatGPT at `release:false`.
Subsequent release-system work enables independent ChatGPT Booster 2.0.1
builds and tags, with actual public distribution still protected by manual
workflow approval and installed-product acceptance. This change does not
migrate existing user profiles or authorize automatic upgrades. Historical v3/v4 raw rows, quarantine and
canonical backup remain preserved until those later gates are satisfied.

## Reusable two-level browser interaction and collection (2026-10-12)

The shared Shell owns an edge-docked, draggable and keyboard-accessible launcher.
A click may open a compact quick menu, open the full module panel, or invoke an
explicit module-provided action. The module supplies its title, version, delivery
method, available quick actions and safely verified metrics. The Shell is not
a provider's secondary navigator; do not nest product and platform sidebars
in single-module installations. Full settings keep the product's own modular
navigation. All-in-one resolves the relevant feature for the current origin
rather than assuming its registry contains only one feature.

The shared archive application layer defines a collection lifecycle contract
(start, stop, status subscription, progress, single-flight control) and
`packages/widgets` renders one reusable collection action. Providers retain
authorization, current-chat identity, request paging, source normalization,
source-specific cancellation, and persistence semantics. Never assume VK API
cursors, ChatGPT History Loader page state or network completeness are equal.
Provider metrics in the quick menu refer only to records known to the
verified source and do not imply full remote history.
