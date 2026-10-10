# ChatGPT Booster

**Owner:** `modules/chatgpt-booster/`. The first-party module is the
canonical product source for userscript/MV3 packaging. Historical standalone
repositories, PRs and `integrations/chatgpt-booster/` are reference evidence,
not a second live product.

## Documentation hierarchy

- [Migration and installed-product acceptance](MIGRATION.md) — source
  consolidation, owner verification and acceptance gates.
- [Migration history](MIGRATION_HISTORY.md) — older source checkpoints and
  reconciliation background.
- [Archive decomposition](ARCHIVE_DECOMPOSITION.md) — current v3/v4 and
  canonical reader/audit/export module boundaries.
- [ChatGPT provider architecture](../../modules/chatgpt-booster/docs/ARCHITECTURE.md)
  and [archive target](../../modules/chatgpt-booster/docs/ARCHIVE_TARGET_ARCHITECTURE.md).
- [Shared environment/storage rules](../shared/ENVIRONMENTS_AND_STORAGE.md),
  [backups](../shared/BACKUP_AND_RESTORE.md),
  [telemetry](../shared/TELEMETRY.md), and
  [aggregate connections](../shared/INTEGRATION_CONTRACT.md).

## Responsibility and state

ChatGPT Booster owns its account-scoped native/canonical archive, source
verification, v3/v4 data/owner proof, capture and UI. Branch graphs, tool
calls and generated content use **ChatGPT-specific** domain entities, not VK
message formats. The shared shell/ports are reusable; the physical ChatGPT
archive remains private to this product.

Do not silently migrate, overwrite or inspect another extension's archive.
DEV and PROD do not share persistent settings, indexes, caches or events.
A same-channel aggregate may request a read-only snapshot only through an
explicit capability and owner-validated consent, not by guessing a database
name. See the shared contracts linked above.

## Acceptance boundary

Builds and source integration are not proof of installed-browser migration.
Maintain explicit checks for verified account ownership, raw v3/v4 recovery,
canonical migration, restore and live source parity. Track active defects and
remaining acceptance in the targeted GitHub Issues, especially the current
[ChatGPT archive migration ticket](https://github.com/KobaProduction/browser-extensions/issues/11).
Do not copy universal architecture rules into those issues.
