# Browser Extensions repository map

## Start
1. Read `README.md` and `docs/ARCHITECTURE.md` before changing package boundaries.
2. Respect the universal agent workflow (`ai-agent-workflow`) for engineering, Git and CI changes.
3. Work on a non-protected feature/fix branch. Open a PR; do not directly mutate `main` or merge your own PR.

## Package rules
- `packages/core`: host-neutral contracts and state; no `window`, `chrome`, VK or ChatGPT selectors.
- `packages/ui`: reusable visual components mounted through Shadow DOM; never assume host CSS.
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
