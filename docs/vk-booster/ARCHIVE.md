# VK Booster — fixed Archive v1 and pre-PROD acceptance

**Owner decision (2026-10-11):** VK's first source release is **1.0.0**;
its provider-owned canonical IndexedDB schema is **v1** and stays fixed
until independently approved first PROD. Dexie is the only active message
writer/Reader. Changes to the upstream VK API are handled by its provider
adapter, not automatic archive migration services.

## Canonical source and read/export contract

- The product's Control Center offers **capture → Dexie → Reader → explicit
  gzip JSONL export** for the currently authenticated and verified VK peer.
  Its sole source of truth is `FixedVkDexieRepository`: immutable original
  VK message snapshots plus a fixed projection of IDs, sender, direction,
  dates, text and attachment counts. It does not silently coerce unknown
  upstream fields or overwrite conflicting original records.
- The database is scoped to the **product/channel/installation** and to the
  authenticated VK account inside its records. DEV, PROD, standalone and
  All-in-one do not share writable stores. Capture and export fail closed on
  peer changes and unknown ownership. Repeated capture skips unchanged rows;
  a conflicting upstream original is rejected until an explicit revision
  policy is accepted.
- Capture reads bounded VK API pages (maximum request 3,000). The Reader
  reads 80 records per bounded page, using a stable source-message ID cursor.
  User Stop halts scanning at message/page boundaries; a subsequent manual
  capture can resume without duplicating previously saved originals. This is
  **not** a durable capture checkpoint or accepted full-history coverage.
- The explicit gzip JSONL export carries fixed projections and original
  source snapshots; its header marks completeness **unknown**. Original
  attachment metadata is preserved, but media bytes are **not** downloaded
  or included by this export. Do not describe the output as a full attachment
  backup. Binary download/HTML offline output require a separate file-output
  implementation against the Dexie source and independent browser acceptance.
- The former file-backed Archive v2 and historical experimental folder v1
  sources remain in Git and are not automatically imported, renamed, reset
  or deleted. The file engine is inaccessible through normal runtime UI;
  legacy synthetic tests still exercise its explicit test-only path.

## Settings backup and restore

Seven validated capture preferences (mode, limit, date range, page size,
delay, media toggle) are independent of Dexie. They use product/channel/target-
scoped userscript localStorage or MV3 `chrome.storage.local`, hydrate at VK
feature startup, and are saved when starting capture. The existing shared
`koba-settings-backup-v1` JSON format supports bounded, checksum-verified
settings export/import with exact scope checks and rollback on a failed
persistent write. Peer IDs, account data, tokens, messages, folder handles
and binaries never enter settings storage. Settings-backup success **does not**
mean archive or media restore is implemented.

Full Dexie archive backup/import/restore is a separate unfinished capability.
It must validate scope, source hashes, record counts and limits before any
transaction and preserve old data on failure. Historical ChatGPT v3/v4
read-only backup is a separate source-extraction feature, not VK restore.

## Release and acceptance boundaries

- Source `1.0.0` is below historical published VK `2.3.x` versions. This
  does **not** establish an in-place updater path. Preserve old tags and
  data without forced downgrade or migration; test installation identity
  and explicit cutover before any PROD promotion.
- One shared Control Center, keyboard/ARIA navigation, strict owner/peer
  guards, accessible settings and bounded Reader. Avoid a second launcher
  or second canonical archive writer.
- SOURCE/TYPE/UNIT/BUILD/CI pass do not prove authenticated VK API,
  installed Tampermonkey/MV3, six-way DEV/PROD profile isolation, real
  attachment completeness, native folder permissions or restored backups.
  These remain explicit browser/product gates.
- Shared scoped telemetry/OTLP infrastructure merged through PR #36 but
  remote delivery stays disabled by default and out of this VK integration.
  No chat text, URLs, paths or authentication material in telemetry.

## Single-stream TAR.GZ backup prototype (unpublished local branch)

VK now adapts its fixed owner-scoped Dexie v1 message/snapshot tables to a
shared portable TAR writer and Reader. The TAR contains only plain JSONL
chunks, schema, optional durable settings and a final integrity manifest;
**one GZIP stream** compresses the whole TAR. No nested compression or raw
physical IndexedDB file copies. The interface selects sections, chunk size,
progress and local file output; the restore validates exact owner/channel,
physical table schema and hashes before the provider performs one IndexedDB
transaction. External media and tab/session storage are excluded. This is
not yet accepted as crash-safe installed-browser recovery. See the
[shared backup contract](../shared/BACKUP_AND_RESTORE.md).
