# Koba Browser Extensions

Reusable browser-tool platform for **independent Tampermonkey userscripts**, **Chromium Manifest V3 extensions** and a future **all-in-one tool suite**. The core is separated from website-specific modules and can be reused by ChatGPT Booster or other projects.

## Architectural authority

**Mandatory for contributors and agents:** [Target architecture](docs/TARGET_ARCHITECTURE.md)
defines DDD + FSD + Ports & Adapters, package boundaries, reusable features
and widgets, the archive engine, shared application shell and compatibility
rules. [Current architecture](docs/ARCHITECTURE.md) describes **running code**.
The target is approved as a direction, not yet fully implemented.

The executable experimental ChatGPT Booster is integrated under
`modules/chatgpt-booster/` and built with both Tampermonkey and Chromium adapters.
The development-only `integrations/chatgpt-booster/` tree is retained as a
non-distributed reference for additional decomposition from the advanced VK
branch, not a second runtime. See [migration status](docs/CHATGPT_BOOSTER_MIGRATION.md).
Browser profile/extension-ID data migration is not automatic.

## Current modules

| Module | Status | Targets | Source |
| --- | --- | --- | --- |
| VK Booster 3 | Native IndexedDB archive + independent JSON/file export, source/browser QA pending | Tampermonkey, Chromium | `modules/vk-booster/` |
| ChatGPT Booster | Distinct v3/v4 archive and provider runtime; migration acceptance separate | Tampermonkey, Chromium | `modules/chatgpt-booster/` |
| All-in-one | Shared Control Center, VK + ChatGPT in isolated channels | Tampermonkey, Chromium | `apps/` |
| Proxy Switcher | Capability contract only | Not shipped | `modules/proxy-switcher/` |

VK Archive 3 first captures **every available message** through the VK API
into its own `koba-vk-native-v1:<product>:<channel>` IndexedDB. No attachment
binary is included in capture. The separate export path filters saved messages
by inclusive dates and text/file selections; output is `chat.json`,
`manifest.json`, and a flat `attachments/` directory with collision-free
numeric filename prefixes. A separate receipt ledger stores SHA-256, size and
folder identity, and an audit flags missing, renamed or modified files.
Independent JSON backup/restore is scoped and atomic. The old VK v2
file-export prototype was removed; it has no installed-user migration contract.

A local browser-only archive lab uses synthetic VK messages and a memory
repository, without requiring a VK login or extension installation. Run
`bun run dev:archive` and open `http://127.0.0.1:5187` to inspect the UI
and exercise fixture capture, export and backup/restore. Reusable fixture
primitives live in `scripts/dev-harness`, and provider-specific fixtures in
`apps/dev-archive-lab`.

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
dist/chatgpt-booster/chatgpt-booster.user.js
 dist/chatgpt-booster/chatgpt-booster-extension.zip
 dist/all-in-one/all-in-one.user.js
 dist/all-in-one/all-in-one-extension.zip
