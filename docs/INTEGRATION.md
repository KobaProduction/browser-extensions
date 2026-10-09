# Reusing Browser Core from ChatGPT Booster

The packages `@kobaproduction/browser-core`, `@kobaproduction/browser-ui`, `@kobaproduction/browser-shell` and `@kobaproduction/browser-adapters` have explicit ESM/TypeScript entry points and are built independently of VK Booster. The registry accepts any host-specific module implementing the `Feature` interface.

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
