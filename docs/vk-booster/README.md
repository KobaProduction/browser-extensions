# VK Booster

**Owner:** `modules/vk-booster/`, delivered as Tampermonkey userscript and
Chromium MV3. The product is a participant in the one shared Control Center
alongside ChatGPT Booster and All-in-one.

## Source/product contract

The current VK integration branch targets source **1.0.0** with a fixed
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
[shared product rules](../shared/PROJECT_RULES.md) and
[release channels](../DEV_PROD_CHANNELS.md).

## Acceptance

The repository requires `bun run check`, `bun run build` and
`bun scripts/validate.ts --built`. These prove source and artifact gates,
not real VK authorization, installed multi-profile isolation, missing media
recovery, archive import/restore or first-PROD readiness. Historical VK
`2.3.x` distributions are numerically newer than first-release source
`1.0.0`; explicit updater and user-data acceptance remains necessary.

## Portable TAR.GZ backup — source implementation

The source includes a single portable `.tar.gz` backup
of persistent settings and VK Dexie v1. Plain JSONL chunks, schema and a
final manifest share one GZIP stream. Internal operator tools can select
sections and chunk sizes through shared typed ports; ordinary users do not
see the full backup controls. Tab/session state and external attachments
are excluded. The feature is not PROD-accepted.
See [shared backup contract](../shared/BACKUP_AND_RESTORE.md).