```

Tampermonkey: install a generated `.user.js` (for the chat use `vk-booster.user.js`). Chromium: load the extracted `extension/` directory in Developer Mode or install the release ZIP once a signed store package is available. The shared Control Center opens a module-specific panel; no unrelated app has to be installed.

## Issues and pull requests

Open a [structured Issue](https://github.com/KobaProduction/browser-extensions/issues/new/choose)
and select the required **Target extension** (VK, ChatGPT, All-in-one,
Shared platform, Proxy Switcher or Build/release). An automation adds a
matching target label; PRs declare the same owner and all affected products.
[Ownership and legacy migration mapping](docs/ISSUE_ROUTING.md).

## Repository boundaries

```text
packages/core/          typed feature registry, lifecycle, settings, permissions
packages/archive/       linear paging/scanning application and bounded media verification
packages/ui/            shared shadcn-vue primitives and design tokens
packages/widgets/       provider-neutral Archive Manager form and progress
packages/shell/         Booster-derived draggable shell and module views
packages/adapters/      userscript/Chrome bridges, generic folder output and future proxy interfaces
packages/storage/       IndexedDB transactions, bounded cursors and staged migration orchestration
modules/vk-booster/     VK-specific model and chat-export feature UI
modules/chatgpt-booster/ ChatGPT native canonical archive, owner-scoped migration and UI
modules/proxy-switcher/ capability-gated future proxy adapter, not shipped
apps/userscript/        module and all-in-one userscript entries
apps/extension/         MV3 content + popup entries, minimal manifest
scripts/                shared build, impact graph, validation, release plan
.github/workflows/      Zoomies CI and selective per-module release flow
```

Source modules declare hosts, capabilities, delivery targets and versions in `module.json`. Shared code does not contain VK/ChatGPT selectors, cookies or credentials. Module failures are isolated; enabling/disabling a module is persisted through the runtime adapter. Websites not matched by the feature do not start it.

## Development and production channels

Reviewed pushes to `main` automatically advance **prerelease-only** builds
on the `dev` branch, restricted to impacted products. The `prod` branch,
stable GitHub Releases and the backwards-compatible `distribution` updater
are promoted only by explicit approval after real-browser acceptance. Versions
and stored data are isolated by product and channel; existing standalone PROD
ChatGPT v3/v4 databases are never migrated implicitly. See
[the channel and co-installation contract](docs/DEV_PROD_CHANNELS.md).

## CI and independent releases

CI checks types, tests and source contracts, then builds **only affected modules**. A change in `modules/vk-booster` builds VK Booster and the combiner; a change in `packages/*` rebuilds the known dependent modules conservatively. Main and trusted same-repository PRs use the `zoomies-linux-x64` runner from ChatGPT Booster; fork PRs use GitHub runners for isolation.

After installed-product verification, **explicit manual release approval** starts GitHub Actions independent release planning. Merging code into `main` does not publish untested browser updates. A module ships only when its `module.json` version has no existing release tag and its source or shared dependency changed since its previous tag. Releases use scoped tags, for example `vk-booster/v2.2.0`, with a userscript and a Chromium ZIP. `proxy-switcher` has `release:false` until implemented and tested. The release workflow does not republish unchanged versions. See `docs/RELEASES.md`.

## Safety and limitations

- Userscript code cannot change browser-wide proxy or User-Agent settings. Proxy routing needs a privileged MV3 background context and explicit user-granted `proxy` permission; no such permission is requested in the current manifest.
- Existing VK auth logic only uses origin storage/compatible authorized providers, does not intercept traffic, and does not store tokens in archived data. Real VK API behavior can change.
- Chrome and Firefox require different extension permission/manifest packaging. Firefox support has not been implemented; no false promise of cross-browser proxy APIs.
- Automated build/type tests are not a substitute for real VK/Tampermonkey browser acceptance, or for store signing/review.

Architecture and integration guides: `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/RELEASES.md`.

## Tampermonkey DEV installation

DEV userscripts update from the `dev` artifact branch; PROD is separately
approved. Install exactly the desired product variant:

- VK: https://raw.githubusercontent.com/KobaProduction/browser-extensions/dev/userscripts/vk-booster.user.js
- ChatGPT: https://raw.githubusercontent.com/KobaProduction/browser-extensions/dev/userscripts/chatgpt-booster.user.js
- Aggregate: https://raw.githubusercontent.com/KobaProduction/browser-extensions/dev/userscripts/all-in-one.user.js

The aggregate owns **its own** archive database. Its storage does not inspect
standalone extension databases. All product/channel scopes are independent.

## Static quality gates

The VK exporter, provider, media mapper, viewer and regression fixtures are
TypeScript-only. Storage migration/cursor fixtures are also checked with strict TypeScript. The first-party workspace uses strict TypeScript and
`tsconfig.vk-tests.json` for mock/type contracts. Biome is required by
`bun run check` with errors **and warnings** treated as failures;
`bun run lint:fix` applies safe formatting and import organization. Vue SFC scripts are also formatted/linted by Biome; unused-binding checks in SFCs are deferred to template-aware `vue-tsc` to avoid false positives.
The isolated ChatGPT Booster compatibility application under
`integrations/chatgpt-booster` has its own independent strict TypeScript/Biome
checks and is not implicitly modified by first-party lint commands.

## Integration source boundary (2026-10-10)

The VK Booster 3 native archive source and shared archive infrastructure
utilities are included in the same tree as independent ChatGPT Booster
2.0.6. Only `modules/*` application entries are distributed. The other
ChatGPT baseline in `integrations/chatgpt-booster` is a read-only migration
reference preserving advanced refactor files until source parity is verified;
it is not registered as a second extension, bundle or release target. Browser
installation/cutover and independently approved module releases happen only
after source integration.

Source merge and authoritative ownership map: [VK/ChatGPT reconciliation](docs/INTEGRATION_RECONCILIATION.md).

## Independent product release graph

ChatGPT Booster is release-enabled at **2.0.6**, VK Booster uses **3.0.0**,
and the combined all-in-one package is **0.6.0**. Changes to ChatGPT require a ChatGPT and aggregate version bump. VK development
changes rebuild VK DEV and advance the aggregate without changing the frozen
VK 3.0.0 product version. Shared implementation changes bump other affected
products while retaining the VK 3.0.0 base. PR CI
checks this relationship; `scripts/bump-versions.ts` provides an explicit
patch-bump utility. Module-scoped release tags and distribution userscripts
remain independent. The manual release workflow can select one product and
includes its dependent aggregator; source merge/build alone never publishes a
new install. See [independent releases](docs/INDEPENDENT_RELEASES.md).

### Shared storage and archive decomposition

`packages/archive` owns record selection, SHA-256 and GZIP; `packages/storage`
owns bounded IndexedDB pages, range scans, request and transaction lifecycle.
ChatGPT v4 types/identity/read-only queries are separately owned from write
transactions and canonical migration, with legacy DBs untouched.
[Current decomposition and remaining boundaries](docs/ARCHIVE_DECOMPOSITION.md).

## Canonical archive responsibilities

ChatGPT's canonical migration coordinator delegates stored conversation reads,
bounded/focused Reader windows and preview to `ArchiveCanonicalReader`,
source-native export to a separate exporter, and read-only ownership/coverage
inspection to `ArchiveCanonicalAudit`. Shared storage paging and the
provider-owned v3/v4 database/write protocols remain unchanged. See
[archive decomposition](docs/ARCHIVE_DECOMPOSITION.md).
