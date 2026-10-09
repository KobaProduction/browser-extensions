# Koba Browser Extensions

Reusable browser-tool platform for **independent Tampermonkey userscripts**, **Chromium Manifest V3 extensions** and a future **all-in-one tool suite**. The core is separated from website-specific modules and can be reused by ChatGPT Booster or other projects.

## Current modules

| Module | Status | Targets | Source |
| --- | --- | --- | --- |
| VK Archive | Integrated v2 exporter; needs live browser acceptance | Tampermonkey, Chromium | `modules/vk-archive/` |
| Proxy Switcher | Typed interface and capability boundary only | Future MV3 background | `modules/proxy-switcher/` |
| All-in-one | Launcher with VK Archive; other modules can be enabled later | Tampermonkey, Chromium | `apps/` |

VK Archive preserves source messages, attachments, photos, document names, voice messages and a self-contained offline HTML chat. It has its own native exporter panel for now, opened **through the shared control center**. The previous standalone userscript menu handler was removed, so installing a bundle does not register duplicate menus. The next migration step is extracting exporter state/files/media/UI into typed modules and moving its panel into the shared UI kit; v2 output format remains compatible.

## Install and build

Requirements: Bun 1.4.2, Node.js 22, `zip`.

```bash
bun install --frozen-lockfile
bun run check
bun run build
# Or target one module:
bun scripts/build.ts --module vk-archive
```

Artifacts:

```text
dist/vk-archive/vk-archive.user.js
 dist/vk-archive/vk-archive-extension.zip
 dist/all-in-one/all-in-one.user.js
 dist/all-in-one/all-in-one-extension.zip
```

Tampermonkey: install a generated `.user.js` (for the chat use `vk-archive.user.js`). Chromium: load the extracted `extension/` directory in Developer Mode or install the release ZIP once a signed store package is available. The shared Control Center opens a module-specific panel; no unrelated app has to be installed.

## Repository boundaries

```text
packages/core/          typed feature registry, lifecycle, settings, permissions
packages/ui/            isolated Shadow DOM control center, shared visual tokens
packages/adapters/      userscript/Chrome storage and future proxy interfaces
modules/vk-archive/     VK-only behavior and existing archive engine
modules/proxy-switcher/ capability-gated future proxy adapter, not shipped
apps/userscript/        module and all-in-one userscript entries
apps/extension/         MV3 content + popup entries, minimal manifest
scripts/                shared build, impact graph, validation, release plan
.github/workflows/      Zoomies CI and selective per-module release flow
```

Source modules declare hosts, capabilities, delivery targets and versions in `module.json`. Shared code does not contain VK/ChatGPT selectors, cookies or credentials. Module failures are isolated; enabling/disabling a module is persisted through the runtime adapter. Websites not matched by the feature do not start it.

## CI and independent releases

CI checks types, tests and source contracts, then builds **only affected modules**. A change in `modules/vk-archive` builds VK Archive and the combiner; a change in `packages/core|ui|adapters` rebuilds all consumers. Main and trusted same-repository PRs use the `zoomies-linux-x64` runner from ChatGPT Booster; fork PRs use GitHub runners for isolation.

After successful `main` CI, GitHub Actions computes an independent release plan for each releasable module. A module ships only when its `module.json` version has no existing release tag and its source or shared dependency changed since its previous tag. Releases use scoped tags, for example `vk-archive/v2.0.0`, with a userscript and a Chromium ZIP. `proxy-switcher` has `release:false` until implemented and tested. The release workflow does not republish unchanged versions. See `docs/RELEASES.md`.

## Safety and limitations

- Userscript code cannot change browser-wide proxy or User-Agent settings. Proxy routing needs a privileged MV3 background context and explicit user-granted `proxy` permission; no such permission is requested in the current manifest.
- Existing VK auth logic only uses origin storage/compatible authorized providers, does not intercept traffic, and does not store tokens in archived data. Real VK API behavior can change.
- Chrome and Firefox require different extension permission/manifest packaging. Firefox support has not been implemented; no false promise of cross-browser proxy APIs.
- Automated build/type tests are not a substitute for real VK/Tampermonkey browser acceptance, or for store signing/review.

Architecture and integration guides: `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/RELEASES.md`.
