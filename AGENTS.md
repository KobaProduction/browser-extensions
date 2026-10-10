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
5. Work on a non-protected working branch. Use PR + independent review
   for architecture changes; never directly mutate `main` or merge your
   own PR.

## Package rules
- `packages/core`: host-neutral contracts and state; no `window`, `chrome`, VK or ChatGPT selectors.
- `packages/ui`: reusable shadcn-vue primitives with no provider knowledge.
- `packages/shell`: common draggable launcher, center modal, Shadow DOM and module slots.
- `packages/adapters`: permission-checked user-script and Chrome bridges.
- `modules/<id>`: host-specific code, capabilities and a `module.json` contract.
- `apps/userscript` / `apps/extension`: delivery adapters only, no copied feature code.
- Proxy routing must use privileged extension background APIs after permission; a userscript cannot set browser proxy settings.
- Never log, commit or export browser cookies, access tokens or private conversation data. Testing fixtures must be synthetic; real personal content belongs only in ignored local files.

## Release rules
- Independent semver in each releasable `module.json`; use `module-name/vX.Y.Z` tags.
- If a shared package change affects a distributed module, bump that module's version intentionally to trigger a release.
- Check `bun run check`, `bun run build` and `bun scripts/validate.ts --built` before publishing.
- The CI `zoomies-linux-x64` runner is for trusted branch/main code; fork PRs must not run there.

## Known migration debt
VK Booster is a real, tested v2 browser exporter wrapped behind typed `Feature` lifecycle. Its internal engine still has v2's legacy single-file implementation. Refactor the engine by adapter boundaries only after preserving its 3000-message, offline HTML, attachment and resumption tests; do not fork it between targets.

## ChatGPT Booster transitional module

For ChatGPT archive/export work, also read
`docs/CHATGPT_BOOSTER_MIGRATION.md` and its source contracts under
`modules/chatgpt-booster/packages/core/src` and `features/src`. Use one
shared `packages/shell` launcher; never activate the original `OverlayModule`
when running inside this monorepo. Preserve the old v3/v4 IndexedDB keys,
source snapshots, verification labels and account boundaries. ChatGPT Booster
is `release:false`; do not introduce it into the all-in-one distribution
or enable automated updates until the migration acceptance gates pass.
