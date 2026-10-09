# Architecture and host permission model

The platform separates **capability-gated feature logic** from **delivery targets**. ChatGPT Booster is the reference implementation for a shared Shadow DOM control center, modular feature lifecycle, settings and two entry points (Tampermonkey + MV3); this repository uses the same architectural concepts but exposes a separate, reusable platform API.

```text
                   @kobaproduction/browser-core
                      (registry, lifecycle)
                                  |
              +-------------------+------------------+
              |                                      |
      browser-ui + adapters                     feature modules
       (Shadow DOM, state)                  vk-booster | future proxy
              |                                      |
     +--------+------------+--------------+---------+
     |                     |                        |
 Tampermonkey         MV3 content/UI            MV3 background
 host-scoped          isolated world             privileged APIs
     |                     |                        |
  VK page            VK page DOM            future proxy.settings
```

- **Core** is browser-API-agnostic, importable by other apps, and never knows VK/ChatGPT selectors.
- **UI** is mounted inside a Shadow DOM to prevent host CSS interference. Shared labels, colors, actions and module status live here. Apps do not fork UI entry points.
- **Adapters** implement settings and privileged API access. A capability is only provided when the target really has it; being a Chromium extension does not imply that `proxy` is granted.
- **Modules** own site-specific selectors, storage semantics, media/export logic, and immutable `module.json` manifests.
- **Userscript/MV3** are packaging adapters; adding a new feature must not copy its business logic. Module registry controls loading and feature lifecycle.

## VK Booster migration

The old single IIFE exporter is now wrapped as the first module. The duplicated top-level Tampermonkey menu action was removed; it registers with the common feature runtime. Its internal file logic and offline viewer are preserved while they are covered by existing tests. Future changes should extract source-specific authenticated VK API calls, media handling and file writer behind typed adapters. This is a **transitional implementation**, not a claim that all legacy internals were rewritten.

## Proxy roadmap

The future Proxy Switcher must be implemented as an **extension-only background service** with explicit `proxy` permissions, not as page injection. Configure per-host routing through Chrome's `proxy.settings` PAC support when permission is granted; maintain a typed profile store with `HTTP`, `HTTPS`, `SOCKS4`, `SOCKS5` and bypass lists. Credentials require a separate safe storage/authentication model. Userscript builds expose an unsupported status rather than simulating the feature. User-Agent switching likewise needs MV3 request rules or API support and user-granted permissions, not DOM navigator spoofing alone. Ad blocking should eventually be isolated behind `declarativeNetRequest` plus its own permissions and rule bundles.

This capability model prevents all-in-one packaging from automatically acquiring every dangerous browser permission. Each future feature declares the permissions it needs, and target manifests should request them only when included and explicitly enabled by the user.
