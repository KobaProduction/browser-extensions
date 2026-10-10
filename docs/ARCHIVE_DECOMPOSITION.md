# Shared archive/storage decomposition (2026-10-10)

## Implemented source architecture

The VK Booster 2.3.10 and ChatGPT Booster 2.0.4 share real platform use
cases and adapters, not their provider-specific account or storage schemas.
Their all-in-one consumer is 0.5.3. The versions changed together because
`packages/storage` was extended as a reusable platform contract used by
ChatGPT; VK currently uses shared archive and file-output APIs rather than
an IndexedDB database. A shared-package change conservatively bumps both
consumers as required by the release impact graph.

| Concern | Single shared owner | Provider adapter |
| --- | --- | --- |
| Linear recent, incremental and backfill page selection | `packages/archive`: page fold, scan linear | VK ID and timestamp mapping, v2 durable checkpoint |
| Source-verified native message deduplication | `packages/archive`: strict snapshot fold, SHA-256 and composite keys | ChatGPT native branch/source fingerprints, v3/v4 schema |
| IndexedDB request success and **completed transaction** | `packages/storage`: `requestResult`, `transactionComplete` | ChatGPT native v3 store, v4 source writer, canonical migrator, native source transfer |
| Bounded cursor page, stable primary-key continuation | `packages/storage`: `readIndexedPage`, `readStorePage` | ChatGPT canonical indexed source scan and exact raw-row export |
| Bounded indexed timestamp range with non-unique keys | `packages/storage`: `readIndexedRangePage` | ChatGPT recent reconciliation, lastSeenAt source index |
| Browser file output and verified attachment bytes | `packages/adapters`, `packages/archive` | VK native File System Access v2 output, VK media selection |
| UI layout, launcher, dialog and shared progress | `packages/shell`, `packages/ui`, `packages/widgets` | VK export/preview and ChatGPT archive/recovery now use the same `ArchiveProgress` primitive through a compatible VK widget adapter |

### ChatGPT provider decomposition

The former `archive-v4-store.ts` contained both the native entity model,
identity/validation rules, direct IndexedDB requests and the write workflow.
They now have separate owners:

- `archive-v4-entities.ts`: version-stable v4 source and path contracts
- `archive-v4-identities.ts`: source-native ID validation/chronology and the
  **same** JSON composite-key format provided by `packages/archive`
- `archive-v4-queries.ts`: read-only typed source DB queries with injected
  DB connection, no migrations or writes
- `archive-v4-store.ts`: exact v4 schema upgrade/version 2, write tickets,
  account epoch, generation fencing, transaction orchestration, source capture
- `archive-canonical-source-reader.ts`: provider-owned legacy DB inspection,
  native source object validation and bounded indexed/time-range reading
  through shared `packages/storage` cursor services
- `archive-canonical-migrator.ts`: account-bound v3/v4 staging/activation,
  rollback, reconciliation and recovery; source enumeration lives outside
  its migration transaction coordinator
- `archive-source-transfer.ts`: strict owner-preserving binary backup and
  import with shared, bounded whole-store source scanning

The historical `integrations/chatgpt-booster` v4 database helper targets
**database version 1**, whereas the currently shipped ChatGPT source has
**version 2** and canonical generation stores. That helper was not copied
blindly. The live `archive-v4-store.ts` remains the only physical schema
owner and no v3/v4 user data are modified by this code refactor.

### Why the engines remain separate

VK has a linear, descending history and the original v2 folder files:
`metadata.json`, `messages.json`, `media/`, `index.html`, and checkpoints.
ChatGPT has verified account ownership, native parent/branch graphs,
old source v3/v4 IndexedDB and canonical generation activation/rollback.
A provider-neutral linear scan must **not** decide ChatGPT ancestry, and a
shared IndexedDB adapter must **not** bind ownerless rows or guess account
identity. Sharing occurs at the bounded source/storage/output/application
ports rather than by merging the provider archive controllers.

### Validation boundary

The update includes synthetic tests for index/primary-key pair resumption,
identical timestamps, corruption and cancellation, plus the original
VK 3000-message, media and resume regressions and ChatGPT canonical tests.
Static tests and build success do not establish actual installed browser
acceptance, real-account migration/backup parity or permission prompt safety.
Those are separate product/release gates. Public releases remain manually
authorized, with product-scoped channels.

### DEV/PROD channel integration

`main` gained separately scoped DEV/PROD installations during this refactor.
The advanced channel code, manifest build identities and instance-scoped
ChatGPT IndexedDB names are preserved. The original standalone PROD account
and database names remain unchanged by `instanceKey(..., 'chatgpt-booster:prod')`;
DEV and all-in-one use their own storage namespaces and should not acquire
or silently migrate PROD native messages. This shared-storage refactor is
compatible with the channel matrix in [DEV_PROD_CHANNELS.md](DEV_PROD_CHANNELS.md).
Successful reviewed `main` CI may produce DEV prereleases through the new
channel workflow; **PROD still requires explicit manual acceptance**.

## Canonical read/audit/export service boundaries (2.0.4)

The canonical migration coordinator formerly combined four independent
responsibilities in one source file (~1,760 lines). They now have distinct
provider-owned services with explicit ports:

- `archive-canonical-model.ts`: canonical conversation/message and native
  source-snapshot type contracts, re-exported at the original migrator path
- `archive-canonical-reader.ts`: conversation listings and counts, native
  snapshot verification, bounded focused/chronological windows, saved Reader
  projections and export preview
- `archive-canonical-export.ts`: separate user-triggered partial JSON,
  Markdown and GZIP recovery export with owner/generation revalidation
- `archive-canonical-audit.ts`: read-only v3/v4 inventory, coverage counts,
  owner ambiguity inspection and bounded IDs; it cannot activate, stage,
  rebind or delete records
- `archive-canonical-migrator.ts`: the remaining ~990-line coordinator for
  explicit owner-consented migration, cross-tab locking, stage/validate,
  generation activation, reconciliation and rollback

The old `ArchiveCanonicalMigrator` public methods remain compatible facade
methods. Its constructor injects the active-generation check and database
connection ports into read/audit services rather than allowing them to open
or activate a canonical generation independently. Tests verify read-only
services refuse non-active generations without touching the database. No
physical schema or account/extension instance-scope keys change.

This is a **ChatGPT-owned source decomposition**, so VK Booster remains
**2.3.10**, ChatGPT moves to **2.0.4**, and all-in-one to **0.5.3**. The
common `packages/archive`, `packages/storage`, `packages/shell`, and
`packages/widgets` continue to serve both consumers without conflating
ChatGPT's branch-aware canonical migration and VK's linear v2 folder output.
