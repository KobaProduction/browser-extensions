# Koba Browser Extensions

Reusable browser-tool platform for **independent Tampermonkey userscripts**, **Chromium Manifest V3 extensions** and a future **all-in-one tool suite**. The core is separated from website-specific modules and can be reused by ChatGPT Booster or other projects.

## Architectural authority

**Mandatory for contributors and agents:** [Target architecture](docs/TARGET_ARCHITECTURE.md)
defines DDD + FSD + Ports & Adapters, package boundaries, reusable features
and widgets, the archive engine, shared application shell and compatibility
rules. [Current architecture](docs/ARCHITECTURE.md) describes **running code**.
The target is approved as a direction, not yet fully implemented.

The ChatGPT Booster application is being migrated under
`integrations/chatgpt-booster/`. It has its own local build and current
canonical-archive migration requirements. See [migration status](docs/CHATGPT_MIGRATION.md);
this does not imply ChatGPT v3/v4 data have been migrated.

## Current modules

| Module | Status | Targets | Source |
| --- | --- | --- | --- |
| VK Booster | Integrated v2 exporter; needs live browser acceptance | Tampermonkey, Chromium | `modules/vk-booster/` |
| Proxy Switcher | Typed interface and capability boundary only | Future MV3 background | `modules/proxy-switcher/` |
| All-in-one | Launcher with VK Booster; other modules can be enabled later | Tampermonkey, Chromium | `apps/` |

VK Booster preserves source messages, attachments, photos, document names, voice messages and a self-contained offline HTML chat. Its form is a VK-specific Vue presenter around a reusable Archive Manager widget inside the shared Control Center, without a second modal. The previous standalone userscript menu handler was removed, so installing a bundle does not register duplicate menus. The VK-specific API provider, attachment selection/fallback, and offline HTML renderer are separate modules. Neutral linear page selection, acknowledgement-gated scan orchestration and bounded binary response verification (MIME, size, SHA-256) are implemented in `packages/archive`; the File System Access writer is shared via `packages/adapters`. This does not imply that ChatGPT v4 binary asset contracts have been accepted. VK retains its v2 checkpoint persistence, provider-specific media and final HTML output; the shared scan service injects source and commit ports. No branch-aware, multi-source controller is claimed; the v2 output format is preserved.

## Install and build

Requirements: Bun 1.4.2, Node.js 22, `zip`.

```bash
bun install --frozen-lockfile
bun run check   # strict TypeScript (including VK tests), Biome and regressions
bun run build
# Or target one module:
bun scripts/build.ts --module vk-booster
```

Artifacts:

```text
dist/vk-booster/vk-booster.user.js
 dist/vk-booster/vk-booster-extension.zip
 dist/all-in-one/all-in-one.user.js
 dist/all-in-one/all-in-one-extension.zip
```

Tampermonkey: install a generated `.user.js` (for the chat use `vk-booster.user.js`). Chromium: load the extracted `extension/` directory in Developer Mode or install the release ZIP once a signed store package is available. The shared Control Center opens a module-specific panel; no unrelated app has to be installed.

## Repository boundaries

```text
packages/core/          typed feature registry, lifecycle, settings, permissions
packages/archive/       linear paging/scanning application and bounded media verification
packages/ui/            shared shadcn-vue primitives and design tokens
packages/widgets/       provider-neutral Archive Manager form and progress
packages/shell/         Booster-derived draggable shell and module views
packages/adapters/      userscript/Chrome bridges, generic folder output and future proxy interfaces
packages/storage/       generic IndexedDB transaction primitives
modules/vk-booster/     VK-specific model and chat-export feature UI
modules/proxy-switcher/ capability-gated future proxy adapter, not shipped
apps/userscript/        module and all-in-one userscript entries
apps/extension/         MV3 content + popup entries, minimal manifest
scripts/                shared build, impact graph, validation, release plan
.github/workflows/      Zoomies CI and selective per-module release flow
```

Source modules declare hosts, capabilities, delivery targets and versions in `module.json`. Shared code does not contain VK/ChatGPT selectors, cookies or credentials. Module failures are isolated; enabling/disabling a module is persisted through the runtime adapter. Websites not matched by the feature do not start it.

## CI and independent releases

CI checks types, tests and source contracts, then builds **only affected modules**. A change in `modules/vk-booster` builds VK Booster and the combiner; a change in `packages/*` rebuilds the known dependent modules conservatively. Main and trusted same-repository PRs use the `zoomies-linux-x64` runner from ChatGPT Booster; fork PRs use GitHub runners for isolation.

After successful `main` CI, GitHub Actions computes an independent release plan for each releasable module. A module ships only when its `module.json` version has no existing release tag and its source or shared dependency changed since its previous tag. Releases use scoped tags, for example `vk-booster/v2.2.0`, with a userscript and a Chromium ZIP. `proxy-switcher` has `release:false` until implemented and tested. The release workflow does not republish unchanged versions. See `docs/RELEASES.md`.

## Safety and limitations

- Userscript code cannot change browser-wide proxy or User-Agent settings. Proxy routing needs a privileged MV3 background context and explicit user-granted `proxy` permission; no such permission is requested in the current manifest.
- Existing VK auth logic only uses origin storage/compatible authorized providers, does not intercept traffic, and does not store tokens in archived data. Real VK API behavior can change.
- Chrome and Firefox require different extension permission/manifest packaging. Firefox support has not been implemented; no false promise of cross-browser proxy APIs.
- Automated build/type tests are not a substitute for real VK/Tampermonkey browser acceptance, or for store signing/review.

Architecture and integration guides: `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/RELEASES.md`.

## Tampermonkey installation and per-module updates

Use VK Booster instead of the old VK Archive Tampermonkey script.

Install/update URLs:
- VK Booster: https://raw.githubusercontent.com/KobaProduction/browser-extensions/distribution/userscripts/vk-booster.user.js
- All-in-one: https://raw.githubusercontent.com/KobaProduction/browser-extensions/distribution/userscripts/all-in-one.user.js

Paste the URL in Tampermonkey Dashboard → Utilities → Install from URL.
Both userscripts embed matching @updateURL and @downloadURL metadata.
Each has a separate version and update channel; install only ONE on VK to avoid
duplicate interfaces. Stable URLs are served from the dedicated distribution
branch. New releases publish only changed modules after successful main CI.

Disable the old VK Conversation Archive userscript from the Tampermonkey
Dashboard before enabling VK Booster. Never delete the saved message archive:
VK Booster preserves the existing v2 data format.

## Booster UI extraction (in progress)

The UI primitives, reusable archive widget and shared shell are separately owned.
The shell handles Shadow DOM, draggable launcher, centered modal and navigation;
the VK feature adapts its archive API/state to the widget inside that shell. ChatGPT Booster
itself is not modified: its later adoption requires separate tests/review.
The VK API/storage model remains transitional and is not a reusable archive
library yet. This refactor does not change released versions or channels.

## Static quality gates

The VK exporter, provider, media mapper, viewer and regression fixtures are
TypeScript-only. The first-party workspace uses strict TypeScript and
`tsconfig.vk-tests.json` for mock/type contracts. Biome is required by
`bun run check` with errors **and warnings** treated as failures;
`bun run lint:fix` applies safe formatting and import organization. Vue SFC scripts are also formatted/linted by Biome; unused-binding checks in SFCs are deferred to template-aware `vue-tsc` to avoid false positives.
The isolated ChatGPT Booster compatibility application under
`integrations/chatgpt-booster` has its own independent strict TypeScript/Biome
checks and is not implicitly modified by first-party lint commands.
