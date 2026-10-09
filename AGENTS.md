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
- `packages/archive`: source-neutral linear page selection and bounded binary response decoding/checksums; no provider credentials, DOM, persistence, or ChatGPT branch assumptions.
- `packages/ui`: reusable shadcn-vue primitives with no provider knowledge.
- `packages/widgets`: source-neutral archive-management presentation; emit actions, never query provider data or own persistence.
- `packages/shell`: common draggable launcher, center modal, Shadow DOM and module slots.
- `packages/adapters`: permission-checked user-script/Chrome bridges and source-neutral File System Access output.
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
VK Booster is a real, tested v2 browser exporter wrapped behind typed `Feature` lifecycle. Its VK API, media mapping and offline viewer have separate internal owners. Linear page selection uses browser-archive, folder writes browser-adapters, and the archive form browser-widgets. Sync/checkpoint orchestration remains VK-local until a real second consumer and an accepted common contract exist. Preserve 3000-message, offline HTML, attachment and resumption behavior; do not fork the engine between targets.
