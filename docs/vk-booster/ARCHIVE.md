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

## Active service decomposition (2026-10-14; source only)

The executable VK composition now has one `createVkArchiveService`, installed
and removed by the common Feature capability lifecycle. The former mixed
`archive-engine.ts` is a compatibility re-export of this service, rather than
an alternate writer. Responsibilities are separated into:

| Source owner | Responsibility |
| --- | --- |
| `src/archive-runtime.ts` | Scoped compatibility publication and removal |
| `src/features/chat-export/model/archive-service.ts` | Compose the sole active service |
| `src/features/chat-export/model/archive-session.ts` | Verified owner/peer, environment identity, operation state, preferences and change subscriptions |
| `src/features/chat-export/model/archive-capture.ts` | Bounded VK history capture, immutable-source conflict policy, stop and honest completeness |
| `src/features/chat-export/model/archive-reader.ts` | Bounded saved reads, timeline/range, source evidence and export delegation |
| `src/features/chat-export/model/archive-backup.ts` | Provider settings and verified IndexedDB backup sources through shared storage adapters |
| `src/features/chat-export/model/vk-user-export.ts` | Selective/all saved-message ZIP, shared readable formats, original snapshots and attachment receipts |
| `src/features/chat-export/api/vk-assets.ts` | Provider-owned attachment descriptors; no file writer |

The parent `VKFeature` owns scoped preferences setup and cleanup; the archive
child owns only session/capture/Reader/IndexedDB-backup lifetime. Disabling
the archive leaves its parameters and settings backup available through the
same persistence port, without opening an archive or probing authentication.
The shared shell recreates a service-bound view when the declared child
lifecycle changes, retaining only its safe presentation tab; collection and
export commands remain one-shot and are never replayed on remount.

Active services have no imports of the historical folder engine, offline
HTML renderer, file-media writer or `VKArchive` authorization fallback. The
old folder implementation is preserved at `src/features/chat-export/model/legacy/index.ts` behind an
explicit unscoped synthetic-test entry. The old media import path remains a
compatibility re-export for retained tests; executable source imports the
descriptor-only adapter. Historical folders and databases are untouched.
Temporary legacy-shaped API members reject folder/run/viewer operations or
return empty legacy projections; they cannot activate the retained engine.

Native authorization proves the API token's owner with `users.get`; it does
not claim history permission before the real history request. This permits
provider settings and verified whole-owner backup catalog access outside a
conversation, while capture/Reader/export still require a current peer.
Authentication rejection discards the cached token for the next authorized
attempt. Session creation rejects a missing/unknown environment scope rather
than selecting PROD implicitly. Destruction aborts pending native requests and
prevents later authorization/retry; Reader media requests also stop when their
peer or view disappears. Reads and exports recheck owner/peer before returning. Export and
backup reads also fence the shared archive-change revision; that notification
revision is not a claim of cross-tab transactional snapshot isolation.

The Reader uses shared record identity/focus/Checkbox presentation. ZIP scope
defaults to all saved messages; explicit selections persist across bounded
Reader pages and clear on peer changes. Missing selected messages reject the
entire result. The manifest distinguishes exported `recordCount`, total
`savedRecordCount`, and selection mode/IDs. Source metadata remains intact;
neither a selection nor saved-record count proves remote-history completeness.

Dexie schema remains **v1**, with the existing projection/snapshot validator.
No data migration or physical database access was performed during this source
refactor. The earlier UI correction batch deferred validation. Focused synthetic
acceptance for the current composition is recorded below; it remains separate
from installed-extension and real-data acceptance.

## Bounded-memory application recovery (2026-10-14; source only)

The provider supports the shared sealed `PortableBackupReader` contract for
large application backup sections. Preflight scans `messages` and `snapshots`
in canonical `[store,key]` order, decodes one record/counterpart pair at a time,
and looks up that counterpart through the stage index. Owner, canonical key,
schema-v1 projection, original-source identity, source codec and exact field
projection use the same validation functions as the retained array adapter.
Duplicate/unordered records, missing counterparts, unknown extra rows and
incorrect total counts reject before an active row is removed. No whole-archive
raw map, message array or snapshot array is built by this staged path.

Replacement uses one owner-scoped transaction over the unchanged two active
tables. It reads the separate temporary stage in batches of at most 256 records
and deletes prior owner keys in equally bounded batches (secondary-index
`Collection.delete()` would otherwise collect every primary key in Dexie)
and keeps the destination transaction alive with `Dexie.waitFor`; another active
database write cannot interleave inside that replacement. Both staged and array
restore paths run a final provider guard inside the transaction before commit.
The service verifies owner/peer/context and archive-change revision around
preflight and replacement, and fences each staged read. It publishes the archive
change notification only after the destination transaction commits.

