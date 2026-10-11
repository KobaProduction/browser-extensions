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

## Portable settings backup (source-level)

The ChatGPT Settings view offers separate export and explicit-confirmation
restore of non-secret preferences using the shared 512 KiB, SHA-256-verified
settings-backup format. The adapter enforces exact product and DEV/PROD scope,
retains per-chat capture rules, and does not touch v3/v4/canonical archives.
This feature is not an archive backup and does not imply installed-product
acceptance. The owner-scoped native archive migration remains separately gated.

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

## Reconciled 2.0.7 source scope

After PR #25 merged, the integrated 2.0.7 development source retains its
single Control Center, current conversation/project context, manual archive
collection/stop, native/canonical recovery and export-format presets. The
Settings section continues to use the existing `ControlCenterPanel` and its
separate validated portable settings backup/restore; it does not replace
archive export or introduce another launcher. The pre-existing ChatGPT
telemetry settings/diagnostic adapters remain owned by the ChatGPT provider;
the common optional scoped telemetry port does not replace or implicitly
enable its transport. All-in-one is 0.5.9, VK remains 2.3.10. None of these
source changes promotes stable 0.8.92 or proves installed-browser acceptance.

## Restoring user-facing archive controls

The current 2.x module integrates the original ChatGPT-only archive and export
UI inside the **single shared Control Center**. Its provider panel must retain
current-chat and project context, capture policy and controls, explicit
collection/stop actions when supported by the provider, the source-backed
Archive Reader, the full Export wizard and the manually opened migration and
backup widget. Migration and owner reconciliation do not start automatically.

The hosted Export wizard exposes explicit Markdown, full JSON, JSON.gz and
ZIP-with-manifest profiles through the existing owner-verified export adapter.
These shortcuts select and persist export options; they do not initiate a
download, assert history completeness or include unverified binary assets.
The same Export view opens the existing native v3/v4 and canonical backup
tools without creating another launcher, archive engine or storage scope.

The historical 0.8.98 source reference owns comparison evidence for the
legacy floating Archive Workspace and navigation; it is **not** an accepted
stable release. Current stable **0.8.92** remains untouched. UI source
integration and a passing build do not prove that the user's original
v3/v4 IndexedDB is present or successfully read in the installed profile.
The floating window/minimize workflow and installed-browser export parity
remain under [functional acceptance issue #16](https://github.com/KobaProduction/browser-extensions/issues/16).
Data/owner reconciliation remains under
[archive acceptance issue #11](https://github.com/KobaProduction/browser-extensions/issues/11).

## Shared Dexie telemetry availability

Shared Dexie/OTLP adapters are now available for a future single telemetry
runtime. They are local-only/default-off until separately enabled and wired
by the product composition root. ChatGPT's existing provider-specific OTLP
client has **not** been silently replaced: its current transport and opt-in
remain independent pending validated migration into the durable journal.
ChatGPT v3/v4 native data and canonical archive are untouched. See
`docs/shared/TELEMETRY.md` and Issue #30.
