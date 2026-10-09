# Zoomies CI and selective releases

`main` and trusted same-repository PRs run `zoomies-linux-x64` (matching ChatGPT Booster). Fork and Dependabot PRs run on GitHub's `ubuntu-latest` runner. `bun run check` verifies types/tests/contracts. The build impact graph builds only affected distributables:

| Changed path | Impact |
| --- | --- |
| `modules/vk-booster/**` | VK Booster + all-in-one |
| `modules/proxy-switcher/**` | Proxy-only checks; no release yet |
| `packages/**`, `scripts/**`, dependency lockfile | All consumers |
| `docs/**` | No extension rebuild |

Each published module has its own `module.json` semver and GitHub Release tag, e.g. `vk-booster/v2.1.1` or `all-in-one/v0.1.0`. On a successful **main push** CI, `release.yml`:

1. Confirms the upstream run was successful and originated from our main-branch push.
2. Lists releases absent at the desired module version.
3. Compares source/dependency scopes with the latest module tag; if unchanged, **skips** publishing.
4. Builds and verifies only each eligible distributable, and creates a GitHub Release containing `*.user.js` and `*-extension.zip`.

**A version bump is necessary for each intentional module release.** If a shared package changed but a consumer version was not bumped, its existing tag blocks duplicate publication. The combiner has its own version; it must be bumped when its bundled dependencies change. No release occurs for `release:false` modules. Scoped tag names are case-sensitive and independently versioned.

This workflow does **not** publish Chrome Web Store packages, automatic Tampermonkey update channels or core npm packages yet; those require signing, registry credentials or a stable per-module update URL. It also does not merge PRs automatically. Release workflows will only be exercised after the initial PR is merged into main and GitHub recognizes the Zoomies runner for this repository.

## Stable Tampermonkey channels

The distribution branch has a module-specific path for each installable
userscript: userscripts/vk-booster.user.js and userscripts/all-in-one.user.js.

Do NOT use releases/latest for userscript auto-updates: that URL is global to
the repository, so a new release of a different module could hijack updates.
Instead each bundle embeds module-specific update/download URLs targeting
the distribution branch. scripts/publish-channel.sh copies the selected
verified userscript into this branch and pushes only on a byte change.

Main's release workflow runs after successful trusted CI, creates immutable
module-scoped GitHub Releases, and then advances that module's stable channel.
A version bump is required; already-published tags are not republished.
