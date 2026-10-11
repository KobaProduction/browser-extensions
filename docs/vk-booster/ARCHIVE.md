# VK Archive v1 — initial pre-PROD product contract

**Owner decision (2026-10-11):** the next VK Booster is the first application
release candidate, with archive schema **1** and source product base **1.0.0**.
Keep both at version 1 through development until an explicitly accepted first
PROD release. DEV identifiers are generated independently; do not bump source
semver merely to identify a new build. This replaces the former v2/2.3.10
pre-release freeze decision, not historical Git tags or user-owned data.

## Canonical first-release archive

- Each new conversation folder contains `metadata.json` (schema 1, ownership,
  checkpoints, media receipts), `messages.json` (schema 1, source VK messages),
  local `index.html` and `media/` with original downloaded attachments.
  This is the **first supported schema** of this folder-style product, despite
  historical `state.json/pages` scripts also being informally called v1.
- Preserve VK message IDs, peer/sender/direction, text, timestamps,
  reply/forward metadata, filenames where available, media originals, voice
  and offline HTML links. IndexedDB is not necessary to read `index.html`.
- Paged authorized history and exact-N (at least 3,000), incremental/backfill,
  deduplication, pause/resume, acknowledgement-gated checkpoints and real
  attachment receipts must work before publishing.
- A saved file with an SHA-256 receipt is verified on explicit rerun and
  repaired only with source authorization. Receipt-only UI never falsely
  reports an on-disk audit; older hashless receipts remain unverified.
- Folder access is bound to verified active VK peer, service/channel and
  installation. No DEV/PROD crossover, implicit shared writable storage,
  redirected writes after VK SPA navigation, or filesystem mutation when
  permission/folder selection fails.

## Historical data and release compatibility

- Existing `schema: 2` (`metadata.json` / `messages.json`) folders from
  historical development artifacts and older `state.json/pages` folders are
  **not v1 and never auto-converted**. Selecting one fails closed before
  writing; its files remain untouched. Reuse/migration would be a separately
  authorized, backed-up and tested operation, not part of this first release.
- Historical Git tags and artifacts, including `vk-booster/v2.3.8` and
  `dev-vk-booster/v2.3.*`, are retained as recovery evidence. A new `1.0.0`
  is numerically below those historical builds. Therefore an installed older
  browser extension **cannot be assumed to upgrade automatically**; validate
  actual installations and release identity before any PROD cutover.
- No claim that nobody has local archives, no deletion of archives or
  persistence, no automatic migration, no PROD publish, and no silent rollback.

## Dexie, telemetry, UI and backup boundaries

- The initial VK archive remains a user-selected **file-backed** folder.
  Optional Dexie-backed indexed read/cache or a future canonical repository
  requires a separate scoped provider-owned port, schema 1 from its first
  creation, explicit backup/restore and owner/channel isolation tests; it is
  **not implemented by merely installing Dexie**.
- [Shared PR #32](https://github.com/KobaProduction/browser-extensions/pull/32)
  provides Dexie **telemetry-journal version 1** and a common OTLP-over-HTTPS
  adapter. They are separate from the archive and not yet wired into VK or
  merged into `main`. Do not duplicate them or send private messages, URLs,
  paths, hashes, account IDs or credentials as telemetry. Local collection
  and remote delivery require independent explicit opt-ins (default off).
- One shared Control Center with VK capture/reader/settings navigation,
  bounded archive paging, receipt statuses and no second launcher.
- Capture-preset JSON is **session options only**, not archive backup or
  persisted settings. Full archive/settings backup and external media inclusion
  require separate validate/restore/rollback contracts.
- All-in-one requests same-channel provider data only through user-consented,
  owner-proven read-only ports; it does not open a standalone product DB.

## Acceptance before first PROD

1. New schema-1 archive, exact-N 3,000, incremental/backfill, safe interruption,
   resume, reopened folder and offline HTML/media integrity.
2. Negative tests for schema-2 and historical state/pages folders proving
   **zero writes**, invalid owner/peer/channel and lost permission.
3. Separate settings and archive backups, large/malformed/wrong-owner restore,
   SHA-256 and rollback evidence; missing capabilities remain open issues.
4. Strict TypeScript/Vue, Biome, regression tests, build and output validation
   for Tampermonkey, MV3 and dependent all-in-one.
5. Installed-browser checks for VK auth, real folder picker, keyboard/mobile
   UI and six-way DEV/PROD isolation; independent code review and an explicit
   first-PROD release decision. Synthetic tests alone cannot close this gate.
