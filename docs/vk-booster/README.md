# VK Booster

**Owner:** `modules/vk-booster/`, delivered as Tampermonkey userscript and
Chromium MV3. The product is a participant in the one shared Control Center
alongside ChatGPT Booster and All-in-one.

## Source/product contract

The VK source version is declared in `module.json`; the product uses a fixed
**Dexie Archive v1** as its sole active message repository. The capture UI
reads authorized VK history; the Reader pages saved messages by immutable
source ID; explicit gzip JSONL export preserves original source snapshots.
The old file-backed Archive v2 and experimental v1 folders remain untouched;
no implicit version migration, native folder import or destructive reset.
Original external media bytes, offline HTML output and full data restore are
not yet implemented against the Dexie canonical source.

The product has independently scoped durable capture defaults in
userscript `localStorage` / MV3 `chrome.storage.local`. JSON settings export
and restore reuse the generic checksum/scoping contract in `packages/storage`
and do not include VK peer, account, tokens, archives or media. Settings backup and whole-archive recovery are internal operator facilities,
not controls in the ordinary VK UI.

See [archive/source contract](ARCHIVE.md),
[environment isolation](../shared/ENVIRONMENTS_AND_STORAGE.md),
[backup/restore ownership](../shared/BACKUP_AND_RESTORE.md),
[telemetry](../shared/TELEMETRY.md),
[release channels](../DEV_PROD_CHANNELS.md).

## Acceptance

Local commands and checks are documented in [repository development](../../README.md#development-and-releases).
Product acceptance and historic archive compatibility belong to
[the archive contract](ARCHIVE.md); updater and publication acceptance belong
to [release channels](../DEV_PROD_CHANNELS.md).

## Portable TAR.GZ backup — source implementation

The source includes a single portable `.tar.gz` backup
of persistent settings and VK Dexie v1. Plain JSONL chunks, schema and a
final manifest share one GZIP stream. Internal operator tools can select
sections and chunk sizes through shared typed ports; ordinary users do not
see the full backup controls. Tab/session state and external attachments
are excluded. The feature is not PROD-accepted.
See [shared backup contract](../shared/BACKUP_AND_RESTORE.md).

## Shared quick menu and collection UI (Extension 15)

VK contributes its own archive/collection/export/settings actions to the
shared edge launcher and preserves VK peer authorization, Dexie persistence,
source paging and stop behavior inside VK. The generic conversation-collection
controller and presentation are reused with ChatGPT; their providers do not
share physical databases or source APIs. No full-database backup controls are
added to the ordinary VK UI.

## Full-history capture and wider site coverage

The quick launcher and non-chat settings are available on all VK pages;
archive capture/export still requires an opened, verified VK dialog.
The capture UI defaults to all available message history, with an optional
latest-N mode and adjustable batch size/delay. Original messages persist
in canonical Dexie v1. Binary attachments are **not yet downloaded**; stage
2 is explicitly separated and requires its own permissions/integrity gates.
See [archive contract](ARCHIVE.md) for rate, completeness and ownership rules.
