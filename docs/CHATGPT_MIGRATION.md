# ChatGPT Booster migration into Browser Extensions

Status: **local integration in progress — not deployed and not a canonical cutover**.
Source of the imported compatibility application:
`KobaProduction/chatgpt-booster`, clean `dev` commit
`1b01c6422ea8b3989cacbd72c8e1cc672559bc59`. Imported through
`git archive` to `integrations/chatgpt-booster/`, without the source repository's
working-tree changes, credentials, Git history, or any browser-stored data.
The source repository is left unchanged.

## What has actually moved

- **Complete browser application baseline**: existing ChatGPT-specific core,
  UI, features, observer, ChatGPT DOM/API integration, telemetry, MV3 and
  Tampermonkey targets, plus their manifests/build scripts and focused checks.
  This is a compatibility-stage application with an independent install/build
  pipeline. It is not yet composed through the monorepo's module registry.
- **Shared UI ownership**: real ChatGPT Booster `ModalSurface`,
  `FloatingInfoPopover` and `JsonViewer` implementations live in
  `packages/ui`; the VK shell uses the same modal.
  The Archive Browser conversation sidebar now uses the provider-neutral
  `ArchiveConversationList` widget with ChatGPT's project/branch grouping
  mapped at the adapter edge. Its CSS is maintained once under `packages/widgets`
  and imported by the ChatGPT and VK Shadow DOM stylesheet entries.
  The docked ArchiveWorkspace's ratio/clamp logic lives in generic
  `window-geometry`, and `ArchiveProgressBar` is consumed by both
  ChatGPT Export and the VK Archive Manager.
  ChatGPT's native record presentation/branch graph remains ChatGPT-owned
  until the stable canonical ContentElement projection is implemented.
- **Storage infrastructure**: reusable IndexedDB request and transaction
  completion functions now live in `packages/storage`. Both imported v3 and
  v4 stores consume them. The v4 physical IndexedDB schema/open/validation is
  isolated in `archive-v4-database.ts`, separate from v4 ingest/reader logic.
  The actual database identifiers, indexes and owner-scoped write contract
  are preserved; no database is opened, renamed or migrated by this import.

## Architecture and data protection

The later 2026-10-09 canonical archive/migration decision in
`integrations/chatgpt-booster/docs/ARCHIVE_TARGET_ARCHITECTURE.md` is the
current authority, including Project, Conversation, Message, Metadata,
ordered ContentElements and immutable SourceSnapshots. The imported DEV
implementation remains legacy v3/v4 until verified canonical migrations exist.
These four versions remain independent: physical storage schema, canonical
model, ChatGPT source adapter, and migration plan. Do not rename/reset either
existing IndexedDB database, assume message-parent proof, infer unknown
account ownership or migrate by copying raw data into a guessed schema.

Live ChatGPT UI stays memory-first. IndexedDB is an asynchronous persistence/
hydration channel, never a synchronous dependency of current-message tools.
A source-adapter incompatibility may block new ingest, not ordinary native
ChatGPT or already saved verified canonical reads.

## Remaining extraction boundaries

1. **Archive interface**: the conversation sidebar, docked geometry, and
   shared progress are extracted. The ChatGPT-only export option matrix is
   moved from `ArchiveExportDialog` to `ArchiveExportOptions.vue`;
   the parent owns preferences, readiness, cancellation and output.
   Continue splitting `ArchiveBrowser` message/graph presentation,
   `ArchiveRecord`, export readiness, and source-aware navigation into
   shared canonical reader/export contracts and a ChatGPT presentation adapter. Reuse
   canonical domain entities and explicit provider capabilities; do not
   equate VK linear offset pagination with ChatGPT verified branch history.
2. **Canonical storage and migration**: move domain/message-element contracts
   and canonical repository/reader interfaces to a cross-product archive
   package. Keep versioned ChatGPT ingestion, v3/v4 legacy adapters, owner
   reconciliation, migration journal, cross-tab locking and activation behind
   ChatGPT integration until correctness is proven. Do not cut over by
   silently converting existing browser data.
3. **Composition**: replace duplicate target/bootstrap/settings code with
   shared packages after both browser targets and current workflows are
   validated. Preserve the standalone compatibility build for rollback
   until actual runtime/product acceptance.
4. **Acceptance**: both builds, existing v3/v4 archive workflows, active-chat
   memory state, branch-aware browsing/export, UI focus/theme/responsiveness,
   failure recovery and explicit user-approved migration. Source tests or a
   local snapshot are not browser acceptance.

## Local operation

The copied application has its own Bun workspace. Its root has a local
Bun override for `@kobaproduction/browser-ui`; `browser-widgets` declares
`browser-ui` as a versioned peer dependency. Root `bun run check:chatgpt`,
`bun run test:chatgpt` and `bun run build:chatgpt` compile the shared
packages first. No source copies or registry fetch are needed for local use.
Generated outputs stay ignored. Root Browser Extensions checks explicitly ignore the copied application
so that two independent application test suites do not share mutable global
mocks. The imported ChatGPT application is validated by its own commands. No PR, push or release occurs until the integrated migration is accepted.
