# VK Archive 3 — product and acceptance contract

This document preserves the VK archive behavior requested by the product
owner. It defines durable *requirements*; actual source and installed-browser
acceptance determine what has been implemented.

## Capture and native archive

- A user chooses or opens a VK conversation. Capture **every accessible
  message** by authorized VK API paging, not by walking the DOM, and store the
  full normalized history first. Do not download attachment binaries here.
- Keep each message's stable VK ID, peer ID, send date, author, direction,
  text, attachments and their typed source metadata. Preserve replies,
  forwards, edits and any available message relationships without flattening
  them into untraceable plain text. Do not save credentials or expiring links
  inside the persistent archive/backup.
- A verified complete source snapshot is not rescanned on every viewing or
  export. Updating means a separate bounded fetch of **new** messages without
  repeatedly reading old history; explicit full rescan is a separate operation.
- The local archive belongs to its exact product, environment and account
  identity, never just to `vk.ru` or a message ID.
- Store searchable/indexed heavy data in a versioned IndexedDB repository
  backed by a future shared **Dexie adapter** (target). Message text and
  attachment references are durable; binary media are separate files. Do
  not implement redundant recent-N/backfill workflows from the deleted v2
  prototype.

## Archive viewer

- VK-specific presentation with chat bubbles, send dates, incoming/outgoing
  distinction, author, search, attachment placeholders and navigation.
- Preview images/files where locally available; distinguish not downloaded,
  downloaded, renamed, modified and missing. Do not accidentally launch a
  second unrelated shared-shell UI.
- The shared UI library supplies reusable controls and archive presentation
  ports. ChatGPT keeps its own provider-specific view, including tool calls
  and branch semantics. Neither viewer reaches into the other's private DB.
- Archive-only local mode must work without VK authorization using validated
  imported backup/snapshot; the shared offline mock harness must be reusable
  by other extensions.

## Independent export

- User chooses an inclusive start/end date, message text included/excluded,
  attachment classes/extensions, size limits and a destination folder.
- Output: `chat.json` (message text, send dates, stable IDs and attachment
  metadata **without authorization**), `manifest.json` (scope, export ID,
  schema, file references/hash/size), and a single flat `attachments/`
  directory.
- File names: **stable numeric prefix** followed by a hyphen and a safe
  readable original filename. Enforce path traversal protection, extension
  preservation, bounded UTF-8 byte length and deterministic collision
  resolution; never overwrite another attachment silently.
- The archive stays canonical; an export is a snapshot over stored messages,
  not a new forced history scan. Binaries can be downloaded separately
  after user permission. File receipt/manifest records include source
  attachment identity, relative path, SHA-256, bytes, export identity and
  status, not a raw auth token.
- On subsequent exports, audit the selected folder against recorded hashes:
  valid, missing, renamed, modified. Only redownload missing/corrupted files
  when explicitly requested; retain source provenance and failure reports.
  Prefer bounded/streamed media I/O, with explicit maximum size and retry.
- A full export that includes messages plus selected attachments is a
  **separate explicit action**, not the mandatory behavior of archive capture.

## Backup and restore

Support separately portable snapshots of application settings and native
IndexedDB archive records, including schema, indexes/metadata and receipt
ledger. External attachment directory must be independently backed up or
clearly declared not included. Restore must validate owner/channel/format,
protect current data on failure, and reject unapproved cross-channel
imports. See the [shared contract](../shared/BACKUP_AND_RESTORE.md).

## Verification

At minimum:

1. Synthetic 3,000+ message initial capture, partial failure and verified
   completion; update fetches only new messages and preserves relationships.
2. Date/type-filtered export from the **existing DB**; compare JSON, original
   filename/numbered prefix and attachments manifest, not just file counts.
3. Download receipts and SHA-256; renamed, modified, missing and repaired
   assets across repeated exports.
4. Restore empty, large, malformed, wrong-owner/wrong-channel and interrupted
   backups without corrupting existing data.
5. Simulated VK DOM/injection and archive-only dev mode; installed
   Tampermonkey and MV3 real VK API + permissions checks.
6. Six-way DEV/PROD and standalone/aggregate coexistence, browser restart,
   separate IndexedDB and settings, no cross-account reads.
7. Scoped optional telemetry and independent import/export interfaces.

Version stays at **VK Booster 3.0.0**, with DEV prerelease identifiers for
testing. PR/CI source success cannot be substituted for installed-browser
acceptance. For shared rules, use the authoritative
[environment isolation](../shared/ENVIRONMENTS_AND_STORAGE.md).
