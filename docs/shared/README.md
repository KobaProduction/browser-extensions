# Shared platform documentation

This directory defines contracts used by VK Booster, ChatGPT Booster and the
all-in-one application. It is not a backlog and it does not supersede source
code for implementation details.

1. [DEV/PROD environments and storage](ENVIRONMENTS_AND_STORAGE.md) —
   *mandatory* isolation, lifecycle-scoped state, Pinia persistence, Dexie
   IndexedDB target and least-privilege aggregate access.
2. [Integration contract](INTEGRATION_CONTRACT.md) — how aggregate and
   standalones interact without direct database access or environment mixing.
3. [Backups and restore](BACKUP_AND_RESTORE.md) — independent export/import of
   settings and large data with validation and rollback.
4. [Telemetry](TELEMETRY.md) — provider-neutral opt-in telemetry and scopes.
5. [Browser UI acceptance](UI_ACCEPTANCE.md) — shared Shell geometry, fixture matrix and browser acceptance gates.

For actual release automation, see [DEV/PROD channels](../DEV_PROD_CHANNELS.md),
[release operations](../RELEASES.md) and
[independent versions](../INDEPENDENT_RELEASES.md).

Engineering processes and source ownership are routed by [AGENTS.md](../../AGENTS.md)
to AI Agent Workflow.

Implementation owners: `packages/core`, `packages/adapters`,
`packages/storage`, `packages/archive`, `packages/ui`, `packages/shell`
and app-specific composition in `apps/`. The DDD/FSD target is defined in
[the architecture document](../TARGET_ARCHITECTURE.md).