The temporary input/rollback database is owned by shared recovery, isolated by
application scope and sealed before provider access; it is not a new VK schema
or a historic archive migration. A failed final guard aborts the active
transaction. A failure detected after commit requires the shared coordinator's
compensation attempt; it cannot retroactively abort that commit. The broadcast
revision remains a notification fence, rather than a durable storage-wide lock
or proof of a cross-tab snapshot. Schema v1 has no persistent mutation stamp.
Storage quota, transaction timeout, interruption and concurrency behavior remain
pending the owner's deferred checks; no database was opened during this work.

The retained portable operator format also uses the pre-commit owner/context
guard for its array restore path and emits notifications only for committed
replacements. Its own successful notification advances the operation's expected
revision so a settings-write failure can compensate that replacement; an
observed external context/revision change invalidates the operator port. This
hardening does not convert the older operator format to staged large-file I/O.

## Shared conversation export, timeline and evidence (2026-10-14)

Ordinary conversation export now consumes source-neutral JSON, Markdown and
plain-text rendering in `packages/archive/src/conversation-export.ts`, also
used by ChatGPT Booster. Provider adapters still own authorization, immutable
source codecs, message inclusion, attachment receipts and packaging. VK ZIP
always retains its bounded original JSON chunks; Markdown/text adds one
readable `conversation.md`/`conversation.txt` view. This never becomes an
application settings/database recovery backup.

The same export port also emits standalone JSON, Markdown or text. A standalone
readable export includes portable original records only by explicit choice.
Attachment references retain their saved source URL, while clickable output
uses the common safe-link renderer. Preview does not fetch external media.
An explicit download resolves a descriptor from the current owner's saved
snapshot, accepts only declared HTTPS choices without credentials or redirects,
and validates MIME/content, byte limits, cancellation, owner, peer and archive
revision. Downloads are capped at 64 MiB per file and 512 MiB per Reader session;
ZIP inclusion is an additional opt-in using those issued receipts. Statuses and
hashes report the actual included files; failed/absent bytes remain source
references. Nested attachment inspection beyond depth eight is disclosed as
partial reference coverage. This source contract does not establish successful
authenticated VK downloads or installed-browser acceptance.

The same package resolves inclusive ranges from a streamed source, including
endpoints chosen on different Reader pages or in reverse order. Missing
endpoints reject the selection; original snapshots remain untouched. VK's
Reader previews both boundaries, disables export during range resolution,
and preserves selected IDs between pages. Its complete lightweight timeline
reads every saved projection in batches of 128, rather than silently treating
the current 80-message Reader window as the whole archive. Navigating a point
loads that message's bounded Reader window. Leaving the Reader, changing peer
or unmounting cancels pending timeline/range production.

`packages/archive/src/conversation-integrity.ts` owns reusable independent
start/end/chain states and computed first/last anchors. Its graph adapter
reports missing parents, cycles, duplicate IDs and disconnected explicit roots;
unobserved relationships stay unknown. VK supplies linear source evidence
instead: the observed API count, newest/oldest IDs, stable descending paging,
and the current owner/local notification revision. Nonadjacent numeric VK IDs
do **not** imply missing conversation messages. Overlapping/reordered history
pages stop capture before they can inflate the completeness count.

VK scan evidence is intentionally current-session memory, not a new table or
schema migration. A stopped/partial/changing scan cannot verify the full chain.
Reload, owner/peer changes or archive invalidation remove that proof while
retaining all saved originals. The UI and ZIP distinguish observed scan proof,
total saved count, exported selection and attachment availability. A stable
observed API scan is not an immutable server snapshot or a promise that remote
history cannot change afterward. External attachment bytes remain independently
reported. Dexie schema stays **1** and historical databases/folders are untouched.

The service composition accepts an optional scheduler port; production uses
the real bounded delay while synthetic integration injects a nonwaiting
scheduler. This follows the separation of feature modules, dependencies and
composition described by the official [FastAPI larger-applications guide](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
as an architectural analogy; no FastAPI backend is installed here.

Focused synthetic evidence: **78 tests passed / 985 assertions** across the VK
suite and new shared conversation-export/integrity suites. These include the
retained explicit test-only folder engine, current scoped Dexie capture beyond
3,000 messages, full timeline/range/coverage, overlapping-page failure,
cross-provider source-codec rendering, graph disconnection and 20,000-node
chains. Fake IndexedDB and synthetic fetch/file ports were used; no user data,
real VK authorization or production storage was accessed. Integrated browser,
build/release and installed-product acceptance remain separate gates.
