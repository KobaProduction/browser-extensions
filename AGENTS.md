# AGENTS.md

Repository map for ChatGPT Booster.

## Start

1. Read `README.md`.
2. Read `docs/ARCHITECTURE.md` before structural changes.
3. Use the universal workflow library routed by the account/project prompt.
4. Keep the project browser-side unless a concrete feature requires a service.

## Repository boundaries

- `packages/core` — environment-neutral runtime contracts and settings.
- `packages/chatgpt` — ChatGPT DOM adapters.
- `packages/features` — reusable feature modules.
- `packages/ui` — Vue/shadcn-vue components and injected UI.
- `packages/extension` — Chromium Manifest V3 target.
- `packages/userscript` — Tampermonkey/userscript target.
- `.github/workflows` — CI and release packaging.

## Hard rules

- Put disposable local test copies, browser-import artifacts, scratch outputs, and other agent-only files under `/.work/`; never create ad-hoc temporary files in the repository root. The whole workbench is ignored by Git.
- ChatGPT page integration must be isolated behind small adapters/modules.
- Incompatible ChatGPT conversation renderers must be implemented as separate versioned `ChatGptDomAdapter` contracts; do not scatter renderer-specific selector fallbacks through feature code.
- Injected UI must not depend on ChatGPT's CSS cascade; use Shadow DOM.
- Do not call private ChatGPT APIs unless a feature explicitly requires it and the contract is documented.
- Keep host access limited to ChatGPT.
- Shared feature logic belongs in `core` or a feature module, not duplicated between extension and userscript targets.
- Do not store chat content in telemetry.
- A build passing is not equivalent to runtime validation in ChatGPT.
- The active conversation is memory-first: live UI reads `ConversationStateStore`, never IndexedDB as its primary synchronization path. Archive policy affects persistence only; initial/history payloads and live lifecycle evidence must enter RAM regardless of persistence settings.
- IndexedDB may hydrate or persist the memory model asynchronously, but a database read/write must never gate current message decorators, request/activity timers, tool inspection, History Loader state, or current-chat export.
- Stop lifecycle is transport-confirmed: outbound stop means `stop_requested`; only a successful ChatGPT stop response means `stopped`.

## Active archive/UI contract

For archive/toolkit changes, read `docs/tasks/DOCKED_ARCHIVE_TOOLKIT.md`; its selective capture and evidence rules supersede the earlier unconditional capture behavior.
