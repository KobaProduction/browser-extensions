# Combined VK and ChatGPT source integration

Date: 2026-10-10. Scope: source reconciliation and source-level acceptance;
**not** installed-product, profile-data or public-release acceptance.

## Authoritative input and merge topology

- Integration branch: `integration/vk-chatgpt-platform`.
- ChatGPT migration: `feat/chatgpt-booster-monorepo-migration@fa42dcf` (the
  source-preserving portable v3/v4 backup, canonical migration and module
  composition stream; former PR #4).
- Advanced VK: `agent/vk-booster-isolated@3c4ef69` imported from the clean
  persistent isolated workspace. Its original working directory/branch was
  not modified. The branch is based on the same approved shared-platform
  commit as ChatGPT; no divergent VK source was discarded.
- The combined source inherits the platform, architectural documentation,
  and shared-shell ancestors of both streams. The integrated PR supersedes
  the four original stacked platform/docs/shared-shell/ChatGPT PRs after it
  has been independently approved and merged.

## Reconciliation decisions

| Boundary | Integrated authority | Preserved behavior |
| --- | --- | --- |
| VK provider | Advanced v2.3.7 strict TypeScript source | Original v2 folder/metadata, N=3000, known/new/backfill, voice/media names and digest, offline HTML, pause/resume, SPA navigation and in-flight write fences |
| VK UI | Advanced Archive Manager and bounded transcript widgets | No second launcher; keyboard-accessible shell; VK-standard modal |
| ChatGPT executable | `modules/chatgpt-booster` v0.8.99 (experimental) | Native source fingerprints, owner-scoped v3/v4 sources, canonical migration, source/backup import and rollback, source-native export |
| Shared source-neutral archive | `packages/archive` from both streams | VK `selectArchivePage` delegates to the same record-identity fold used in ChatGPT v4; advanced acknowledged scan/media ports and portable GZIP/structured source codec remain separate responsibilities |
| Shared storage and widgets | Advanced `packages/storage`, `packages/widgets` and browser adapters | No provider auth or IndexedDB physical schema ownership in a neutral component |
| Common UI | Advanced one-shell, focus and keyboard handling + ChatGPT presentation contract | Wide ChatGPT Reader, standard VK dialog; navigation/close events forwarded correctly |
| Delivery adapters | One userscript/MV3 build matrix | VK 2.3.7, experimental ChatGPT 0.8.99, all-in-one 0.4.7; ChatGPT stays `release:false` and outside all-in-one |

### Imported ChatGPT refactor baseline

The advanced VK branch also contained a clean, self-contained development
snapshot in `integrations/chatgpt-booster/`. It differs structurally from the
newer executable ChatGPT module, with additional v4 helper modules and Vue
feature slices. The snapshot is retained to avoid discarding that independent
work; it is **not** a second registered module, not an additional bundled
extension, and not a package published from the root workspace. Do not
silently replace newer canonical source/backup logic with the older snapshot.
Further source-level consolidation of those helper modules requires explicit
semantic parity checks; the existing executable module remains authoritative
until then. No code merge implies account/profile data is moved automatically.

### Source merge vs release

The user authorized merging the code *before* testing installed browser
extensions. This integration does not authorize deleting the old ChatGPT
repository, wiping IndexedDB profiles, changing the ChatGPT extension ID,
activating automatic ChatGPT updates, or publishing new VK releases.
`release.yml` requires explicit `workflow_dispatch` approval on `main` after
installation acceptance. Existing independent semver and update channel logic
remain available at that later boundary.

## Evidence and remaining gates

Acceptance is the exact integration commit's full TypeScript/Vue checks,
Biome, tests, VK/ChatGPT/all-in-one builds and generated output validation,
then independent source/architecture review. Synthetic source/browser tests
are separate evidence from live-account acceptance.

Still deferred by user authorization: installed Tampermonkey/Chromium product
checks, real-account large archive/source backup parity, responsive UI in
installed targets, release/store signing and user-profile/extension-ID cutover.
Never state those gates passed solely from successful code integration.
