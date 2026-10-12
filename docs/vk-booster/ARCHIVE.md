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
- Capture reads bounded VK API pages (at most 100 messages per request); the product no longer applies an arbitrary 3,000-message ceiling to the full-history mode. The Reader
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

## Single-stream TAR.GZ backup (source implementation; browser acceptance pending)

VK now adapts its fixed owner-scoped Dexie v1 message/snapshot tables to a
shared portable TAR writer and Reader. The TAR contains only plain JSONL
chunks, schema, optional durable settings and a final integrity manifest;
**one GZIP stream** compresses the whole TAR. No nested compression or raw
physical IndexedDB file copies. The internal operator API accepts section
selection, chunk size, progress and a file sink; the restore validates exact owner/channel,
physical table schema and hashes before the provider performs one IndexedDB
transaction. External media and tab/session storage are excluded. This is
not yet accepted as crash-safe installed-browser recovery. See the
[shared backup contract](../shared/BACKUP_AND_RESTORE.md).

## Site-wide launcher and full-history VK capture (2026-10-12)

The VK Booster Shell/quick menu runs on **all HTTPS paths** under `vk.com` and
`vk.ru`, including feed, profile, communities and messenger. The Chrome popup,
Tampermonkey @match and all-in-one composition use the same site-wide matcher.
Opening settings and reading module state do not require an active chat. The
**capture, conversation Reader and export remain gated** on a valid current
VK conversation and verified owner, with `/im/convo/<numeric>` or legacy
`/im?sel=<numeric>` selected peer; no background mass-collection on unrelated
pages. A broader site scope must never be treated as archive authorization.

The default capture action now scans the **full history reported by VK**, in
bounded pages (10–100 messages each), writing original responses and their
canonical projections to the same fixed Dexie schema v1. A second user mode
collects only the most recent N messages (up to the existing validated
100,000 setting). Page size and inter-request delay (300–3000 ms) are real,
user-adjustable and scoped durable preferences. The VK provider has bounded
exponential backoff for explicit API code 6 and HTTP 429/5xx; it does **not**
bypass remote API rate/permission limits. Completion reflects the stable
server-reported count, not a promise that VK history cannot change while
scanning. Missing/short pages, account/peer changes and source conflicts fail
closed without deleting already saved messages. The scan can be stopped and
restarted: saved originals are deduplicated; durable O(1) offset continuation
remains a future efficiency improvement, not a completed guarantee.

The UI separates **stage 1: message capture** from **stage 2: attachment
bytes**, which is not yet implemented against Dexie. The original attachment
metadata stays with immutable source snapshots; reported reference counts
never imply local media files were downloaded. A dedicated media pipeline
(permissioned file sink, URL expiry/refresh, receipts, bounded retry and
restart) is required before describing the export as a full offline archive.

## Export feedback (Extension 16; browser validation pending)

The JSONL.GZ UI now activates a temporary document-attached download link,
then removes it and later revokes the generated URL. Export and Reader show
separate loading indicators. Errors are categorized into safe user guidance
without reflecting arbitrary provider exception text or credentials. This is
source-level hardening, not proof that live VK download succeeds. Binary media
and the canonical Dexie schema remain unchanged.


## Conversation Reader and end-user ZIP export (Extension 18; local validation)

The ordinary **Archive** tab reads its first bounded Dexie page immediately
on entry, displays chronological conversation bubbles aligned by stored
`out` direction, and shows VK `from_id`, source `date` and text. Optional
`users.get` lookups resolve first/last names without changing immutable
source snapshots; lookup errors retain messages with an honest ID fallback.
A shared archive header displays author/time and an accessible, inspectable
original-source metadata popover, also reused in ChatGPT Booster.

**End-user export is separate from internal TAR.GZ recovery.** Clicking the
export shortcut opens a ZIP preparation form and never downloads immediately.
Choices are bounded JSON chunk size and an attachment-reference manifest.
ZIP includes all *locally saved, owner/peer-verified* source snapshots grouped
as `messages/*.json`, a manifest including chunk hashes and incomplete-source
disclosure, and `attachments/status.json` when selected. Only binary media
explicitly downloaded in the current authorized Reader session are included
under `attachments/`; other assets remain listed as not downloaded. A
permissioned persistent media store and restartable bulk attachment capture
are not yet implemented. The old raw JSONL.GZ service API remains available
for internal use but is **not** the user-facing export button.

This change extends the shared ChatGPT ZIP writer through
`packages/archive`, rather than duplicating a VK-only codec. Installed
VK/ChatGPT acceptance and DEV publication are separate from local tests.
