# Backup, import, restore and portability

## Clean archive baseline; old-source migration is external (2026-10-11)

The active ChatGPT Booster is **Dexie v1 only** (fixed canonical v4-era data
model) and does **not** ship original v3/v4 database readers, backups,
importers or migration controls. Existing native v3/v4 IndexedDB objects
must remain untouched, not deleted or upgraded. The owner will work on
optional raw IndexedDB extraction/import through a **separate script/chat**;
do not carry that legacy workflow into the new runtime.

Future archive backup and restore belong to the canonical scoped Dexie
schema with explicit independent archive/settings/media sections, validation
and rollback. This work is not yet accepted and is not an excuse to recreate
the old migration machinery. The older provisions below describe historical
requirements only where they reference v3/v4 migration/read/export.


## Internal recovery versus ordinary user export (2026-10-12)

The portable TAR.GZ backup and restore facility is an internal/operator recovery
capability, **not a required ordinary-user action or default UI workflow**.
Products may expose independently validated service ports without surfacing a
backup/restore wizard. Archive reading and explicit conversation exports remain
normal product features and must not be confused with whole-database recovery.
An operator restore always requires an explicit invocation; never restore on
startup, capture, update or a channel change.

ChatGPT's new canonical Dexie schema v1 has a provider-owned five-table
backup adapter (projects, conversations, messages, elements, snapshots) using
the generic TAR format. Only the verified account's rows are included and an
import validates the graph before replacing that account in one transaction.
No ordinary ChatGPT backup screen is mounted, and the historical v3/v4
physical databases remain untouched. Settings are an independent scope and
require a validated persistent-settings adapter before inclusion.

PR #38 initially exposed portable backup controls in VK settings. The
ordinary VK and ChatGPT Control Centers no longer offer backup or restore
controls for either persistent settings or full IndexedDB archives. Existing
service-level settings and archive backup ports are retained for internal
operator tooling; the provider-neutral widget is not mounted in these screens. Installed-browser recovery and large-input staged restore
remain unaccepted.

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

Each extension must support independently usable internal **export, validate, import,
restore** operations for settings and for data; ordinary users do not need
backup-specific screens. A combined backup is optional,
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

## Single-stream TAR / TAR.GZ backup (source implementation; browser acceptance pending)

The VK source implementation replaces the experimental nested-compression ZIP
with a **single POSIX ustar file**, optionally wrapped by **one GZIP stream**.
The browser IndexedDB API cannot copy a physical LevelDB database file; the
provider must read records through scoped indexed queries. The TAR payload
contains *only ordinary uncompressed files*, never nested ZIP/GZIP archives:

```text
vk-portable-v1.tar.gz
  persistent/settings.json              persistent app settings (optional)
  indexeddb/schema.json                 exact table names, primary keys and indexes
  indexeddb/messages/00000000.jsonl     rows 1..N, plain JSONL
  indexeddb/messages/00000001.jsonl     next bounded chunk
  indexeddb/snapshots/00000000.jsonl    immutable original VK payloads
  manifest.json                         owner/scope/schema/counts/chunk hashes
```

- A **single** native browser CompressionStream('gzip') compresses *all*
  TAR bytes in order, so repetitive API field names and common message
  constructions share the normal DEFLATE 32 KiB history window across TAR
  file boundaries; there is no second compression pass. The standard browser
  API does not support a configurable GZIP level, custom dictionary or larger
  history window. Additional codec tuning requires a separate tested library
  and actual compression benchmarks rather than inventing unsupported flags.
- The internal operator selects persistent settings/IndexedDB inclusion, gzip on
  or off, and chunk size 64–2,048 records (default 1,024). Session/tab RAM and
  sessionStorage never enter backups. Per-chunk plain JSONL buffers are
  bounded to 8 MiB, but there is **no arbitrary total backup-record or TAR
  file-size cap** when writing to a file sink. Counted records and chunk
  totals drive phases, X/Y records, percentage and TAR entry count.
- Writes go through one backpressure-aware File System Access WritableStream
  when available (on user gesture), with no giant output Blob. When this
  browser capability is unavailable, a download Blob fallback is retained
  and **limited to 128 MiB in memory**; the application cannot silently
  obtain OS filesystem permissions just because it is installed locally.
- TAR uses ordinary ustar files with header checksums, safe relative paths,
  padding and end-of-archive blocks, independently readable by standard tar
  tools. The final manifest includes exact owner/product/channel/installation,
  table index schema, per-table totals and SHA-256 for each JSONL chunk.
  Restore scans and checks the *whole* archive before changing any records.
- VK implements owner-scoped fixed Dexie messages+snapshots and keyset page
  continuation (no `OFFSET` scan cost). Restoring the currently active rows
  uses one Dexie transaction only after provider-specific consistency checks.
  A selected combined settings+DB restore attempts rollback on DB failure,
  but separate storage backends cannot guarantee crash-atomicity. The
  current restore holds a bounded 128 MiB transaction input; larger restore
  needs a separately designed staged generation switch. This is a restore
  constraint, **not** a reason to restrict streaming export size.
- Binary files outside IndexedDB are not automatically included; original
  structured-clone values stored *inside* IndexedDB remain portable. An
  external media-copy port and installed browser acceptance are separate.
- Generic TAR stream, restoration, progress and Pinia ports live under
  `packages/storage`; the shared widget stays presentation-only; VK schemas
  and source snapshots remain entirely VK-owned. No unfinished ChatGPT
  migration implementation was imported.
