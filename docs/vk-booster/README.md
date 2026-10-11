# VK Booster

**Owner:** `modules/vk-booster/`. Delivery: Tampermonkey and Chromium MV3.

## Product and authoritative contracts

- [VK Archive v1 and first-release acceptance](ARCHIVE.md).
- [Scoped DEV/PROD and product storage](../shared/ENVIRONMENTS_AND_STORAGE.md).
- [Backup and restore](../shared/BACKUP_AND_RESTORE.md).
- [Telemetry](../shared/TELEMETRY.md) (`VK Booster Service`).
- [All-in-one connection](../shared/INTEGRATION_CONTRACT.md).
- [Release channels](../DEV_PROD_CHANNELS.md).
- [Current architecture](../ARCHITECTURE.md) and
  [accepted architectural direction](../TARGET_ARCHITECTURE.md).

## First VK product under development

The branch implementing the owner's 2026-10-11 decision uses **VK Booster 1.0.0**
and **VK Archive schema 1** in `metadata.json` and `messages.json`. The folder
still contains `index.html` and `media/` and retains exact-N capture, pause,
resume, read-only preview and original media. Source 1.0.0 remains frozen until
explicit first-PROD acceptance, while independently numbered DEV builds are
allowed. This is a development source contract, not a claim of a shipped v1
installation or a merged/released artifact.

`main` historically used VK 2.3.10 and schema-2 folders, and repository Git
history includes older stable and development tags. Those artifacts remain
available. The new v1 engine rejects old schema-2 folders and earlier
`state.json/pages` layouts **without modifying their files**. There is no
implicit import or conversion. Real installed-profile evidence and a safe
release/update strategy are required before first PROD: a new `1.0.0` does
not automatically replace a historically installed `2.3.x` userscript.

The shared Control Center keeps capture/export, read-only archive Reader and
checksum-validated capture-settings backup/restore with durable defaults:
userscripts use an isolated product/channel/target localStorage key, and
Chromium MV3 uses its extension-owned `chrome.storage.local`. Startup restores
validated defaults, while export runs and JSON restores persist new values.
This does not write VK messages/IDs/folder paths into settings storage. The
seven capture defaults are committed after selecting **Выгрузить**, as well as
after validated JSON restore; they are loaded before the Control Center mounts.
The storage write is best-effort for capture: a quota/permission error produces
a visible warning but does not block an authorized archive run. Full Dexie
archive backup/restore remains separate and unavailable in this UI.

Shared Dexie 4 telemetry and common OTLP are currently implemented on [PR #32](https://github.com/KobaProduction/browser-extensions/pull/32),
not yet merged/wired into VK; Dexie archive storage is not yet implemented.
Refer to [ARCHIVE.md](ARCHIVE.md) for the accepted v1 acceptance contract.

## Testing

`bun run check`, `bun run build`, and `bun scripts/validate.ts --built`
are mandatory before source review. The offline synthetic lab is useful
for UI checks but does not prove VK authorization, File System Access
permissions, real media downloads, existing-folder recovery or installed
Tampermonkey/MV3 isolation.

See [ARCHIVE.md](ARCHIVE.md) for compatibility, enhancements and acceptance.
