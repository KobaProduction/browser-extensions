# ChatGPT Booster

Open-source browser extension that enhances ChatGPT with UI improvements, productivity tools, export features, and extensible workflows.

## Status

Early foundation. The repository currently provides:

- a Chromium Manifest V3 extension target;
- a Tampermonkey/userscript target;
- shared typed runtime contracts;
- a Vue 3 injected UI mounted in Shadow DOM;
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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the package boundaries and extension/userscript relationship.

## License

MIT
