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

## Historical stable checkpoint and development policy

The only approved stable historical ChatGPT Booster recovery baseline is
**0.8.92**, original source commit `6a4b00b99eb95f5f4090a2c780c511da4f28353a`.
Publish its original production-target installer as the standard
`chatgpt-booster/v0.8.92` release, with product name `ChatGPT Booster`,
original Tampermonkey namespace and a version-pinned updater URL.
Do not label this installer DEV or register it under a competing recovery
identity.

**0.8.98 is experimental, not approved for publication**. Its original
source remains available in the `reference/chatgpt-legacy-recovery-v0.8.98`
reference branch solely to recover implementation details and inspect
regressions; do not publish its installers or promote it to stable/PROD.
The unrelated monorepo 2.x stream remains under development and must not
silently replace the historic stable 0.8.92 update channel.

A successful historical source build is not installed-browser acceptance.
Back up the original browser profile and v3/v4 IndexedDB data before using
any historical build. See [environment isolation](../shared/ENVIRONMENTS_AND_STORAGE.md)
and [backup/restore](../shared/BACKUP_AND_RESTORE.md).
