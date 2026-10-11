# VK Archive v2 — preserved product contract and enhancement acceptance

This is the authoritative VK product contract after the owner's 2026-10-11
correction. **The implemented VK Archive v2 is not replaced by the unmerged
Archive 3 proposal.** The product base remains **2.3.10**, and DEV build IDs
may change without changing product semver.

## Existing archive: non-destructive compatibility

- Preserve the on-disk `metadata.json`, `messages.json`, `index.html`
  and `media/` format and the ability to reopen, export and resume an
  existing v2 folder. Never silently delete, rename or migrate its records.
- Keep stable VK IDs, peer IDs, sender, direction, date, original message
  text, source attachment metadata, forwarded/replied records, original
  filenames where available, voice/media files and local HTML links.
- Paged authorized VK API capture, exact-N up to at least 3,000 messages,
  incremental/backfill options, deduplication, pause/resume and checkpoint
  acknowledgement remain supported. Never log/store authentication secrets.
- Bound the archive to the selected conversation, validated owner,
  product/installation and channel. DEV and aggregate must never write to
  an unstamped or other installation's PROD folder. Fail closed on mismatch,
  lost folder permission and SPA navigation while a write is pending.
- Preserve the same Control Center (one launcher and one modal) across
  Tampermonkey and Chromium MV3.

## Additive archive and offline capabilities

- Archive preview: conversation-like bubbles, dates, author/direction,
  searching, reply/forward context, available attachments and clear missing
  media statuses. `index.html` must continue to open locally without a server.
- An optional indexed **read model/cache** for large collections may be added
  behind a provider-owned port, but it must not become a silent replacement
  for v2 files. Implement explicit import/validation and failure-safe
  reconciliation before relying on it for canonical writes.
- A new full-history capture or incremental update must not repeatedly
  reread the entire conversation once verified complete. File downloads can
  be deferred through an explicit setting/action, without removing the
  existing combined v2 workflow until backward-compatible behavior is proven.
- Optional date/type-filtered exports may generate `chat.json`,
  `manifest.json` and numbered readable `attachments/` files, but **only
  as an additional export format**; these files must not replace the
  canonical v2 layout. Source message metadata and scope remain traceable.
- Downloads use safe deterministic filenames, bounded stream/size limits,
  SHA-256 receipts and explicit missing/modified/renamed/repair states.
  On a user-initiated v2 export run, existing saved files with a SHA-256
  receipt are verified by digest, not just size, and repaired through the
  authorized downloader when corrupted. Old v2 receipts without hashes
  retain legacy size-only compatibility and remain **unverified**; a future
  explicit media audit must distinguish this status. Redownload only with
  user permission and retained provenance. Filesystem read errors, unusable
  checksum receipts and unavailable hash verification fail closed, retaining
  the prior saved media record instead of speculatively marking it failed.

## Backup, restore and integration
- The VK capture-options JSON profile is intentionally limited to current
  session parameters, not the canonical v2 archive or durable application
  settings. It contains no peer ID, folders, messages, tokens or binaries;
  scoped checksum validation precedes a fail-closed session update. This
  **does not** satisfy archive backup/recovery or restart persistence.

- Separate export/validate/import/restore for settings and archive data,
  with independently declared external media inclusion and user-owned paths.
  Check schema, counts, hashes, owner, channel and resource bounds *before*
  mutation. A failed restore must leave the existing v2 archive usable.
- Provider-neutral storage, export, telemetry and import ports can be shared
  with ChatGPT Booster but its v3/v4 physical IndexedDB, canonical archive and
  account ownership remain independent. Never import another product's
  private database directly.
- Telemetry is off by default and sanitized by product and channel.
  The aggregate may request only explicitly consented, same-channel,
  owner-proven read access; DEV/PROD and standalone/aggregate data stay
  isolated.

## Acceptance gates

1. Reopen real preexisting v2 folders unchanged, then exact-N 3,000-message
   capture, incremental/backfill dedup, pause/resume and navigation interruption.
2. Preserve HTML offline viewing, source text, original attachments, links,
   voice files, filename safety and SHA-256 integrity after repeated exports.
3. Demonstrate filtered exports and attachment audit/repair without silently
   altering or deleting canonical v2 files.
4. Validate backup/restore for empty/large/malformed/wrong-owner/wrong-channel
   and interrupted inputs; prove rollback and no cross-channel overwrites.
5. Test source mocks separately from authenticated VK APIs and the installed
   Tampermonkey/MV3 permission and file-picker flows.
6. Verify six-way VK/ChatGPT/all-in-one DEV/PROD co-installation, browser
   restart, multiple tabs, settings/database isolation and account switching.
7. Independently review source and build artifacts, then perform live browser
   acceptance before any PROD promotion.

Do not interpret PR #10 synthetic tests as v2 compatibility evidence; that
PR removed v2. Never bump VK above **2.3.10** without a new owner decision.
