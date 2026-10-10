# Current architecture and host permission model

> This page describes **current/transitional implementation**. The
> approved **target** architecture is [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md)
> (DDD + FSD + Ports & Adapters; reusable archive/widgets and app shells).
> This is not a claim that the target is already implemented.

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

## Optional shared telemetry

The headless core exposes TelemetryBus and a single TelemetrySink interface,
which ChatGPT Booster or other apps can implement with its existing OTLP
transport. Telemetry is **off by default** and requires explicit opt-in.
Events are restricted to validated module IDs, lifecycle event names and
durations; URLs, chat text, files, cookies, tokens and proxy credentials are
never included. A sink error cannot stop any module. No external endpoint
or always-on tracking is built into this repository.

## Booster-derived shared UI (ongoing refactor)

Shared UI exposes Booster shadcn-vue primitives. A separate shell owns
Shadow DOM, draggable launcher, centered modal and section navigation.
VK export is rendered inside one Control Center as an FSD feature view.
This implementation still needs browser acceptance and independent review.

## ChatGPT Booster migration checkpoint (2026-10-10)

The monorepo now includes an unreleased ChatGPT Booster module that reuses the
platform FeatureRuntime and one Shadow DOM Control Center. The original native
history/IndexedDB and product-facing Vue components are staged under the
ChatGPT module; apps compose browser-specific transport and permissions. One
portable gzip output implementation lives in `packages/archive`.

This is a source-preserving adapter-first migration, not a completed common
VK/ChatGPT archive engine. The VK v2 exporter remains an independent, unchanged
implementation pending its separate compatibility acceptance. Source and
runtime verification levels are recorded in
[CHATGPT_BOOSTER_MIGRATION.md](CHATGPT_BOOSTER_MIGRATION.md).

## Archive page reconciliation shared by both products

The source-neutral `packages/archive` exposes actual dual-consumer page folding
(including VK exact-N/incremental/backfill and ChatGPT strict source snapshot
comparison), record identity, composite keys, SHA-256, and GZIP output.
Provider-specific auth, native DTO validation, storage/checkpoint transactions
and media resolution remain behind their owning module boundaries. Neither
VK v2 folder files nor ChatGPT v3/v4 IDB schema is rewritten by this stage.

## Browser profile / extension-ID source preservation

The native ChatGPT source-transfer adapter in
`modules/chatgpt-booster/packages/features/src/archive-source-transfer.ts`
reads and restores historical v3/v4 **JSON-compatible local source tables**
without rebinding legacy owners. Shared archive infrastructure provides
streaming GZIP and checksums; browser IndexedDB schemas stay provider-owned.
A verified canonical backup is an independent, explicit artifact. Neither
transfer silently migrates binary assets, changes extension identity or
claims that all server history is complete.
