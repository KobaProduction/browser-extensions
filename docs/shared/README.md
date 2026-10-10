# Shared platform documentation

This directory defines contracts used by VK Booster, ChatGPT Booster and the
all-in-one application. It is not a backlog and it does not supersede source
code for implementation details.

1. [Project rules](PROJECT_RULES.md) — repository documentation layout, code
   boundaries, checks and review ownership.
2. [DEV/PROD environments and storage](ENVIRONMENTS_AND_STORAGE.md) —
   *mandatory* isolation, lifecycle-scoped state, Pinia persistence, Dexie
   IndexedDB target and least-privilege aggregate access.
3. [Integration contract](INTEGRATION_CONTRACT.md) — how aggregate and
   standalones interact without direct database access or environment mixing.
4. [Backups and restore](BACKUP_AND_RESTORE.md) — independent export/import of
   settings and large data with validation and rollback.
5. [Telemetry](TELEMETRY.md) — provider-neutral opt-in telemetry and scopes.

For actual release automation, see [DEV/PROD channels](../DEV_PROD_CHANNELS.md),
[release operations](../RELEASES.md) and
[independent versions](../INDEPENDENT_RELEASES.md).

Implementation owners: `packages/core`, `packages/adapters`,
`packages/storage`, `packages/archive`, `packages/ui`, `packages/shell`
and app-specific composition in `apps/`. The DDD/FSD target is defined in
[the architecture document](../TARGET_ARCHITECTURE.md).
