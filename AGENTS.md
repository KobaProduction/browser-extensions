# Browser Extensions repository map

## Start (mandatory before substantive work)

1. Read `README.md` for repository navigation and product scope.
2. **MUST read `docs/TARGET_ARCHITECTURE.md` in full** before any
   substantive implementation, UI, refactoring, package-boundary, target,
   permission or release change. It is the mandatory approved target for
   DDD + FSD + Ports & Adapters, reusable features/widgets and shared
   application shells. A previous chat summary is not a substitute.
3. Read `docs/ARCHITECTURE.md` to distinguish currently implemented code
   from the target. Proposed packages/interfaces are not shipped features.
4. Load task-specific `ai-agent-workflow` skills (FSD/frontend for UI
   ownership, DDD/software for domain and ports, Git for commits, etc.).
5. Work on one non-protected local branch for the complete coherent change.
   Do not open incremental PRs for documentation, package splits or fixes;
   validate locally first, then publish one consolidated PR for independent
   review. Never directly mutate `main` or merge your own PR.

## Issue and PR target ownership

All new issues MUST use `.github/ISSUE_TEMPLATE/` forms with required
`Target extension`; do not implement unowned issues. The exact target
determines the primary module/package owner and is synchronized to a
`target:*` label by `.github/workflows/issue-targets.yml`. Imported/API
issues must supply the same target field explicitly; `docs/ISSUE_ROUTING.md`
defines allowed targets, affected consumers and legacy ChatGPT issue/PR
mapping. Every new PR must list primary target, affected products and source
issues. Never treat historical standalone PRs as live monorepo merge targets.

## Package rules
- `packages/core`: host-neutral contracts and state; no `window`, `chrome`, VK or ChatGPT selectors.
- `packages/archive`: source-neutral linear page selection, paged-scan application ports, and bounded binary verification; no provider credentials, DOM, persistence implementation, or ChatGPT branch assumptions.
- `packages/ui`: reusable shadcn-vue primitives with no provider knowledge.
- `packages/widgets`: provider-neutral Archive Manager, conversation navigator, transcript, progress and dock geometry; emit actions/receive props, never query provider data or own persistence. Widgets own their portable styles; target-specific CSS uses existing Shadow DOM style entries.
- `packages/shell`: common draggable launcher, center modal, Shadow DOM and module slots.
- `packages/adapters`: permission-checked user-script/Chrome bridges and source-neutral File System Access output.
- packages/storage: provider-neutral IndexedDB request/batch/transaction utilities, source-stamped async read guards and a journaled generation-staged migration coordinator with explicit lock, backup, validation and atomic staging/activation ports. Durable stamps must be backed by provider mutation invariants; the package does not own physical schemas, source versions, identity decisions, backups, migration plans or permissions.
- `modules/<id>`: host-specific code, capabilities and a `module.json` contract.
- `modules/chatgpt-booster`: active ChatGPT provider, installed target composition and canonical archive; preserve its v3/v4 storage identities and owner proofs. `integrations/chatgpt-booster` is a non-distributed historical source/refactor baseline imported by the advanced VK stream; inspect differences before consolidating and do not ship it as a second Booster.
- `apps/userscript` / `apps/extension`: delivery adapters only, no copied feature code.
- Proxy routing must use privileged extension background APIs after permission; a userscript cannot set browser proxy settings.
- Never log, commit or export browser cookies, access tokens or private conversation data. Testing fixtures must be synthetic; real personal content belongs only in ignored local files.

## TypeScript and lint gates
- First-party Browser Extensions runtime, adapters and VK export are TypeScript-only; do not introduce unchecked JavaScript into product code or tests.
- Keep TypeScript strict and VK plus storage regression mocks checked under `tsconfig.vk-tests.json`.
- Run `bun run check` (strict typechecks, Biome with warnings as failures, tests, catalog validation) and `bun run build` before review. Root Biome covers TypeScript and Vue SFCs; Vue template-referenced imports/variables are verified by `vue-tsc` instead of Biome unused checks, which cannot see template bindings. The currently shipped ChatGPT module is validated through root TypeScript, Vue and test gates; the non-distributed integration baseline is deliberately excluded from root compilation until its additional refactors are reconciled.

## Release rules
- **VK Booster base version is frozen at exactly 3.0.0** throughout ongoing development. Do not bump it for VK-only changes or shared runtime changes. Keep its `module.json` and `package.json` in sync at 3.0.0. An explicit new owner decision is required to change this. DEV `3.0.0-dev.<run>` changes are build identifiers, not product-version increments.
- Independent semver in other releasable `module.json` manifests; use `module-name/vX.Y.Z` tags.
- If a shared package change affects a distributed module, bump affected versions **except frozen VK 3.0.0**. VK DEV artifacts still update using their prerelease build counters.
- Check `bun run check`, `bun run build` and `bun scripts/validate.ts --built` before publishing.
- The CI `zoomies-linux-x64` runner is for trusted branch/main code; fork PRs must not run there.

## VK native archive contract (replaces the prototype)

VK Booster 3 owns a new per-product/channel IndexedDB archive. There is **no
VK v2 backwards-compatibility, migration, file checkpoint or repeat-"recent N"
contract**. No VK users depend on the prototype. Remove obsolete VK v2 source,
files, tests and UI rather than retaining a parallel exporter.

The VK API adapter captures *complete* conversation messages without downloading
media. Binary attachments are separate on-demand exports with a download
receipt/SHA-256 ledger. Exports are sanitized JSON + attachments; backup/restore
is scoped and transactional. The provider-neutral paging fixture and UI shell
may be shared, but ChatGPT v3/v4 owner proofs and existing data must not change.
Validate synthetic 3000+ message capture, full completion, export, file audits,
backup/restore, independent DEV/PROD scope, and the local archive lab.
