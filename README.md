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

On Windows, ZIP packaging uses built-in PowerShell/.NET; no separate `zip`
executable is needed. Use LF line endings (`git config --local core.autocrlf false`)
to match the formatter. Build a local DEV installation with
`bun scripts/build.ts --module all --channel=dev --build-number=46`, then load
`dist/<product>/extension` as an unpacked extension in Chrome/Edge developer mode.
Keep that directory for subsequent rebuilds and reload the extension after changes.
For UI changes with live updates, use `bun run ui:lab` (synthetic data only).

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

Run these gates for acceptance of a finished change. `bun run test` selects
changed files and their linked tests; `bun run test:plan` previews the selection.
Use `bun run test -- --files <source-or-test-paths>` for one atomic batch and
`bun run test:all` only when full-suite acceptance is intended. The
[testing contract](docs/shared/PROJECT_RULES.md#engineering-workflow) also applies
to CI and the pre-push hook.

After a fresh Git checkout, enable the tracked pre-push hook **locally**:

```bash
git config --local core.hooksPath .githooks
```

The executable `.githooks/pre-push` requires the same strict checks,
full builds and built-artifact validation before Git push. Confirm the
configured hook path when moving to another checkout; server-side PR CI
runs independently and does not depend on a local Git hook.

The [release/channel contract](docs/DEV_PROD_CHANNELS.md) defines continuous DEV
prereleases and explicitly approved PROD publication. Different products can
advance independently. **VK Booster's current source version is 1.1.0,
with archive schema 1**. The owner's 2026-10-17 correction removes source-version
freezing. Minor versions add functionality, patches fix bugs,
and major versions represent fundamental changes; schema changes and PROD
publication require separate approval.
DEV identifiers still use three numeric components, e.g. `dev-vk-booster v1.1.1`;
there is no automatic stable promotion. Historical 2.3.x tags and old
schema-2 archives remain untouched; update/downgrade compatibility needs
installed-browser acceptance before PROD.

Installation and environment-specific instructions live in the corresponding
product README. Do not confuse a successful build or source review with
installed-browser acceptance.

## Contributing

Open an [Issue using the required Target extension form](https://github.com/KobaProduction/browser-extensions/issues/new/choose)
for a current implementation task and reference the relevant documentation
contract. Ownership and label routing: [issue routing](docs/ISSUE_ROUTING.md).
Source integration goes through independent review and CI; no automatic PROD
promotion is authorized by merging a PR.
