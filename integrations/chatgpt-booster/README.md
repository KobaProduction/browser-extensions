# ChatGPT Booster

Open-source browser extension that enhances ChatGPT with UI improvements, productivity tools, export features, and extensible workflows.

## Status

Rolling development. The current `dev` line provides:

- Chromium Manifest V3 and Tampermonkey/userscript targets backed by shared feature logic;
- a Vue 3 injected UI isolated with Shadow DOM, including the Control Center and docked
  current-chat/archive surfaces;
- a local Conversation Archive with selective capture, paginated history ingestion,
  attachment packaging and read-only archive browsing;
- a memory-first `ConversationStateStore` for current-chat lifecycle, message, reasoning,
  tool and timing state, with asynchronous IndexedDB persistence/hydration;
- versioned ChatGPT DOM adapters and passive transport observation for documented
  lifecycle/recovery/safety/user-input evidence;
- source-derived request/reasoning/tool timing and normalized current-run state;
- JSON/Markdown/ZIP export and History Loader workflows;
- English/Russian i18n and persisted settings;
- optional redacted OTLP/HTTP telemetry that excludes chat content;
- strict TypeScript/Biome checks, automated tests, build packaging and rolling CI.

A successful build or CI run is not equivalent to live acceptance against the current
ChatGPT client. Runtime/product-operation evidence is maintained separately in the
contracts and research documents below.

## Current development

Active work runs on the rolling `dev` line. The earlier docked archive/selective-capture
milestone remains documented under `docs/tasks/`, but those historical task files are
not the current project-status authority.

Current implementation authority and ChatGPT product-behavior evidence are split by concern:

- `docs/ARCHITECTURE.md` — ownership and architectural invariants;
- `docs/CHATGPT_RUNTIME_CONTRACTS.md` — per-turn lifecycle, timing, transport,
  recovery, safety and structured-input contracts;
- `docs/CHATGPT_PRODUCT_OPERATIONS.md` — Projects, chat operations, model/effort
  selection, Automations and Plugin/MCP management;
- `docs/CHATGPT_CLIENT_RESEARCH.md` — live/client-code evidence and proof boundaries.
- `docs/CHATGPT_BROWSER_WORKFLOWS.md` — tested user flows, file I/O and cross-feature coverage/gaps.

Source/type/build/CI validation and live ChatGPT runtime acceptance remain separate
evidence levels. Use current GitHub issues for open implementation defects rather than
the historical Extension 2 checklist.

## Development

Requirements: Bun.

- `bun install`
- `bun run check`
- `bun run build`
- `bun run --filter @chatgpt-booster/ui dev` for standalone UI development

Build outputs:

- extension: `packages/extension/dist`
- userscript: `packages/userscript/dist/chatgpt-booster.user.js`

The browser integration is intentionally limited to `https://chatgpt.com/*`.

## Repository

See [docs/ARCHIVE_TARGET_ARCHITECTURE.md](docs/ARCHIVE_TARGET_ARCHITECTURE.md) for the proposed archive modernization contract; all work stages and acceptance are tracked in [one master Issue #54](https://github.com/KobaProduction/chatgpt-booster/issues/54) (implementation and final acceptance tracked separately).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for package boundaries, [docs/CHATGPT_RUNTIME_CONTRACTS.md](docs/CHATGPT_RUNTIME_CONTRACTS.md) for the implementation-facing ChatGPT lifecycle/transport/state model, [docs/CHATGPT_PRODUCT_OPERATIONS.md](docs/CHATGPT_PRODUCT_OPERATIONS.md) for Projects, model selection, Automations and Plugin/MCP management flows, [docs/CHATGPT_CLIENT_RESEARCH.md](docs/CHATGPT_CLIENT_RESEARCH.md) for observed client-behavior evidence, and [docs/CONVERSATION_ARCHIVE.md](docs/CONVERSATION_ARCHIVE.md) for the local archive/history-loader design.

## License

MIT


## Monorepo migration status

This application tree was imported from the last integrated ChatGPT Booster
DEV source baseline into Browser Extensions as a compatibility migration.
Some shared UI primitives and IndexedDB transaction helpers now import
`@kobaproduction/browser-ui` and `@kobaproduction/browser-storage`.
Canonical v3/v4 migration, account-bound storage evolution and cutover are
**not** implemented by this import. The current
`docs/ARCHIVE_TARGET_ARCHITECTURE.md` contains the later 2026-10-09
canonical migration authority; the legacy v4 store remains intact pending
that separate verified migration. No original browser data are transferred.
