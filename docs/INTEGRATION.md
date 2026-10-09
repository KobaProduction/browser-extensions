# Reusing Browser Core from ChatGPT Booster

The packages `@kobaproduction/browser-core`, `@kobaproduction/browser-archive`, `@kobaproduction/browser-ui`, `@kobaproduction/browser-widgets`, `@kobaproduction/browser-shell` and `@kobaproduction/browser-adapters` have explicit ESM/TypeScript entry points and are built independently of VK Booster. The registry accepts any host-specific module implementing the `Feature` interface.

Example in ChatGPT Booster or a separate extension:

```ts
import { FeatureRuntime, FeatureSettings, defaultCapabilities } from '@kobaproduction/browser-core'
import { createSettingsStore } from '@kobaproduction/browser-adapters'
import { mountControlCenter } from '@kobaproduction/browser-shell'
import { myChatGptFeature } from './my-chatgpt-feature'

const runtime = new FeatureRuntime([myChatGptFeature], {
  target: 'userscript', url: new URL(location.href),
  capabilities: defaultCapabilities('userscript'),
  settings: new FeatureSettings(createSettingsStore('userscript')),
})
await runtime.start()
const ui = mountControlCenter({ runtime, title: 'ChatGPT Booster', launcher: true })
```

`@kobaproduction/browser-core` is prepared for publication to GitHub Packages using scope `@kobaproduction`. **It has not yet been published**, so `bun add @kobaproduction/browser-core` will only work after the first package release. Until then you can integrate it by workspace linking or a pinned git submodule and TypeScript/Vite alias. The core is standalone and is not coupled to the Browser Extensions bundle or the VK Booster IIFE.

Do not import `modules/vk-booster` into ChatGPT Booster. Booster should import the core/UI/adapters only; host-specific modules remain independent.

The headless core is framework-neutral. The shared shell uses Vue 3 inside Shadow DOM and accepts feature views through the `views` option. The browser-ui package provides reusable shadcn-vue primitives, not the shell or a second window. A host integrating the shell must provide Vue and its compiled CSS dependencies.

### Using it before registry publication

Build the shared packages locally first:

```sh
cd browser-extensions
bun install --frozen-lockfile
bun scripts/build.ts --module vk-booster
```

From an adjacent ChatGPT Booster clone (or another Bun/Vite monorepo), use a local `file:` dependency on the built package (or pin a git subtree) until the GitHub Packages release channel is enabled:

```json
{
  "dependencies": {
    "@kobaproduction/browser-core": "file:../browser-extensions/packages/core"
  }
}
```

This uses the same `FeatureRuntime` API shown above, with the compiled `dist/index.js` and `.d.ts`. For production cross-repository dependencies, publish a semver-pinned `@kobaproduction/browser-core` to the GitHub npm package registry, then replace the file dependency with a version range. A local `file:` link is for development only, not for a published Booster release.

## Booster shared UI package adoption

Browser UI exports generic shadcn-vue components. Browser Shell exports a
common Control Center accepting FeatureRuntime and module views. ChatGPT
Booster remains an independent repository and may adopt these public APIs
after its own runtime/CI checks; provider integrations are not copied.

## Portable archive selection (implemented)

`@kobaproduction/browser-archive` exports `selectArchivePage`, a provider-neutral
**linear-descending** page selector: recent exact-N counting, incremental
first-known boundary, backfill skipping, date bounds and accurate consumed count.
It does not implement network requests, IndexedDB or checkpoint durability,
ChatGPT branching, or a multi-source ArchiveController. VK Booster consumes it
today. ChatGPT Booster's v4 source-of-truth and branch-lineage contracts take
precedence; its adoption requires an evidence-backed projection and separate
compatibility acceptance. No ChatGPT migration is implied by this package.

## Reusable Archive Manager (implemented presentation only)

`@kobaproduction/browser-widgets` exposes `ArchiveManager`, taking a
provider-neutral view state and initial options and emitting choose-folder,
start, stop and resume actions. It does not call VK APIs or access archives.
The VK feature supplies the first presenter through `ArchivePanel.vue`.
The shared shell remains the **only** modal and launcher.
ChatGPT Booster must map its own v4 contract and explicitly supported
actions before adopting this view; this is not evidence of a working
ChatGPT archive adapter or branch-aware controller.

## Portable binary response reader (implemented)

`readArchiveMedia(response, {maxBytes, expectedBytes})` from
`@kobaproduction/browser-archive` validates an already-fetched successful
`Response`, rejects HTML and oversize/empty/truncated-original-size bodies,
collects bounded bytes and computes SHA-256 before handing them to the caller.
It does **not** obtain media URLs, credentials, scope permission, refresh signed
links, persist bytes or claim that provider-specific binaries exist. VK uses the
reader behind its own attachment mapping and fallback logic. ChatGPT v4 has
not established binary-asset completeness, so this utility alone does not
authorize or implement ChatGPT asset export.

## Linear archive scan application port (implemented)

`scanLinearArchive` coordinates a descending **linear** source through the
`source.readPage(offset, count)` port and calls `commit({selection, previous,
next, sourceTotal})` before advancing its internal cursor, known IDs or
requesting another page. It also supports stop/pause checks and delay between
pages; the caller supplies validated source records, stable identity and
timestamp mapping, persistent checkpoint semantics and final output. VK Booster
now uses this application loop, retaining its v2 JSON files, media handling and
pause/resume state.

The VK port builds the next records/checkpoint snapshot separately and
publishes it in memory only after the File System Access driver confirms its
writes. This avoids advancing the visible cursor after a failed write; it
does **not** claim a multi-file atomic transaction for `messages.json` and
`metadata.json`. A crash between those writes still needs v2 recovery.

The archive package exposes Bun's TypeScript source entry (included in its
package contents) and compiled JavaScript/declaration entries for other
consumers. It is tested through the actual local package manifest; no external
registry publication has occurred.

This is not a complete multi-source archive controller. In particular it
neither verifies a ChatGPT branch lineage nor satisfies the v4 account,
source-version, immutable-message and single-transaction store contracts.
ChatGPT v4 adoption requires an independently verified integration, not a
blind replacement of its collection pipeline.
