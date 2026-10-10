> **Standalone retirement:** All future ChatGPT Booster development, issues and builds are owned by this monorepo. The old standalone GitHub repository is a historical source only; do not publish or track work there. The canonical archive product acceptance task is [issue #11](https://github.com/KobaProduction/browser-extensions/issues/11). Existing browser profiles are not implicitly migrated.

> **Release-system update (2026-10-10):** this document includes historical
> source-relocation checkpoints. The executable ChatGPT Booster is now
> version **2.0.5** with `release:true` and independent userscript/MV3
> artifacts. All-in-one **0.5.4** includes both ChatGPT and VK. Real-user
> installation/backup cutover and public release remain gated separately.
> See [independent releases](INDEPENDENT_RELEASES.md) for current authority.

# ChatGPT Booster migration to Browser Extensions

**Scope:** source-preserving initial integration, branch `feat/chatgpt-booster-monorepo-migration`, based on `refactor/extract-shared-booster-platform@acfe36f`. The old `KobaProduction/chatgpt-booster` repository has **not** been deleted. No browser data is migrated merely by installing a new build.

## Source and preservation

- Imported from the existing persistent `chatgpt-booster` workspace, branch `feature/archive-canonical-migrations@c7aaeac`, **including** its uncommitted archive backup, restore, SHA-256 audit and gzip changes. The uncommitted source delta is retained in the local ignored migration workbench; the actual source files were imported into the new repository.
- The original browser storage names and account scopes remain unchanged (`chatgpt-booster-archive` v3 and `chatgpt-booster-archive-v4` v4/canonical). This is code relocation, **not** authorization to clear, reset or rewrite real Chrome/IndexedDB profiles.
- All original source packages (`core`, `chatgpt`, `features`, `observer`, `telemetry`, `ui`) live for now in `modules/chatgpt-booster/packages/`; original target-specific settings, telemetry, background, popup and observer implementations remain under the same module. New `apps/` entrypoints perform delivery-specific composition. This keeps project-specific native ChatGPT transport, lifecycle and owner authorization out of the shared package layer.
- The original `tests/` corpus and browser harness were transferred into `modules/chatgpt-booster/tests`. These preserve source/API/timing/metadata/recovery regression evidence. Do not equate passing tests with live ChatGPT acceptance.

## Implemented mapping (provider vs shared ownership)

| Capability | Monorepo owner | Current state |
|---|---|---|
| Module registry, capability checks, enable/disable | `packages/core` | Shared platform used by VK and ChatGPT |
| Shadow DOM, one launcher and Control Center | `packages/shell` | Shared; ChatGPT's legacy `OverlayModule` is disabled by hosted composition |
| ChatGPT saved Reader, history capture, canonical migration, owner reconciliation | `modules/chatgpt-booster/packages/features` | Ported; original storage namespace preserved |
| ChatGPT reasoning, tool UI, archive export, metadata, migration diagnostics | `modules/chatgpt-booster/packages/ui` | Ported; mounted as ChatGPT's module view inside the shared shell |
| Generic gzip output, source-neutral archive ports/checkpoint vocabulary | `packages/archive` | New extracted shared package; ChatGPT uses its gzip implementation |
| Native ChatGPT history signatures and transport observation | `modules/chatgpt-booster/packages/observer` | Provider-local, not shared with VK |
| Chrome MAIN-world observer, runtime background/popup, restricted ChatGPT manifest | `apps/extension`, `modules/chatgpt-booster/packages/extension` | New module-specific experimental Chromium bundle |
| Tampermonkey grants, page-world observer and saved local settings | `apps/userscript`, `modules/chatgpt-booster/packages/userscript` | New experimental ChatGPT userscript bundle |
| VK exporter v2: 3k messages, media, filename, offline HTML/resumption | `modules/vk-booster` | **Unmodified**; existing v2 compatibility stays authoritative |

## Build, permission and release boundaries

- `bun run build:chatgpt` produces `dist/chatgpt-booster/chatgpt-booster.user.js` and `dist/chatgpt-booster/chatgpt-booster-extension.zip`; `bun scripts/build.ts --module chatgpt-booster --target userscript|extension` builds a single target.
- `modules/chatgpt-booster/module.json` has `release:false`; the default `bun run build` and the independent module release plan still publish only accepted VK/all-in-one products. No automatic update or installer migration occurs.
- The ChatGPT MV3 manifest includes a separate MAIN-world observer and isolated content script, ChatGPT host scope, storage/background functionality, and no proxy privilege. Userscript and extension must never be enabled simultaneously with the old Booster on the same page until a duplicate-observer/live-ownership acceptance pass.
- The original optional external telemetry endpoint may require separately reviewed host permissions in MV3. It must not be silently broadened to all hosts or treated as working without browser acceptance.
- A new code repository **does not** migrate installed Tampermonkey scripts, extension IDs, Chrome storage partitions, or signed store identity. Domain records and user permissions must not be claimed to travel automatically with an extension-ID change.

## Remaining acceptance gates (not completed by source relocation)

1. Full installed Chrome/Tampermonkey acceptance against current ChatGPT pages, memory-first capture, history scrolling, model/tool metadata, event routing and no duplicate shell or observer.
2. Existing v3/v4 IndexedDB migration and export parity on a **safe backup** of a real user profile, including the known two unimported chats, owner ambiguity and very large tool-result exports.
3. Independent backup/restore, failure recovery, cross-account switch, rollback and size/performance validation for canonical generations. `packages/archive` is only the first portable output/contract extraction; the VK v2 archive engine and ChatGPT canonical engine are **not yet** one common persistence implementation.
4. UI visual verification for Archive Browser, Export Wizard, shared shell and responsive/dark styles in both delivery targets.
5. Independent reviewer acceptance of source equivalence, capability permissions, build artifact contents and ownership/dependency direction before merging.

Do **not** delete the old repository or old browser databases until a separately accepted migration cutover with independently restorable user data.

## Source documentation preservation

The original ChatGPT Booster architecture, source-signature research, runtime
contracts, archive target architecture, DOM adapters, product operations and
historical acceptance checkpoints are retained verbatim under
`modules/chatgpt-booster/docs/`. These documents remain **product-local**
contracts, subordinate to this monorepo's approved architecture for ownership
and package boundaries. Any dated old validation is historical evidence and
not acceptance of the new binary or new extension identity.

The canonical backup import UI is available on a newly installed ChatGPT
module with no active canonical generation: it requires a manually selected
GZIP file and an account-scoped explicit confirmation, validates every
source fingerprint and the backup footer, stages all data in a new generation,
and only then promotes it. It preserves existing generations and does not
claim to import unbound v3-only records or binary attachment bytes.

## Source-equivalence inventory (verified on 2026-10-10)

Relative to the prior `chatgpt-booster/packages/` directory, excluding
intentionally removed standalone Vite/target entrypoints, generated
`dist`/sourcemaps and disposable workbench files:

- **112 files byte-identical**;
- **15 files explicitly adapted** for monorepo configuration, shared output,
  archive restoration, observer type compatibility and target composition;
- **0 original source package files missing** in that scoped comparison.
- The **26 files in the original `tests/` tree** are byte-identical in
  `modules/chatgpt-booster/tests/` (includes 18 `*.test.ts` unit sources and
  the browser harness); no copied test bodies were rewritten to inflate coverage.

These are source-file inventory facts only: they do not prove correct bundle
content, runtime authorization, installed storage continuity or usable UI.
The original source package `userscript` and `extension` delivery entrypoints
are replaced by monorepo `apps/*` entries; Chrome/Tampermonkey identity still
needs separate cutover acceptance. Browser-only endpoint compatibility and
backup import integrity remain independent gates.

## Shared archive extraction / product-hosted fixes

- `packages/archive` is now exercised by both provider engines for stable record
  identity, collision-free composite keys and SHA-256 checksums. VK v2 uses it
  for its existing message index and original media digests; ChatGPT uses it
  for canonical account/message/snapshot identity and native source fingerprints.
  Neither source mapping nor VK disk format changed.
- Shared shell events and panel sizing are defined by generic platform
  contracts, not hard-coded per-provider checks in the shell. ChatGPT's Reader
  close action exits the one shared shell. Embedded settings omit the legacy
  duplicate window/header.
- Explicit account-verified backup restore checks authorization throughout
  staging and before activation; completed imports can switch back to the
  previous generation only if that generation and the new one still match
  verified counts and no newer reconciliation invalidates the rollback.
- All these are *source and synthetic browser* acceptance layers; the installed
  client/UI/extension identity still requires real-user browser inspection.

## Integrated source and browser verification (2026-10-10)

- Local complete `bun run check` succeeded after shared archive extraction:
  **228 passing tests, 0 failing** across 29 files (before the last shell
  navigation regression test). A subsequent local check succeeded with
  **229 passing tests, 0 failures**, including VK v2 3,000-message,
  incremental, pause/resume, original media name/hash, HTML and v1 refusal.
- Isolated real Chromium IndexedDB acceptance from **monorepo code** (never
  user data): v3+v4 upgrade, explicit per-chat owner selection, unknown-time
  Reader record, original model/tool metadata, JSON.gz lossless export,
  per-source SHA-256 parity, altered-source detection and reconciliation,
  gzip backup/restore in a new generation, truncated file rejection,
  fresh-profile import without existing canonical manifest, transactional
  rollback to previous active generation and simulated mid-import account
  revocation. Original v3 source rows remain untouched.
- Browser tests ran against isolated synthetic origins and do not prove
  installed ChatGPT extension identity, all server branches, user files or
  real-account acceptance. Old archive databases and old repository remain
  preserved.
- Runtime build version is now resolved from the module manifest at bundle
  creation rather than a stale fallback. The monorepo-wide build includes an
  experimental ChatGPT artifact, but does not activate an update channel or
  publish it without release acceptance.

## Telemetry compatibility and permissions

The original ChatGPT userscript's `GM_xmlhttpRequest` transport supports a
user-configured HTTPS OTLP endpoint. Preserve its explicit Tampermonkey
`@connect *` grant and user opt-in policy: removing that grant silently
breaks existing optional telemetry. It is not an automatic transmission and
content/credentials remain excluded from events. Chromium requests only ChatGPT host access on installation. It declares a
separate *optional* HTTPS host capability for the configured OTLP origin, which
is never auto-granted. A user can grant the endpoint from the extension popup
when explicitly testing telemetry. The content script only reads the resulting
permission state and never attempts privileged permission requests. Automatic
telemetry remains off by default. Core archive functionality
must remain unaffected by an unavailable telemetry endpoint.

## Interrupted portable import recovery

A restart after process termination may leave an imported generation fenced as
`transforming` without running the normal error handler. Explicit retry of a
canonical backup, under the exclusive migration lock, now recognizes its own
`backupRestoreStartedAt` marker, verifies the old active generation if any,
and restores a readable previous manifest or the `failed_recoverable` state.
The interrupted staged rows are retained for forensic inspection and never
silently activated. The retry stages into a fresh generation and promotes it
only after the same owner/fingerprint/footer checks as an ordinary import.

## Shared archive page application (2026-10-10)

`packages/archive/src/page-fold.ts` now owns a provider-neutral, pure page
reconciliation use case consumed by **both** products. VK binds numeric IDs,
date-window rules and the exact-N `recent`/`incremental`/`backfill` semantics
through a provider-specific callback; it persists its unchanged v2 checkpoints
and media outputs **after** folding. ChatGPT binds native message IDs and
canonical source equality through strict `snapshot` mode, rejecting conflicting
source duplicates rather than arbitrarily selecting one. Provider auth,
network requests, native payloads and IndexedDB remain outside the shared
package. Six new tests cover count/offset/stop/duplicate invariants, and
existing 3,000-message VK and ChatGPT source contract regression tests still
execute as before.

This is an actual dual-consumer archive application operation. It is **not** a
claim that VK's File System Access persistence and ChatGPT's IndexedDB storage
are interchangeable or that the products have identical completeness proofs.

## Shared conversation export progress (2026-10-10)

`packages/ui` now exports one `ArchiveProgress` widget used by both
`modules/vk-booster/src/features/chat-export/ui/ArchivePanel.vue` and
`modules/chatgpt-booster/packages/ui/src/ArchiveExportDialog.vue`.
Providers supply localized phase, source-specific counters and errors; the
shared component owns accessible live progress and bounded percentage.
There is no provider check, source DTO import or storage operation in the UI.
All 232 applicable monorepo tests pass after this refactor.

## Portable original-source transfer for retiring the old installation

The Archive Maintenance tools now include a **separate** native v3/v4 source
backup and import. It exports the original local JSON-compatible records from
all available v3 and v4 source tables, including chats with unverified owners.
The file stores original account/owner metadata unchanged and does **not**
implicitly authorize ownership or merge unrelated accounts. Source transfer v2
preserves structured IndexedDB values including Blob, File, ArrayBuffer,
typed views, Date, Map, Set, explicit undefined and nonfinite numbers. The
native *source database* is preserved; canonical generations and attachment
files stored outside IndexedDB remain separate export workflows. Legacy v1
JSON-only backups remain importable.

The source format uses indexed bounded reads, shared streaming GZIP output and
a complete SHA-256/footer/count verification pass before creating a missing v3
source database or committing any records. Restore then runs a read-only
conflict preflight on *all* existing rows before inserting only absent rows,
rechecking conflicts atomically per row. A transfer interruption can be
retried idempotently. Unsupported cyclic, shared-reference identity graphs or arbitrary class instances cause an explicit error
rather than silently degrading the backup; common structured clone types are
round-tripped with collision-free type tags. This transfer is
not an authenticated/signed source; users should only import backups they
created or trust explicitly.

Synthetic isolated Chromium acceptance (new origin): truncated gzip rejected
before v3 source database creation; all 4 v3/v4 fixture rows restored into a
clean installation; repeated import inserted no duplicates; an existing-row
conflict was rejected before even an unrelated earlier row could be committed;
an owner-unverified v3 chat remained quarantined until selected manually;
canonical SHA-256 source parity then passed without touching native originals.
The portable canonical backup remains a separate file and owner gate.

## Current acceptance boundary: merge code first, test installed product second

The user has explicitly moved manual browser acceptance **after** merging the
source relocation into the monorepo. Code acceptance for the existing PR
requires current clean workspace, TypeScript/Vue static checks, the full test
suite, built VK/ChatGPT/all-in-one outputs and module manifest validation,
plus independent code review. Browser UI and real-account history tests are
tracked for the subsequent installed-product cutover rather than blocking the
code-merge stage. The old repository and user profile sources must be retained
until that later cutover, and the experimental ChatGPT module remains excluded
from automated independent releases (`release:false`).
