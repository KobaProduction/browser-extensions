# Backup, import, restore and portability

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

**Existing source reality:** VK Archive 3 on PR #10 implements scope-checked
JSON database export/import and receipt metadata, not bundled media backup;
ChatGPT has its own v3/v4 backup/migration contracts. A universal settings
backup and a Dexie-backed cross-product recovery facade are **not yet
accepted or deployed**.
