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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for package boundaries and [docs/CHATGPT_CLIENT_RESEARCH.md](docs/CHATGPT_CLIENT_RESEARCH.md) for verified client research.

## License

MIT
