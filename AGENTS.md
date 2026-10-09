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

## Package rules
- `packages/core`: host-neutral contracts and state; no `window`, `chrome`, VK or ChatGPT selectors.
- `packages/archive`: source-neutral linear page selection, paged-scan application ports, and bounded binary verification; no provider credentials, DOM, persistence implementation, or ChatGPT branch assumptions.
- `packages/ui`: reusable shadcn-vue primitives with no provider knowledge.
- `packages/widgets`: provider-neutral Archive Manager, conversation navigator, transcript, progress and dock geometry; emit actions/receive props, never query provider data or own persistence. Widgets own their portable styles; target-specific CSS uses existing Shadow DOM style entries.
- `packages/shell`: common draggable launcher, center modal, Shadow DOM and module slots.
- `packages/adapters`: permission-checked user-script/Chrome bridges and source-neutral File System Access output.
- packages/storage: provider-neutral IndexedDB request/batch/transaction utilities and a journaled, generation-staged migration coordinator with explicit lock, backup, validation and atomic staging/activation ports. It does not own physical schemas, source versions, identity decisions, backups, migration plans or permissions; migrations must not run until those adapters are verified.
- `modules/<id>`: host-specific code, capabilities and a `module.json` contract.
- `integrations/chatgpt-booster`: isolated clean ChatGPT application baseline; read its AGENTS.md and canonical archive authority before changes; preserve v3/v4 databases and do not import uncommitted source changes blindly.
- `apps/userscript` / `apps/extension`: delivery adapters only, no copied feature code.
- Proxy routing must use privileged extension background APIs after permission; a userscript cannot set browser proxy settings.
- Never log, commit or export browser cookies, access tokens or private conversation data. Testing fixtures must be synthetic; real personal content belongs only in ignored local files.

## TypeScript and lint gates
- First-party Browser Extensions runtime, adapters and VK export are TypeScript-only; do not introduce unchecked JavaScript into product code or tests.
- Keep TypeScript strict and VK plus storage regression mocks checked under `tsconfig.vk-tests.json`.
- Run `bun run check` (strict typechecks, Biome with warnings as failures, tests, catalog validation) and `bun run build` before review. Root Biome covers TypeScript and Vue SFCs; Vue template-referenced imports/variables are verified by `vue-tsc` instead of Biome unused checks, which cannot see template bindings. The independently maintained `integrations/chatgpt-booster` workspace has its own TS/Biome checks.

## Release rules
- Independent semver in each releasable `module.json`; use `module-name/vX.Y.Z` tags.
- If a shared package change affects a distributed module, bump that module's version intentionally to trigger a release.
- Check `bun run check`, `bun run build` and `bun scripts/validate.ts --built` before publishing.
- The CI `zoomies-linux-x64` runner is for trusted branch/main code; fork PRs must not run there.

## Known migration debt
VK Booster is a real, tested v2 browser exporter wrapped behind typed `Feature` lifecycle. Its VK API, media mapping and offline viewer have separate internal owners. Linear page selection and the acknowledgement-gated scan loop use browser-archive; folder writes use browser-adapters, and the archive form uses browser-widgets. VK still owns v2 checkpoint format, media work, provider authentication and storage. The complete branch-aware, multi-source archive controller remains unimplemented. Preserve 3000-message, offline HTML, attachment and resumption behavior; do not fork the engine between targets.
