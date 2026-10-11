# VK Booster

**Owner:** `modules/vk-booster/`. Delivery: Tampermonkey and Chromium MV3.

## Product and authoritative contracts

- [VK Archive v2 and enhancement acceptance](ARCHIVE.md).
- [Scoped DEV/PROD and product storage](../shared/ENVIRONMENTS_AND_STORAGE.md).
- [Backup and restore](../shared/BACKUP_AND_RESTORE.md).
- [Telemetry](../shared/TELEMETRY.md) (`VK Booster Service`).
- [All-in-one connection](../shared/INTEGRATION_CONTRACT.md).
- [Release channels](../DEV_PROD_CHANNELS.md).
- [Current architecture](../ARCHITECTURE.md) and
  [accepted architectural direction](../TARGET_ARCHITECTURE.md).

## Current product

The active source in `main` is VK Booster **2.3.10**. It writes the VK Archive
v2 folder structure (`metadata.json`, `messages.json`, `index.html`,
`media/`), retains downloaded files and original source metadata, supports
paged history, exact-N collection, media checks and pause/resume. A shared
Control Center and Archive Manager render the existing provider.

**Owner decision (2026-10-11): keep the v2 product and freeze the base
version at 2.3.10 until separately authorized.** DEV builds may advance
`2.3.10-dev.N`; do not auto-bump patch/minor/major or replace the v2 folder
with a new incompatible archive. Previously created v2 archives must remain
usable; there is no authorized destructive migration.

## Unmerged implementation proposals

[PR #10](https://github.com/KobaProduction/browser-extensions/pull/10)
proposed replacing v2 with IndexedDB Archive 3; its replacement/version
decision was explicitly rejected by the product owner. It must not merge
unchanged. Portable components (indexed repository, offline lab, filtered
export, hash receipts and viewer) may be adapted incrementally only after
preserving the existing v2 contract and adding regression coverage.

[PR #21](https://github.com/KobaProduction/browser-extensions/pull/21)
contains shared scope, settings backup, telemetry and read-only provider ports,
but is stacked on PR #10. Its useful pieces must be rebased or transplanted
independently of the rejected v3 architecture. The PR's source/build approval
is not browser/data acceptance.

## Testing

`bun run check`, `bun run build`, and `bun scripts/validate.ts --built`
are mandatory before source review. The offline synthetic lab is useful
for UI checks but does not prove VK authorization, File System Access
permissions, real media downloads, existing-folder recovery or installed
Tampermonkey/MV3 isolation.

See [ARCHIVE.md](ARCHIVE.md) for compatibility, enhancements and acceptance.
