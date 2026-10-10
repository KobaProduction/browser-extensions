# Target architecture for Koba Browser Extensions

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
- Maintain the v2 archive format, metadata, original media and resume behavior
  until an explicitly reviewed migration is accepted.
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
- VK archive v2 metadata.json, messages.json, index.html, media/, filenames
  and resume semantics are backwards-compatibility requirements.
  Breaking them needs a separately reviewed migration and regression tests.
- A write is successful only after the storage adapter acknowledges it.

The interfaces above do not mean IndexedDB migration, ChatGPT export or
ZIP streaming are implemented today.

## Shared Application Shell and UI

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

VK Booster stays on **major version 2**. Compatible fixes and refactors
use patch 2.x.y, backwards-compatible product functionality uses the next
2.x minor. Version 3 is reserved for intentional incompatible public API or
storage contracts, not a UI redesign or directory shuffle. Docs-only changes
never bump versions or publish bundles.

Module-scoped tags and stable independent Tampermonkey update channels remain
the release mechanism. Static checks/builds do not prove browser acceptance.

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
reopening an existing v2 archive. Browser testing is a separate runtime gate.

**Forbidden shortcuts:** domain code in shared UI, widget-owned database or
archive engine, nested settings windows, separate target-specific copies of
business logic, sibling FSD deep imports, overbroad public APIs, speculative
empty scaffolding, unapproved telemetry and fake privileged capabilities.

## Authorized ChatGPT product relocation checkpoint (2026-10-10)

The user authorized consolidating ChatGPT Booster source into this monorepo.
`modules/chatgpt-booster` is a transitional provider-owned import; common
shell/feature lifecycle and gzip are extracted immediately. The eventual
shared archive application/storage and widgets need separate verified ports
and do **not** justify rewriting VK v2 semantics or destroying existing
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
`modules/chatgpt-booster/module.json` remains `release:false` until the
separately verified product cutover. Historical v3/v4 raw rows, quarantine and
canonical backup remain preserved until those later gates are satisfied.
