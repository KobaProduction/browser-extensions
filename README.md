# ChatGPT Booster

Open-source browser extension that enhances ChatGPT with UI improvements, productivity tools, export features, and extensible workflows.

## Status

Early foundation. The repository currently provides:

- a Chromium Manifest V3 extension target;
- a Tampermonkey/userscript target;
- shared typed runtime contracts;
- a Vue 3 + shadcn-vue injected UI mounted in Shadow DOM;
- an initial Tool Inspector module for client-visible MCP/tool diagnostics;
- one shared Control Center UI exposed through Tampermonkey, the extension popup, and a movable in-page launcher;
- English/Russian i18n with automatic browser-language detection and manual override;
- passive transport observer for fetch/XHR/WebSocket/EventSource with current-tab and persisted all-time counters;
- categorized Control Center sections for modules, analytics, and other settings with persisted UI state;
- optional OTLP/HTTP telemetry export through a target-specific secure transport path;
- strict TypeScript and Biome checks;
- CI build artifacts and tag-based GitHub Release packaging.

## Active Extension 2 work

The docked toolkit and selective-archive iteration is tracked in
[the 102-item checklist](docs/tasks/EXTENSION_2_CHECKLIST.md),
[the acceptance contract](docs/tasks/DOCKED_ARCHIVE_TOOLKIT.md), and
[the validation report](docs/tasks/EXTENSION_2_VALIDATION.md).
This working branch is not a new release: local-fixture acceptance is separate from
live ChatGPT/userscript acceptance. Full attachment packaging and independent review
remain open. The reproducible synthetic browser fixture is in `tests/browser/`.

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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for package boundaries, [docs/CHATGPT_RUNTIME_CONTRACTS.md](docs/CHATGPT_RUNTIME_CONTRACTS.md) for the implementation-facing ChatGPT lifecycle/transport/state model, [docs/CHATGPT_PRODUCT_OPERATIONS.md](docs/CHATGPT_PRODUCT_OPERATIONS.md) for Projects, model selection, Automations and Plugin/MCP management flows, [docs/CHATGPT_CLIENT_RESEARCH.md](docs/CHATGPT_CLIENT_RESEARCH.md) for reverse-engineering evidence, and [docs/CONVERSATION_ARCHIVE.md](docs/CONVERSATION_ARCHIVE.md) for the local archive/history-loader design.

## License

MIT
