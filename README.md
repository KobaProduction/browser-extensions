# Koba Browser Extensions

Modular browser-extension workspace for Tampermonkey userscripts, Chromium
Manifest V3 targets and a shared Control Center. Products have independent
providers, archives, release channels and acceptance gates. The repository's
**source code** is authority for implementation; `docs/` is authority for
architecture, durable contracts and operating rules.

## Systems

| System | Responsibility | Documentation | Source |
| --- | --- | --- | --- |
| **VK Booster** | VK conversations, native archive, attachments and exports | [VK Booster](docs/vk-booster/README.md) | `modules/vk-booster/` |
| **ChatGPT Booster** | ChatGPT native/canonical conversation archives and provider UI | [ChatGPT Booster](docs/chatgpt-booster/README.md) | `modules/chatgpt-booster/` |
| **All-in-one / Koba Browser Tools** | Host-aware composition of both products with its own isolated environment | [All-in-one](docs/all-in-one/README.md) | `apps/` |
| **Shared platform** | Lifecycle, UI shell, storage interfaces, telemetry and packaging | [Shared platform](docs/shared/README.md) | `packages/`, `scripts/` |
| **Proxy Switcher** | Planned capability-gated proxy module, **not shipped** | [Architecture target](docs/TARGET_ARCHITECTURE.md) | `modules/proxy-switcher/` |

Every product owns its implementation. All-in-one is an application composition,
not permission to silently merge or directly edit other products' storage.

## Documentation and rules

Start with the [documentation index](docs/README.md). In particular:

- [Shared project rules](docs/shared/PROJECT_RULES.md) — binding documentation
  layout, ownership, review and version/release rules.
- [Environment and data isolation](docs/shared/ENVIRONMENTS_AND_STORAGE.md) —
  strict DEV/PROD boundary, product identities, persistence choices, aggregate access.
- [Backup and restore](docs/shared/BACKUP_AND_RESTORE.md) and
  [telemetry contract](docs/shared/TELEMETRY.md).
- [Target architecture](docs/TARGET_ARCHITECTURE.md) versus
  [implemented architecture](docs/ARCHITECTURE.md).

`AGENTS.md` is the small agent-facing router. GitHub Issues contain the **current
task, its evidence and acceptance**, never the only copy of a durable rule.

## Development and releases

Requirements: Bun 1.4.2, Node.js 22, ZIP tooling.

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

The [release/channel contract](docs/DEV_PROD_CHANNELS.md) defines continuous DEV
prereleases and explicitly approved PROD publication. Different products can
advance independently. **VK Booster's product base is frozen at 3.0.0 during
development**; DEV build identifiers may continue as `3.0.0-dev.N`.

Installation and environment-specific instructions live in the corresponding
product README. Do not confuse a successful build or source review with
installed-browser acceptance.

## Contributing

Open an [Issue using the required Target extension form](https://github.com/KobaProduction/browser-extensions/issues/new/choose)
for a current implementation task and reference the relevant documentation
contract. Ownership and label routing: [issue routing](docs/ISSUE_ROUTING.md).
Source integration goes through independent review and CI; no automatic PROD
promotion is authorized by merging a PR.
