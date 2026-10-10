# Browser Extensions — agent entry map

This file is a **router**, not the application's rulebook. Durable project
rules reside in `docs/shared/`, product contracts under `docs/<product>/`;
GitHub Issues track only current tasks/evidence, never the sole rule authority.

## Required navigation

1. Read the short [system catalog](README.md) and
   [documentation index](docs/README.md).
2. Read the [project rules](docs/shared/PROJECT_RULES.md) relevant to the
   current decision. **Environment isolation** and **backup ownership** are
   binding for all product/channel storage work.
3. For substantive architecture, implementation, target, permission, UI or
   release changes, read [accepted target architecture](docs/TARGET_ARCHITECTURE.md)
   completely and compare with [current architecture](docs/ARCHITECTURE.md).
   A target is not proof of a working implementation.
4. Load the relevant global AI workflow skill/role for the task; do not read
   unrelated skills or account prompt templates.
5. Select the product-specific README or shared contract below. Inspect
   current Git/ref and source before technical decisions.

## Ownership routes

| Task | Mandatory local authority | Source |
| --- | --- | --- |
| VK conversations/archive/export | [VK Booster](docs/vk-booster/README.md), [archive contract](docs/vk-booster/ARCHIVE.md) | `modules/vk-booster/` |
| ChatGPT archive, account/owner and migration | [ChatGPT Booster](docs/chatgpt-booster/README.md) | `modules/chatgpt-booster/` |
| All-in-one/provider connection | [All-in-one](docs/all-in-one/README.md), [integration](docs/shared/INTEGRATION_CONTRACT.md) | `apps/` |
| Storage/Pinia/Dexie/identity/session | [Environment and storage](docs/shared/ENVIRONMENTS_AND_STORAGE.md) | `packages/storage/`, `packages/adapters/` |
| Backup/import/restore | [Backup contract](docs/shared/BACKUP_AND_RESTORE.md) | Provider repository + shared ports |
| Telemetry/metrics | [Telemetry contract](docs/shared/TELEMETRY.md) | `packages/core/` and provider adapter |
| Build, versions, release | [Project rules](docs/shared/PROJECT_RULES.md), [release channels](docs/DEV_PROD_CHANNELS.md) | `scripts/`, `.github/workflows/` |
| Issue/PR creation | [Issue routing](docs/ISSUE_ROUTING.md) | Required `Target extension` |

## Non-negotiable immediate gates

- DEV and PROD **never** share writable data, settings, IndexedDB or events.
  The aggregate may request access only to same-channel services, through
  an explicit capability, valid owner identity and user consent.
- VK Booster product base stays **3.0.0**, not `3.0.1` etc. Development
  build IDs may advance without raising the base version.
- Protect ChatGPT v3/v4 existing PROD archives; VK's abandoned v2 prototype
  is not a compatibility requirement.
- Never store credentials or personal conversations in Git, telemetry,
  synthetic fixtures or CI logs.
- Work on a non-protected branch. Run strict typecheck, Biome, tests and
  relevant output/build gates. Independent reviewer owns merge to protected
  branches. Distinguish source/build from browser/data/prod acceptance.
- Any new Issue names exactly one `Target extension` and contains **current
  implementation scope and acceptance**, with links to documentation rules.
  Do not paste persistent rules into Issues.

Changes to these decisions belong in the owning documentation contract; link
to that contract rather than adding more copies to this router.
