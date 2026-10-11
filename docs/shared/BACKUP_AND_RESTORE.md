# Backup, import, restore and portability

## User-selected native backups, not migration engines (new owner decision 2026-10-11)

The **only historical ChatGPT data-recovery path requested now** is a non-destructive read-only export of the installed stable `0.8.92` native v3 IndexedDB, with exact source records and structured-clone values. The owner may provide the resulting backup for a separately validated one-off import into the fixed canonical Dexie model; there is **no requirement to automatically migrate source v3/v4 generations, switch canonical generations or guess missing API data**. Existing historic backup/migration features below remain implementation history and must not run without separate owner initiation. VK future capture is a new fixed Dexie model; no v2→v1 migration pipeline is being built.


This is a common storage/recovery contract. Settings and large archives
remain different data products even when the UI offers a unified wizard.

## Independent backup domains

1. **Settings backup** — scoped product/channel settings, typed schema
   version, UI preferences, feature configuration (excluding credentials,
   access tokens, cookies and secrets). Suitable for app-persistent Pinia
   stores using a versioned persistence adapter.
2. **Archive/data backup** — indexed conversations, messages, receipts,
   reference graphs, export manifests, and consistency metadata. Large
   datasets must be retrieved through bounded indexed queries/streaming
   where feasible, not a giant synchronous UI JSON stringify.
3. **External attachments** — remain independently user-owned files.
   Their integrity/availability is described in a manifest with relative
   paths, SHA-256 and size. Never claim that a database-only backup includes
   binaries not actually present in the backup.

Each extension must expose independently usable **export, validate, import,
restore** operations for settings and for data. A combined backup is optional,
but must be a manifest containing separately restorable sections. The user
must be able to choose which sections to import.

## Format/identity requirements

Include a format name, schema version, producing product/channel, optional
validated owner and installation identity, export timestamp, record counts,
checksums and explicit inclusion flags. A backup must not contain private
auth data. All attached files use relative, traversal-safe paths.

Cross-channel or cross-owner restore is rejected by default. A deliberate
user-approved *copy into a different scope* requires a separate, non-destructive
migration process and a new destination ID; NEVER interpret it as the same
storage or silently overwrite PROD from DEV.

## Transaction and migration contract

Validate schema/ownership/checksums and resource limits **before** mutating
destination. For IndexedDB migrations prefer a Dexie adapter with explicit
`version().stores()` mappings and migration tests; do not rewrite ChatGPT's
existing v3/v4 data merely to adopt Dexie. Use staged restore/transaction
boundaries and a generation/stamp mechanism for large datasets. On failure,
leave the prior active data readable and provide a clear error.

Keep source and destination independent. Never delete the backup after import,
and never mutate a shared channel or sibling product as a restore side effect.

## Recovery acceptance

Test round-trip, empty and large backup, bad hash, truncated input, duplicate
IDs, unsupported schema, wrong product/channel/owner, disk quota exhaustion,
transaction abort, browser restart, and concurrent readers. Verify counts,
metadata relations and original files after restore. Report whether the test
used mocks, a real browser IndexedDB or installed extension data.

**Current first-release VK source:** new VK folders use schema-1
`metadata.json`/`messages.json`, `index.html`, `media/`; historical schema-2
folders remain untouched and are not imported without a separately accepted
backup/migration. The incompatible IndexedDB replacement in PR #10 is not
accepted. Dexie telemetry journals in PR #32 are separate from archive
backup. ChatGPT has independent v3/v4 historical-data extraction contracts.
The provider-neutral settings backup is used by ChatGPT and VK; a universal
archive backup and Dexie-backed cross-product recovery facade remain **unaccepted**.

## Shared settings backup implementation checkpoint (source only)

`packages/storage` now provides `ServiceScope`, `PersistentSettingsPort`
and portable JSON settings export/validate/restore with a 512 KiB input
bound, SHA-256 integrity, schema and exact product/channel/owner checks
before a single adapter-owned atomic restore. ChatGPT Booster 2.0.7 exposes
this as an explicit export/import action in its Settings panel, excluding
private capture rules, archives, credentials and telemetry endpoints.
The returned file does **not** contain IndexedDB archives or media.

Historical VK schema-2 folders and existing ChatGPT v3/v4 databases are
untouched. Fresh VK schema-1 folders are not a database migration. A VK
**capture-preferences** port and UI now persist seven validated settings
independently of Dexie and offer JSON settings-only backup/restore. They do
not back up archive messages, receipts or attachment bytes. Provider
archive round-trip, Dexie adoption and installed-browser recovery are
**not yet accepted**.

## Explicit retired v4 read-only extraction (2026-10-11)

Retired ChatGPT v4 is not a working archive service. The physical native v4
database remains at its original scope-derived IndexedDB name and is read only
after an explicit owner action for a source backup, not for capture or Reader.
The existing 0.8.92 v3 source has a separate read-only extractor. Both exports
preserve original binary/unknown values without cross-version conversions,
report schema/counts and use a chained gzip JSONL digest. No deletion or
automatic restoration is authorized. Cross-store concurrent-write atomicity
cannot be claimed; pause historical capture for a consistent export.
