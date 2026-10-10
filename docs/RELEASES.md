# Zoomies CI and selective releases

`main` and trusted same-repository PRs run `zoomies-linux-x64` (matching ChatGPT Booster). Fork and Dependabot PRs run on GitHub's `ubuntu-latest` runner. `bun run check` verifies types/tests/contracts. The build impact graph builds only affected distributables:

| Changed path | Impact |
| --- | --- |
| `modules/vk-booster/**` | VK Booster + all-in-one |
| `modules/proxy-switcher/**` | Proxy-only checks; no release yet |
| `packages/**`, `scripts/**`, dependency lockfile | All consumers |
| `docs/**` | No extension rebuild |

Each published module has its own `module.json` semver and GitHub Release tag, e.g. `vk-booster/v2.2.0` or `all-in-one/v0.1.0`. After a successful main-branch validation and an **explicitly approved manual workflow dispatch** on `main`, `release.yml`:

1. Requires explicit approval and a manual workflow run on validated `main`.
2. Lists releases absent at the desired module version.
3. Compares source/dependency scopes with the latest module tag; if unchanged, **skips** publishing.
4. Builds and verifies only each eligible distributable, and creates a GitHub Release containing `*.user.js` and `*-extension.zip`.

**A version bump is necessary for each intentional module release.** If a shared package changed but a consumer version was not bumped, its existing tag blocks duplicate publication. The combiner has its own version; it must be bumped when its bundled dependencies change. No release occurs for `release:false` modules. Scoped tag names are case-sensitive and independently versioned.

This workflow does **not** publish Chrome Web Store packages, automatic Tampermonkey update channels or core npm packages yet; those require signing, registry credentials or a stable per-module update URL. It also does not merge PRs automatically. Release workflows may only be exercised after installed-product acceptance and explicit `approve_release=true` dispatch on `main`; simply merging an integration PR cannot publish new VK binaries.

## Stable Tampermonkey channels

The distribution branch has a module-specific path for each installable
userscript: userscripts/vk-booster.user.js, userscripts/chatgpt-booster.user.js
and userscripts/all-in-one.user.js.

Do NOT use releases/latest for userscript auto-updates: that URL is global to
the repository, so a new release of a different module could hijack updates.
Instead each bundle embeds module-specific update/download URLs targeting
the distribution branch. scripts/publish-channel.sh copies the selected
verified userscript into this branch and pushes only on a byte change.

A manually approved release workflow on validated `main` creates immutable
module-scoped GitHub Releases, and then advances that module's stable channel.
A version bump is required; already-published tags are not republished.

## Integration freeze / explicit approval

The combined VK v2 and ChatGPT source relocation was
**code-only**. The old `workflow_run` automatic main-branch publication was
replaced with explicit `workflow_dispatch` approval on `main` to avoid silently
updating installed VK users before post-relocation browser acceptance. The
independent module release plan/tags and distribution channel mechanism remain
unchanged; accepted versions may be published by manually starting the release
workflow with `approve_release=true`. ChatGPT 2.0.1 is now `release:true` for independently scoped builds; only a manually approved workflow may publish it after installed-product acceptance.

## Version 2 release channels (2026-10-10)

- VK Booster: `2.3.8` — changes in VK increment VK and all-in-one only.
- ChatGPT Booster: `2.0.1` — changes in ChatGPT increment ChatGPT and all-in-one only.
- All-in-one: `0.5.0` — aggregates both providers with independent feature
  lifecycles, Tampermonkey and MV3 targets.
- Shared `packages/` implementation changes affect all consumers. Documentation
  and CI-only changes do not bump product semver.

The release scope defaults to `none` and requires explicit selection;
manual approval alone cannot accidentally publish unrelated pending products.
The `scripts/version-policy.ts` gate enforces versions on PRs and
`scripts/bump-versions.ts` can generate explicit patch changes for specified
implementation paths. `release.yml` offers per-product `release_scope`:
`chatgpt-booster` publishes ChatGPT and its aggregator, `vk-booster` publishes
VK and its aggregator, `all-in-one` publishes only the aggregator and
`shared`/`all` covers all products. No release occurs without both
`approve_release=true` and selection on the main branch.
